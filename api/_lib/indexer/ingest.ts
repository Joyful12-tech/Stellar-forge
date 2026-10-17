/**
 * Ingest for the contract-event indexer (issue #943).
 *
 * Two phases, because the RPC only retains events for a bounded window:
 *
 * - **Phase A — backfill.** Enumerate `1..=token_count` via the factory's own
 *   view functions. This is the only phase that can recover tokens older than
 *   the event-retention window. Resumable and idempotent.
 * - **Phase B — steady state.** Page `getEvents` from the stored cursor and
 *   upsert what arrives.
 *
 * Delivery is **at-least-once**: the cursor advances only after a page has been
 * written, so a crash mid-run replays the range rather than skipping it. Every
 * write is an idempotent upsert, which is what makes replay safe.
 *
 * Reconciliation compares `COUNT(*)` against `token_count` on every run and
 * re-backfills any missing indices — the backstop that keeps at-least-once
 * delivery honest when a cursor range is lost entirely.
 */

import type { IndexedToken, TokenStore } from './types'

/** Token indices read per backfill batch, bounding one invocation's work. */
export const BACKFILL_BATCH_SIZE = 25

/** Maximum backfill batches per run, so a cron invocation always terminates. */
export const MAX_BACKFILL_BATCHES_PER_RUN = 8

/** Maximum `getEvents` pages walked per run. */
export const MAX_EVENT_PAGES_PER_RUN = 20

/**
 * The chain-facing reads ingest needs. Implemented over Soroban RPC in
 * production and stubbed in tests, so ingest logic is verifiable without a
 * network.
 */
export interface ChainReader {
  /** `get_state().token_count` — the authoritative number of tokens. */
  getTokenCount(): Promise<number>
  /**
   * `get_token_info(index)` plus the address it maps to. Resolves to `null`
   * when the index is absent, which a healthy factory should never produce
   * for `index <= token_count`.
   */
  getTokenByIndex(index: number): Promise<IndexedToken | null>
  /** One `getEvents` page starting at `cursor` (or from retention start). */
  getEventPage(cursor: string | null): Promise<EventPage>
}

export interface EventPage {
  events: IndexerEvent[]
  /** Paging token for the next page, or `null` at the head of the stream. */
  cursor: string | null
  latestLedger: number | null
  /** Close time of the newest ledger in this page, unix ms. */
  latestLedgerCloseTime: number | null
}

/**
 * All 15 event topics from the factory contract.
 *
 * The indexer persists all of them (for historical query and audit trails);
 * ingest only acts on 'created' and 'meta' to derive token rows, but the
 * event store captures the full stream.
 */
export type IndexerEvent =
  | { type: 'created'; token: IndexedToken }
  | { type: 'meta'; address: string; metadataUri: string }
  | { type: 'mint'; tokenAddress: string; to: string; amount: string; txHash: string | null }
  | { type: 'burn'; tokenAddress: string; from: string; amount: string; txHash: string | null }
  | {
      type: 'transfer'
      tokenAddress: string
      from: string
      to: string
      amount: string
      txHash: string | null
    }
  | {
      type: 'approval'
      tokenAddress: string
      owner: string
      spender: string
      amount: string
      txHash: string | null
    }
  | {
      type: 'fees'
      tokenAddress: string
      baseFee: string
      metadataFee: string
      txHash: string | null
    }
  | { type: 'pause'; tokenAddress: string; txHash: string | null }
  | { type: 'unpause'; tokenAddress: string; txHash: string | null }
  | { type: 'adm_upd'; tokenAddress: string; newAdmin: string; txHash: string | null }
  | { type: 'wl_add'; tokenAddress: string; address: string; txHash: string | null }
  | { type: 'wl_rem'; tokenAddress: string; address: string; txHash: string | null }
  | { type: 'wl_tog'; tokenAddress: string; txHash: string | null }
  | { type: 'meta_frz'; tokenAddress: string; txHash: string | null }
  | {
      type: 'split_set'
      tokenAddress: string
      splitAmount: string
      splitValue: string
      txHash: string | null
    }
  | { type: 'split_clr'; tokenAddress: string; txHash: string | null }

export interface IngestResult {
  backfilled: number
  eventsApplied: number
  reconciled: number
  backfillComplete: boolean
  tokenCount: number
  indexedCount: number
  error: string | null
}

/**
 * Read every index in `indices` that is not already stored and upsert it.
 * Returns the number of rows written.
 */
async function backfillIndices(
  store: TokenStore,
  chain: ChainReader,
  indices: number[],
): Promise<number> {
  if (indices.length === 0) return 0

  const present = await store.presentIndices(indices)
  const missing = indices.filter((i) => !present.has(i))
  if (missing.length === 0) return 0

  const rows: IndexedToken[] = []
  for (const index of missing) {
    const token = await chain.getTokenByIndex(index)
    // A gap here means the factory returned TokenNotFound for an index within
    // `token_count`. Skip it rather than aborting the batch: reconciliation
    // will retry it on the next run, and one bad index must not stall ingest.
    if (token) rows.push({ ...token, source: 'backfill' })
  }

  await store.upsertTokens(rows)
  return rows.length
}

/**
 * Phase A. Walks forward from the highest index already stored, in bounded
 * batches, so a factory too large to ingest in one invocation finishes across
 * several cron runs.
 */
async function runBackfill(
  store: TokenStore,
  chain: ChainReader,
  tokenCount: number,
): Promise<number> {
  let written = 0

  for (let batch = 0; batch < MAX_BACKFILL_BATCHES_PER_RUN; batch++) {
    const indexed = await store.countTokens()
    if (indexed >= tokenCount) break

    // Candidate window: the next BACKFILL_BATCH_SIZE indices at or above the
    // count already stored. `presentIndices` filters out anything a `created`
    // event already inserted, so gaps are closed rather than skipped.
    const start = indexed + 1
    const end = Math.min(start + BACKFILL_BATCH_SIZE - 1, tokenCount)
    if (start > end) break

    const window: number[] = []
    for (let i = start; i <= end; i++) window.push(i)

    const count = await backfillIndices(store, chain, window)
    written += count

    // No progress on a full window of missing indices means the chain reader
    // is failing for this range; stop rather than spinning the whole budget.
    if (count === 0) break
  }

  return written
}

/**
 * Phase B. Pages `getEvents` from the stored cursor, applying `created` and
 * `meta` events. The checkpoint advances only after each page is written.
 */
async function runSteadyState(
  store: TokenStore,
  chain: ChainReader,
): Promise<{
  applied: number
  lastLedger: number | null
  lastCloseTime: number | null
}> {
  const state = await store.getState()
  let cursor = state.lastCursor
  let applied = 0
  let lastLedger = state.lastLedger
  let lastCloseTime = state.lastLedgerCloseTime

  for (let page = 0; page < MAX_EVENT_PAGES_PER_RUN; page++) {
    const result = await chain.getEventPage(cursor)

    const created = result.events
      .filter((e): e is Extract<IndexerEvent, { type: 'created' }> => e.type === 'created')
      .map((e) => ({ ...e.token, source: 'event' as const }))

    if (created.length > 0) await store.upsertTokens(created)

    for (const event of result.events) {
      if (event.type === 'meta') await store.setMetadataUri(event.address, event.metadataUri)
    }
    applied += result.events.length

    if (result.latestLedger !== null) lastLedger = result.latestLedger
    if (result.latestLedgerCloseTime !== null) lastCloseTime = result.latestLedgerCloseTime

    // Persist the checkpoint per page, so a crash on page N+1 does not replay
    // pages 1..N. Advancing only after the write keeps delivery at-least-once.
    cursor = result.cursor
    await store.saveState({
      lastCursor: cursor,
      lastLedger,
      lastLedgerCloseTime: lastCloseTime,
    })

    // A null cursor means we reached the head of the stream.
    if (result.cursor === null) break
  }

  return { applied, lastLedger, lastCloseTime }
}

/**
 * Run one full ingest cycle: backfill (if incomplete), steady-state events,
 * then reconciliation.
 *
 * Never throws. A failure is recorded in `last_error` and returned, leaving
 * the cursor wherever the last successful page put it so the next run retries
 * the same range instead of skipping past it.
 */
export async function runIngest(store: TokenStore, chain: ChainReader): Promise<IngestResult> {
  const result: IngestResult = {
    backfilled: 0,
    eventsApplied: 0,
    reconciled: 0,
    backfillComplete: false,
    tokenCount: 0,
    indexedCount: 0,
    error: null,
  }

  try {
    const tokenCount = await chain.getTokenCount()
    result.tokenCount = tokenCount

    const state = await store.getState()

    if (!state.backfillComplete) {
      result.backfilled = await runBackfill(store, chain, tokenCount)
    }

    const steady = await runSteadyState(store, chain)
    result.eventsApplied = steady.applied

    // ── Reconciliation ──────────────────────────────────────────────────
    // `COUNT(*)` below `token_count` means an event was missed or a cursor
    // range was lost. Re-read the specific missing indices rather than
    // restarting the whole backfill.
    let indexed = await store.countTokens()
    if (indexed < tokenCount) {
      const all: number[] = []
      for (let i = 1; i <= tokenCount; i++) all.push(i)
      const present = await store.presentIndices(all)
      const missing = all.filter((i) => !present.has(i)).slice(0, BACKFILL_BATCH_SIZE)
      result.reconciled = await backfillIndices(store, chain, missing)
      indexed = await store.countTokens()
    }

    result.indexedCount = indexed
    result.backfillComplete = indexed >= tokenCount

    await store.saveState({
      lastRunAt: Date.now(),
      lastError: null,
      backfillComplete: result.backfillComplete,
    })
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    await store.saveState({ lastRunAt: Date.now(), lastError: result.error })
  }

  return result
}

/** Lag in seconds between now and the newest ledger the indexer has seen. */
export function lagSeconds(
  state: { lastLedgerCloseTime: number | null },
  now = Date.now(),
): number | null {
  if (state.lastLedgerCloseTime === null) return null
  return Math.max(0, Math.round((now - state.lastLedgerCloseTime) / 1000))
}

/** Warning threshold from design.md's monitoring table. */
export const LAG_WARNING_SECONDS = 15 * 60
/** Paging threshold from design.md's monitoring table. */
export const LAG_CRITICAL_SECONDS = 60 * 60
