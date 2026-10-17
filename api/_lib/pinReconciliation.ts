/**
 * IPFS pin reconciliation — comparing Pinata's pin list against on-chain
 * metadata events to identify and reclaim orphaned pins.
 *
 * Every upload pins two CIDs (image + metadata JSON). If the follow-up
 * `set_metadata` transaction is rejected by the user or fails, those pins are
 * orphaned. The frontend handles the common case (unpins on provably-failed
 * transactions), but this reconciliation job is the safety net for:
 *
 * 1. Unconfirmed transactions (network timeout — the pins may still be valid)
 * 2. Browser crashes after upload but before the transaction could be attempted
 * 3. Manual IPFS uploads that bypass the StellarForge UI
 * 4. Pin leakage from any other code path
 */

import { PINATA_API_URL, pinataHeaders } from './pinata'

/** Grace window: pins younger than this are considered "in-flight" and never
 *  automatically reclaimed. Mirrors the JWT expiry (5 min) + generous buffer. */
export const GRACE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Interface for a single pin returned by Pinata's pinList endpoint. */
export interface PinataPin {
  id: string
  ipfs_pin_hash: string
  date_pinned: string // ISO-8601 string from Pinata
  metadata: Record<string, unknown>
}

/** Interface for the pinList API response. */
export interface PinListResponse {
  count: number
  rows: PinataPin[]
}

/**
 * Fraction of the account's pins a single run may unpin before the circuit
 * breaker trips (issue #1156). A healthy account sheds a handful of abandoned
 * uploads per run; anything approaching a tenth of the account means the
 * reference set is wrong, not that the users are.
 */
export const MAX_UNPIN_RATIO = 0.1

/**
 * The breaker only applies above this many candidate unpins, so a tiny or
 * brand-new account (3 pins, 1 genuine orphan) is not permanently blocked by
 * arithmetic.
 */
export const UNPIN_RATIO_FLOOR = 5

/** Result of one reconciliation run. */
export interface ReconciliationResult {
  /** Total pins checked against the on-chain reference set. */
  checked: number
  /** Pins that were present on-chain and preserved. */
  preserved: number
  /** Pins that were successfully unpinned. */
  cleaned: number
  /** Pins that were orphaned but unpin failed. */
  errors: number
  /** First error message, if any. */
  errorMessage: string | null
  /** Grace window in ms used for this run. */
  graceMs: number
  /** True when the unpin phase was deliberately not run. */
  skipped: boolean
  /** Machine-readable reason the unpin phase was skipped, or `null`. */
  skipReason: SkipReason | null
  /** True when this run was a shadow run: classification only, no Pinata writes. */
  dryRun: boolean
  /** CIDs that would have been unpinned but were not (skip, breaker, dry run). */
  wouldUnpin: string[]
  /** True when the mass-unpin circuit breaker refused the run. */
  circuitBreakerTripped: boolean
}

/** Why a run classified pins but did not unpin anything. */
export type SkipReason = 'not_ready' | 'dry_run' | 'circuit_breaker'

/**
 * Result of the pre-flight check a caller must pass before reconciliation is
 * allowed to delete anything. See `api/_lib/reconciliationReadiness.ts` for the
 * production implementation.
 */
export interface ReconciliationGate {
  ready: boolean
  /** Reason for refusal, surfaced in logs and the cron response. */
  detail?: string | null
}

/** Knobs for one reconciliation run. */
export interface ReconciliationOptions {
  /**
   * Pre-flight check. When it resolves to `ready: false` — or throws — the run
   * classifies nothing and unpins nothing. Omitted only in unit tests of the
   * classification itself.
   */
  checkReadiness?: (() => Promise<ReconciliationGate>) | undefined
  /** Shadow mode: log what would be unpinned, call Pinata for nothing. */
  dryRun?: boolean | undefined
  /** Override for the mass-unpin ratio; defaults to `MAX_UNPIN_RATIO`. */
  maxUnpinRatio?: number | undefined
  /** Manual override that lets a run exceed the ratio. Operator-only. */
  overrideCircuitBreaker?: boolean | undefined
}

/**
 * List all pins from the Pinata account, handling pagination.
 *
 * @param pageLimit Max rows per page (Pinata max: 1000)
 */
export async function listAllPins(pageLimit = 1000): Promise<PinataPin[]> {
  const allPins: PinataPin[] = []
  let pageOffset = 0
  let totalCount = 0

  do {
    const headers = pinataHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${PINATA_API_URL}/data/pinList`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        status: 'pinned',
        pageLimit,
        pageOffset,
      }),
    })

    if (!response.ok) {
      throw new Error(`Pinata pinList query failed (HTTP ${response.status})`)
    }

    const data = (await response.json()) as PinListResponse
    allPins.push(...data.rows)
    totalCount = data.count
    pageOffset += pageLimit
  } while (pageOffset < totalCount)

  return allPins
}

/**
 * Determine which pins are orphaned past the grace window.
 *
 * Pure function — no side effects, fully testable.
 *
 * @param pins       All pins from the Pinata account
 * @param cidInUse   Set of CIDs that are referenced by on-chain metadata events
 * @param now        Current timestamp (ms since epoch) — injectable for tests
 * @param graceMs    Grace window in ms
 * @returns          Pins to unpin and pins to preserve
 */
export function classifyPins(
  pins: PinataPin[],
  cidInUse: Set<string>,
  now: number = Date.now(),
  graceMs: number = GRACE_WINDOW_MS,
): { toUnpin: string[]; preserved: number } {
  const toUnpin: string[] = []
  let preserved = 0

  for (const pin of pins) {
    const cid = pin.ipfs_pin_hash
    if (cidInUse.has(cid)) {
      // Referenced by at least one on-chain metadata event — must keep.
      preserved++
      continue
    }

    const pinnedAt = new Date(pin.date_pinned).getTime()
    if (Number.isNaN(pinnedAt)) {
      // Unparseable date — preserve to be safe.
      preserved++
      continue
    }

    if (now - pinnedAt <= graceMs) {
      // Within grace window — may be an in-flight upload.
      preserved++
      continue
    }

    // Older than grace window and not referenced on-chain — orphan.
    toUnpin.push(cid)
  }

  return { toUnpin, preserved }
}

/**
 * Unpin a list of CIDs via the Pinata unpin API, best-effort.
 *
 * @returns {cleaned, errors, errorMessage}
 */
export async function unpinCids(cids: string[]): Promise<{
  cleaned: number
  errors: number
  errorMessage: string | null
}> {
  let cleaned = 0
  let errors = 0
  let errorMessage: string | null = null

  if (cids.length === 0) return { cleaned: 0, errors: 0, errorMessage: null }

  const headers = pinataHeaders()

  for (const cid of cids) {
    try {
      const response = await fetch(`${PINATA_API_URL}/pinning/unpin/${cid}`, {
        method: 'DELETE',
        headers,
      })
      // 404 means the CID was already gone — acceptable.
      if (response.ok || response.status === 404) {
        cleaned++
      } else {
        errors++
        errorMessage = `Unpin ${cid} failed (HTTP ${response.status})`
      }
    } catch {
      errors++
      errorMessage = `Unpin ${cid} threw a network error`
    }
  }

  return { cleaned, errors, errorMessage }
}

/**
 * Extract IPFS CIDs from a set of metadata URIs (which are in `ipfs://<cid>`
 * format).
 */
export function extractCidsFromMetadataUris(uris: string[]): Set<string> {
  const cids = new Set<string>()
  for (const uri of uris) {
    if (typeof uri !== 'string' || uri.length === 0) continue
    // Both `ipfs://<cid>` and bare `<cid>` are allowed.
    const m = uri.match(/^ipfs:\/\/(.+)$/)
    if (m) {
      cids.add(m[1])
    } else {
      // May be a bare CID — add as-is if it looks like one.
      if (/^[a-zA-Z0-9]{44,59}$/.test(uri)) {
        cids.add(uri)
      }
    }
  }
  return cids
}

/**
 * Run a full reconciliation cycle: check the safety gate, list pins, fetch the
 * on-chain reference set, classify, and unpin orphans.
 *
 * This is the high-level function called by the cron handler.
 *
 * Deleting a pin is irreversible — the original upload session and file are
 * long gone — so every step that could make the reference set wrong stops the
 * unpin phase entirely rather than proceeding with a partial set:
 *
 * - the caller's readiness gate says the indexer is degraded, mid-backfill or
 *   lagging (issue #1156);
 * - the reference-set query throws;
 * - the run would unpin more than `maxUnpinRatio` of the account.
 *
 * @param getMetadataUris  Callback that returns all on-chain metadata URIs
 *                         (injectable for tests; in production backed by the
 *                         indexer store)
 * @param now              Overrideable timestamp for testing
 * @param options          Readiness gate, dry-run and circuit-breaker knobs
 */
export async function runReconciliation(
  getMetadataUris: () => Promise<string[]>,
  now: number = Date.now(),
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  const graceMs = GRACE_WINDOW_MS
  const dryRun = options.dryRun === true
  const maxUnpinRatio = options.maxUnpinRatio ?? MAX_UNPIN_RATIO

  const base = {
    checked: 0,
    preserved: 0,
    cleaned: 0,
    errors: 0,
    errorMessage: null as string | null,
    graceMs,
    skipped: false,
    skipReason: null as SkipReason | null,
    dryRun,
    wouldUnpin: [] as string[],
    circuitBreakerTripped: false,
  }

  // 0. Safety gate — refuse to classify anything as orphaned while the
  //    reference set cannot be trusted to be complete.
  if (options.checkReadiness) {
    let gate: ReconciliationGate
    try {
      gate = await options.checkReadiness()
    } catch (err) {
      gate = {
        ready: false,
        detail: `readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    if (!gate.ready) {
      const detail = gate.detail ?? 'indexer is not in a trustworthy state'
      console.warn(`[pin-reconciliation] skipping unpin phase — ${detail}`)
      return {
        ...base,
        skipped: true,
        skipReason: 'not_ready',
        errorMessage: `Reconciliation skipped: ${detail}`,
      }
    }
  }

  // 1. List all pins
  let pins: PinataPin[]
  try {
    pins = await listAllPins()
  } catch (err) {
    return {
      ...base,
      errorMessage: `Failed to list pins: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // 2. Get on-chain metadata URIs
  let metadataUris: string[]
  try {
    metadataUris = await getMetadataUris()
  } catch (err) {
    return {
      ...base,
      checked: pins.length,
      preserved: pins.length,
      skipped: true,
      skipReason: 'not_ready',
      errorMessage: `Failed to query on-chain metadata: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const cidInUse = extractCidsFromMetadataUris(metadataUris)

  // 3. Classify
  const { toUnpin, preserved } = classifyPins(pins, cidInUse, now, graceMs)

  // 4. Circuit breaker — a run that wants to delete a large fraction of the
  //    account is far more likely to be reading a bad reference set than to
  //    have found that much genuine garbage.
  const ratio = pins.length > 0 ? toUnpin.length / pins.length : 0
  if (
    toUnpin.length > UNPIN_RATIO_FLOOR &&
    ratio > maxUnpinRatio &&
    options.overrideCircuitBreaker !== true
  ) {
    const pct = (ratio * 100).toFixed(1)
    const limitPct = (maxUnpinRatio * 100).toFixed(1)
    console.error(
      `[pin-reconciliation] circuit breaker tripped: ${toUnpin.length}/${pins.length} pins ` +
        `(${pct}%) would be unpinned, limit ${limitPct}%. Refusing; re-run with the manual ` +
        `override once the reference set has been verified.`,
    )
    return {
      ...base,
      checked: pins.length,
      preserved,
      skipped: true,
      skipReason: 'circuit_breaker',
      circuitBreakerTripped: true,
      wouldUnpin: toUnpin,
      errorMessage: `Circuit breaker: ${toUnpin.length}/${pins.length} pins (${pct}%) exceed the ${limitPct}% per-run unpin limit`,
    }
  }

  // 5. Shadow mode — report the decision without touching Pinata.
  if (dryRun) {
    console.warn(
      `[pin-reconciliation] dry run: would unpin ${toUnpin.length}/${pins.length} pins` +
        (toUnpin.length > 0 ? ` — ${toUnpin.join(', ')}` : ''),
    )
    return {
      ...base,
      checked: pins.length,
      preserved,
      skipped: true,
      skipReason: 'dry_run',
      wouldUnpin: toUnpin,
    }
  }

  // 6. Unpin orphans
  const { cleaned, errors, errorMessage } = await unpinCids(toUnpin)

  return {
    ...base,
    checked: pins.length,
    preserved,
    cleaned,
    errors,
    errorMessage,
  }
}
