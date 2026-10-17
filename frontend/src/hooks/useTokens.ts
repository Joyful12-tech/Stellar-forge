import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { stellarService } from '../services/stellar'
import { STELLAR_CONFIG } from '../config/stellar'
import type { TokenInfo } from '../types'

// ── Module-level cache keyed by creator address ('' = all tokens) ─────────────
// Shared across all hook instances — any component mounting within the TTL
// window reuses the same result without an extra network round-trip.
//
// LRU eviction: JavaScript's Map preserves insertion order, so we implement
// LRU by deleting and re-inserting a key on every read or write (moving it
// to the "most-recently-used" tail). When the map exceeds CACHE_MAX_SIZE the
// first (oldest / least-recently-used) entry is evicted. This caps memory
// use regardless of how many distinct creator addresses are queried in a
// long-lived session (e.g. the Token Explorer browsing hundreds of creators).

const CACHE_TTL_MS = 30_000
/** Maximum number of creator-keyed entries kept in memory at one time. */
export const CACHE_MAX_SIZE = 50

interface CacheEntry {
  tokens: TokenInfo[]
  fetchedAt: number
  /**
   * Server-reported total for global (all-tokens) pages. Undefined for
   * creator-keyed entries, whose total is simply `tokens.length`.
   */
  total?: number
}

const cache = new Map<string, CacheEntry>()

// ── Global "all tokens" page cache ──────────────────────────────────────────
//
// Global pages are server-paginated via `getAllTokens(offset, limit)` and
// cached per (network, contractId, pageSize, page) so navigating back and
// forth between pages does not re-hit the RPC within the TTL window. Keeping
// the key network/contract-scoped means switching network or factory never
// serves a stale page from a different chain.

const GLOBAL_KEY_PREFIX = 'all'

function globalPageKey(page: number, pageSize: number): string {
  return `${GLOBAL_KEY_PREFIX}:${STELLAR_CONFIG.network}:${STELLAR_CONFIG.factoryContractId}:${pageSize}:${page}`
}

/**
 * Drop every cached global page for the current (network, contractId). Called
 * on `refresh()` in global mode — e.g. after a confirmed `created` event
 * invalidates the list (see App's CreateTokenWrapper) — so a new token shows
 * up without waiting for the TTL to lapse.
 */
function invalidateGlobalPages(): void {
  const prefix = `${GLOBAL_KEY_PREFIX}:${STELLAR_CONFIG.network}:${STELLAR_CONFIG.factoryContractId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/**
 * Read an entry and promote it to most-recently-used.
 * Returns undefined on a cache miss.
 */
function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key)
  if (entry === undefined) return undefined
  // Re-insert to move to tail (most-recently-used position).
  cache.delete(key)
  cache.set(key, entry)
  return entry
}

/**
 * Write an entry, promote it to MRU, and evict the LRU entry when the cap
 * is exceeded.
 */
function cacheSet(key: string, entry: CacheEntry): void {
  // Delete first so a re-write moves the key to the tail.
  cache.delete(key)
  cache.set(key, entry)
  if (cache.size > CACHE_MAX_SIZE) {
    // The first key in iteration order is the least-recently-used one.
    const lruKey = cache.keys().next().value
    if (lruKey !== undefined) {
      cache.delete(lruKey)
    }
  }
}

/** Exposed for testing only */
export function _clearCache() {
  cache.clear()
}

// ── Paginated token fetcher ────────────────────────────────────────────────────
//
// The contract's `get_tokens_by_creator(env, creator, offset, limit)` view
// function caps responses at MAX_TOKENS_BY_CREATOR_PAGE (50) per call to
// avoid exceeding Stellar ledger entry size limits on mainnet.
//
// Performance rationale
// ─────────────────────
// BEFORE (sequential): each page was awaited individually, so a creator with
//   N pages incurred N × RPC-latency wall-clock time (e.g. 10 pages × ~400 ms
//   = ~4 s before the UI could render anything).
//
// AFTER (concurrent): page 0 is still fetched first to establish (a) that
//   there is more data and (b) the page size in use.  Once we know how many
//   additional pages exist we issue them all at once — capped at
//   CONCURRENT_PAGE_LIMIT simultaneous in-flight requests to avoid
//   overwhelming the RPC endpoint or tripping rate limits.  For the same
//   10-page example the total wait drops to roughly 1 × RPC-latency for the
//   probe page + 1 × RPC-latency for the concurrent batch ≈ ~800 ms — an
//   ~80 % wall-clock reduction on a latency-bound path.
//
// Concurrency cap
// ───────────────
// CONCURRENT_PAGE_LIMIT = 5 was chosen to stay comfortably below typical
// Soroban RPC per-IP rate limits while still saturating a reasonable number
// of parallel connections.  For reference, issue #16 flags concern about
// total RPC load; 5 concurrent views per hook call is a reasonable balance.

/** Maximum simultaneous in-flight getTokensByCreator requests for pages ≥ 1 */
const CONCURRENT_PAGE_LIMIT = 5

/**
 * Hard upper bound on pages fetched for one creator, to prevent runaway
 * requests if the contract ever returned a full page at the very end
 * (defensive; the contract guarantees a short page at end-of-data).
 */
const MAX_CREATOR_PAGES = 10_000

async function fetchAllTokensByCreator(creator: string): Promise<TokenInfo[]> {
  if (!STELLAR_CONFIG.factoryContractId) {
    throw new Error('VITE_FACTORY_CONTRACT_ID is not configured')
  }

  // Mirror the contract's per-page cap so successive calls advance correctly.
  const pageSize = 50

  // ── Phase 1: probe page 0 ─────────────────────────────────────────────────
  // Fetching page 0 first tells us whether there is more data (returned a full
  // page) without needing a separate get_state() call, keeping the happy-path
  // cost at a single extra round-trip only when multiple pages exist.
  const firstPage = await stellarService.getTokensByCreator(creator, 0, pageSize)

  if (firstPage.length < pageSize) {
    // All tokens fit in one page — no concurrent work needed.
    return firstPage
  }

  // ── Phase 2: fetch the remaining pages concurrently, in batches ───────────
  // We do NOT know the exact total upfront (get_state().token_count is a
  // global count, not per-creator), so we request CONCURRENT_PAGE_LIMIT pages
  // at a time and stop at the first short (or empty) page — pages past the
  // end simply come back empty.
  const collected: TokenInfo[] = [...firstPage]

  for (let batchStart = 1; batchStart < MAX_CREATOR_PAGES; batchStart += CONCURRENT_PAGE_LIMIT) {
    const batchEnd = Math.min(batchStart + CONCURRENT_PAGE_LIMIT, MAX_CREATOR_PAGES)
    const pageNumbers = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
    const pages = await Promise.all(
      pageNumbers.map((p) => stellarService.getTokensByCreator(creator, p * pageSize, pageSize)),
    )

    for (const page of pages) {
      collected.push(...page)
      if (page.length < pageSize) return collected
    }
  }

  return collected
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseTokensResult {
  /** Tokens for the current page (1-based) */
  tokens: TokenInfo[]
  /**
   * The full working set backing `tokens`. In creator mode this is every
   * token for that creator (sliced client-side into `tokens`); in global mode
   * the server already returns one page at a time, so this equals `tokens`.
   * Kept for backward-compatibility with earlier consumers.
   */
  allTokens: TokenInfo[]
  isLoading: boolean
  error: Error | null
  /** Current 1-based page number */
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  /** Bypass cache and re-fetch from the contract */
  refresh: () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTokens(creator?: string): UseTokensResult {
  // Two data paths share this hook:
  //   • Creator mode (`creator` given): the contract's paginated
  //     `get_tokens_by_creator` view is walked to completion once, cached by
  //     creator address, and sliced client-side for page navigation.
  //   • Global mode (no `creator`): the "all tokens" list is server-paginated
  //     via `getAllTokens(offset, limit)` — one page per fetch, newest-first,
  //     cached per (network, contractId, pageSize, page).
  const isGlobal = !creator
  const creatorKey = creator ?? ''

  const [tokens, setTokens] = useState<TokenInfo[]>(() =>
    isGlobal ? [] : (cacheGet(creatorKey)?.tokens ?? []),
  )
  // Server-reported total, used only in global mode (creator mode derives its
  // total from the accumulated list length).
  const [serverTotal, setServerTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [page, setPageRaw] = useState(1)
  const [pageSize, setPageSizeRaw] = useState(10)

  // Creator mode: prevent duplicate in-flight requests when multiple
  // components mount at once.
  const fetchingRef = useRef(false)
  // Global mode: "latest request wins". Page navigation can supersede an
  // in-flight fetch, so responses tagged with a stale id are discarded rather
  // than clobbering the page the user actually navigated to.
  const requestIdRef = useRef(0)

  const loadCreator = useCallback(
    async (bypassCache: boolean) => {
      const now = Date.now()
      const hit = cacheGet(creatorKey)

      if (!bypassCache && hit && now - hit.fetchedAt < CACHE_TTL_MS) {
        setTokens(hit.tokens)
        return
      }

      if (fetchingRef.current) return
      fetchingRef.current = true

      setIsLoading(true)
      setError(null)

      try {
        const result = await fetchAllTokensByCreator(creatorKey)
        cacheSet(creatorKey, { tokens: result, fetchedAt: Date.now() })
        setTokens(result)
        setPageRaw(1)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setIsLoading(false)
        fetchingRef.current = false
      }
    },
    [creatorKey],
  )

  const loadGlobalPage = useCallback(
    async (targetPage: number, size: number, bypassCache: boolean) => {
      if (bypassCache) invalidateGlobalPages()

      const key = globalPageKey(targetPage, size)
      const now = Date.now()
      const hit = cacheGet(key)

      if (!bypassCache && hit && now - hit.fetchedAt < CACHE_TTL_MS) {
        setTokens(hit.tokens)
        setServerTotal(hit.total ?? hit.tokens.length)
        return
      }

      const reqId = ++requestIdRef.current
      setIsLoading(true)
      setError(null)

      try {
        const { tokens: pageTokens, total } = await stellarService.getAllTokens(
          (targetPage - 1) * size,
          size,
        )
        if (reqId !== requestIdRef.current) return // superseded by a newer page
        cacheSet(key, { tokens: pageTokens, total, fetchedAt: Date.now() })
        setTokens(pageTokens)
        setServerTotal(total)
      } catch (err) {
        if (reqId !== requestIdRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (reqId === requestIdRef.current) setIsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const load = isGlobal ? () => loadGlobalPage(page, pageSize, false) : () => loadCreator(false)
    load()
  }, [isGlobal, page, pageSize, loadGlobalPage, loadCreator])

  const refresh = useCallback(() => {
    if (isGlobal) return loadGlobalPage(page, pageSize, true)
    return loadCreator(true)
  }, [isGlobal, page, pageSize, loadGlobalPage, loadCreator])

  const totalCount = isGlobal ? serverTotal : tokens.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const setPage = useCallback(
    (p: number) => setPageRaw(Math.min(Math.max(1, p), totalPages)),
    [totalPages],
  )

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(Math.max(1, size))
    setPageRaw(1)
  }, [])

  // In global mode `tokens` already holds exactly the current server page. In
  // creator mode it holds the full accumulated list, sliced to the page here.
  const visible = useMemo(() => {
    if (isGlobal) return tokens
    const start = (page - 1) * pageSize
    return tokens.slice(start, start + pageSize)
  }, [isGlobal, tokens, page, pageSize])

  return {
    tokens: visible,
    allTokens: tokens,
    isLoading,
    error,
    page,
    pageSize,
    totalCount,
    totalPages,
    setPage,
    setPageSize,
    refresh,
  }
}
