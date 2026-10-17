/**
 * `TokenSource` — the seam that lets token reads come from the off-chain
 * indexer while always remaining able to fall back to direct RPC
 * (issue #943, spec milestone M4).
 *
 * The indexer is a read-optimization layer, never a source of truth. Every
 * value it serves is re-derivable from the chain, so a broken, slow, or stale
 * indexer must degrade to RPC rather than degrade correctness. The composer
 * below implements the four fallback branches from the design:
 *
 *   indexer ok and fresh    -> return indexed data
 *   indexer error/timeout   -> RPC, log downgrade
 *   indexer lag > MAX_LAG   -> RPC, log downgrade
 *   indexer 404 on address  -> RPC (the token may be newer than the last ingest)
 *
 * Rollback is the feature flag: point `TokenSource` at RPC only. Because the
 * indexer is never authoritative, that loses speed, not data.
 */

import type { TokenInfo } from '../types'
import { logger } from '../utils/logger'

export interface TokenPage {
  tokens: TokenInfo[]
  total: number
}

export interface TokenSource {
  getAllTokens(offset: number, limit: number, tokenCountSnapshot?: number): Promise<TokenPage>
  getTokenInfoByAddress(address: string): Promise<TokenInfo>
}

/** Reasons a read was served by RPC instead of the indexer. */
export type DowngradeReason = 'disabled' | 'error' | 'timeout' | 'stale' | 'not-found'

export interface FallbackOptions {
  /**
   * Deadline for an indexer call. A slow indexer must degrade to RPC, never
   * stall the page.
   */
  timeoutMs?: number
  /**
   * Maximum tolerated indexer lag in seconds. Beyond this the data is treated
   * as stale and RPC is used instead.
   */
  maxLagSeconds?: number
  /** Called on every downgrade, so the degradation rate stays observable. */
  onDowngrade?: (reason: DowngradeReason) => void
}

export const DEFAULT_TIMEOUT_MS = 2_000
export const DEFAULT_MAX_LAG_SECONDS = 15 * 60

/** Reject if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new IndexerTimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export class IndexerTimeoutError extends Error {
  constructor() {
    super('Indexer request timed out')
    this.name = 'IndexerTimeoutError'
  }
}

/** Thrown when the indexer has no row for an address — never authoritative. */
export class IndexerNotFoundError extends Error {
  constructor(address: string) {
    super(`Token ${address} is not indexed`)
    this.name = 'IndexerNotFoundError'
  }
}

export class IndexerStaleError extends Error {
  constructor(public readonly lagSeconds: number) {
    super(`Indexer is ${lagSeconds}s behind`)
    this.name = 'IndexerStaleError'
  }
}

/**
 * Compose an indexer source with an RPC source.
 *
 * Any failure mode of the indexer resolves to the RPC result; the indexer can
 * only ever make reads faster, never change whether they succeed.
 */
export function createFallbackTokenSource(
  indexer: TokenSource,
  rpc: TokenSource,
  options: FallbackOptions = {},
): TokenSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const onDowngrade = options.onDowngrade

  function downgrade(reason: DowngradeReason, err?: unknown): void {
    onDowngrade?.(reason)
    logger.warn(`Token read downgraded to RPC (${reason})`, err)
  }

  function classify(err: unknown): DowngradeReason {
    if (err instanceof IndexerTimeoutError) return 'timeout'
    if (err instanceof IndexerStaleError) return 'stale'
    if (err instanceof IndexerNotFoundError) return 'not-found'
    return 'error'
  }

  return {
    async getAllTokens(
      offset: number,
      limit: number,
      tokenCountSnapshot?: number,
    ): Promise<TokenPage> {
      try {
        return await withTimeout(indexer.getAllTokens(offset, limit, tokenCountSnapshot), timeoutMs)
      } catch (err) {
        downgrade(classify(err), err)
        return rpc.getAllTokens(offset, limit, tokenCountSnapshot)
      }
    },

    async getTokenInfoByAddress(address: string): Promise<TokenInfo> {
      try {
        return await withTimeout(indexer.getTokenInfoByAddress(address), timeoutMs)
      } catch (err) {
        // A 404 here is a cache miss, not proof of non-existence: a token
        // created since the last ingest run is legitimately absent. Falling
        // through to RPC is what stops the indexer turning "too new" into
        // "does not exist".
        downgrade(classify(err), err)
        return rpc.getTokenInfoByAddress(address)
      }
    },
  }
}

interface IndexedTokenPayload {
  address: string
  tokenIndex: number
  name: string
  symbol: string
  decimals: number
  creator: string
  createdAt: number
  metadataUri: string | null
}

function toTokenInfo(payload: IndexedTokenPayload): TokenInfo {
  const info: TokenInfo = {
    name: payload.name,
    symbol: payload.symbol,
    decimals: payload.decimals,
    creator: payload.creator,
    createdAt: payload.createdAt,
    index: payload.tokenIndex,
  }
  if (payload.metadataUri) info.metadataUri = payload.metadataUri
  return info
}

/** Seconds of lag implied by an `indexedAt` timestamp, or null when unknown. */
function lagFrom(indexedAt: string | null | undefined, now = Date.now()): number | null {
  if (!indexedAt) return null
  const parsed = Date.parse(indexedAt)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.round((now - parsed) / 1000))
}

export interface IndexerSourceOptions {
  baseUrl?: string
  maxLagSeconds?: number
  fetchImpl?: typeof fetch
}

/** A `TokenSource` backed by the indexer's read API. */
export function createIndexerTokenSource(options: IndexerSourceOptions = {}): TokenSource {
  const baseUrl = options.baseUrl ?? ''
  const maxLagSeconds = options.maxLagSeconds ?? DEFAULT_MAX_LAG_SECONDS
  const doFetch = options.fetchImpl ?? fetch

  /** Reject when the payload is too far behind to be presented as current. */
  function assertFresh(indexedAt: string | null | undefined): void {
    const lag = lagFrom(indexedAt)
    if (lag !== null && lag > maxLagSeconds) throw new IndexerStaleError(lag)
  }

  return {
    async getAllTokens(
      offset: number,
      limit: number,
      _tokenCountSnapshot?: number,
    ): Promise<TokenPage> {
      // The read API is keyset-paginated, but the existing callers are
      // offset-based. Request one page of `limit` starting at the cursor
      // implied by `offset`; `total` comes from the indexed count.
      const params = new URLSearchParams({ limit: String(limit) })
      if (offset > 0) params.set('cursor', String(offset))

      const res = await doFetch(`${baseUrl}/api/tokens?${params.toString()}`)
      if (!res.ok) throw new Error(`Indexer returned ${res.status}`)

      const body = (await res.json()) as {
        tokens: IndexedTokenPayload[]
        nextCursor: string | null
        indexedAt: string | null
      }
      assertFresh(body.indexedAt)

      const tokens = body.tokens.map(toTokenInfo)
      // Without a separate count call, the highest index seen is the best
      // available lower bound on the total.
      const highest = tokens.length > 0 ? Math.max(...tokens.map((t) => t.index ?? 0)) : 0

      return { tokens, total: Math.max(highest, offset + tokens.length) }
    },

    async getTokenInfoByAddress(address: string): Promise<TokenInfo> {
      const res = await doFetch(`${baseUrl}/api/tokens/${encodeURIComponent(address)}`)

      if (res.status === 404) throw new IndexerNotFoundError(address)
      if (!res.ok) throw new Error(`Indexer returned ${res.status}`)

      const body = (await res.json()) as IndexedTokenPayload & { indexedAt: string | null }
      assertFresh(body.indexedAt)

      return toTokenInfo(body)
    },
  }
}
