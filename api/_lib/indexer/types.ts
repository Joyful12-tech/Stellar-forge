/**
 * Core types for the off-chain contract-event indexer (issue #943).
 *
 * The indexer is a read-optimization layer, never a source of truth: every
 * value it serves is re-derivable from the chain, and the frontend must always
 * be able to fall back to direct RPC. See `.kiro/specs/contract-event-indexing/`.
 */

/** A token row as stored by the indexer. Mirrors the frontend `TokenInfo`. */
export interface IndexedToken {
  address: string
  /** Contract enumeration order (`DataKey::TokenIndex`), 1-based. */
  tokenIndex: number
  name: string
  symbol: string
  decimals: number
  creator: string
  /** Unix seconds, from the contract's `created_at`. */
  createdAt: number
  metadataUri: string | null
  /** Which ingest phase produced this row. */
  source: 'backfill' | 'event'
}

/** Single-row checkpoint that survives function restarts and makes lag queryable. */
export interface IndexerState {
  /** `getEvents` paging token; `null` before the first successful run. */
  lastCursor: string | null
  lastLedger: number | null
  /** Ledger close time as unix ms; drives the lag metric. */
  lastLedgerCloseTime: number | null
  lastRunAt: number | null
  lastError: string | null
  backfillComplete: boolean
}

export const EMPTY_STATE: IndexerState = {
  lastCursor: null,
  lastLedger: null,
  lastLedgerCloseTime: null,
  lastRunAt: null,
  lastError: null,
  backfillComplete: false,
}

/** Options for a keyset-paginated token listing. */
export interface ListTokensOptions {
  /** Restrict to one creator address. */
  creator?: string | undefined
  /**
   * Keyset cursor: return rows with `tokenIndex` strictly below this value.
   * Omit for the first page. Keyset rather than OFFSET so page cost does not
   * grow with depth.
   */
  cursor?: number | undefined
  /** Clamped to `[1, MAX_PAGE_LIMIT]` by the store. */
  limit: number
}

export interface ListTokensResult {
  tokens: IndexedToken[]
  /** Cursor for the next page, or `null` when the last page was returned. */
  nextCursor: string | null
}

/** A contract event as persisted by the indexer. */
export interface StoredEvent {
  tokenAddress: string
  ledgerSeq: number
  topic: string
  payload: unknown
  txHash: string | null
}

/** Options for paginated event listing. */
export interface ListEventsOptions {
  tokenAddress: string
  /** Keyset cursor: return events with `ledgerSeq` strictly below this value. */
  cursor?: number | undefined
  /** Clamped to `[1, MAX_PAGE_LIMIT]` by the store. */
  limit: number
}

export interface ListEventsResult {
  events: StoredEvent[]
  /** Cursor for the next page, or `null` when no older events exist. */
  nextCursor: string | null
}

/**
 * Persistence seam. Ingest and the read API are written against this interface
 * so both are testable without a live database, and so the Postgres driver
 * stays confined to one module.
 */
export interface TokenStore {
  /** Insert or update rows by `address`. Must be idempotent. */
  upsertTokens(tokens: IndexedToken[]): Promise<void>
  /** Set `metadataUri` for a token already present; a no-op when absent. */
  setMetadataUri(address: string, metadataUri: string): Promise<void>
  getToken(address: string): Promise<IndexedToken | null>
  listTokens(options: ListTokensOptions): Promise<ListTokensResult>
  /** Total indexed rows, used by reconciliation against `token_count`. */
  countTokens(): Promise<number>
  /** Which of `indices` already have a row, so backfill can skip them. */
  presentIndices(indices: number[]): Promise<Set<number>>
  getState(): Promise<IndexerState>
  /** Merge the provided fields into the checkpoint row. */
  saveState(patch: Partial<IndexerState>): Promise<void>
  /** Insert or replace events; must be idempotent on (tokenAddress, ledgerSeq, topic). */
  upsertEvents(events: StoredEvent[]): Promise<void>
  /** Keyset-paginated events for a token, newest-first by ledger. */
  listEvents(options: ListEventsOptions): Promise<ListEventsResult>
}

/** Server-side clamp on `limit`, per design.md. */
export const MAX_PAGE_LIMIT = 100
export const DEFAULT_PAGE_LIMIT = 20

/** Clamp an untrusted `limit` query parameter into the allowed range. */
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_LIMIT
  return Math.min(Math.trunc(n), MAX_PAGE_LIMIT)
}

/** Parse an untrusted keyset cursor; invalid values page from the start. */
export function parseCursor(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** When the indexed data was last current, as ISO-8601, or `null` if never. */
export function indexedAtIso(state: Pick<IndexerState, 'lastLedgerCloseTime'>): string | null {
  return state.lastLedgerCloseTime ? new Date(state.lastLedgerCloseTime).toISOString() : null
}
