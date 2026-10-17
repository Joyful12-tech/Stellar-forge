import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useStellarContext } from '../context/StellarContext'
import { useNetwork } from '../context/NetworkContext'
import { ipfsService } from '../services/ipfs'
import { STELLAR_CONFIG } from '../config/stellar'
import { fetchAllContractEvents } from '../utils/fetchAllContractEvents'
import { buildTokenEventIndex, type TokenEventIndex } from '../utils/tokenEventIndex'
import type { TokenInfo, IPFSMetadata } from '../types'

export const EXPLORER_PAGE_SIZE = 10

export interface TokenWithMetadata extends TokenInfo {
  address: string
  metadata?: IPFSMetadata | null
}

/** IPFS metadata for `uri`, or `null` — a metadata failure is never fatal. */
export async function fetchMetadataOrNull(uri: string | undefined): Promise<IPFSMetadata | null> {
  if (!uri) return null
  try {
    return (await ipfsService.getMetadata(uri)) as IPFSMetadata
  } catch {
    return null
  }
}

export interface UseExplorerTokensResult {
  tokens: TokenWithMetadata[]
  totalTokens: number
  loading: boolean
  /** Non-null when the page fetch failed — distinct from an empty factory. */
  error: Error | null
  currentPage: number
  setCurrentPage: Dispatch<SetStateAction<number>>
  /** Re-snapshot the token count and reload from page 1. */
  refresh: () => void
  /** Retry the current page after a failure, bypassing its cache entry. */
  retry: () => void
  /** Contract address of the token at a 1-based index, from factory events. */
  resolveIndexAddress: (index: number) => Promise<string | undefined>
}

/**
 * Newest-first pages of the factory's token list for the Token Explorer,
 * enriched with each token's address and IPFS metadata.
 *
 * Pages come from the authoritative index-range view (`getAllTokens`) and are
 * pinned to a session-scoped `tokenCount` snapshot, read once on mount (or on
 * an explicit refresh), so tokens created concurrently cannot shift the window
 * between page 1 and page 2 and produce duplicates or gaps.
 */
export function useExplorerTokens(): UseExplorerTokensResult {
  const { stellarService } = useStellarContext()
  const { network } = useNetwork()
  const contractId = STELLAR_CONFIG.factoryContractId || ''

  const [currentPage, setCurrentPage] = useState(1)
  const [totalTokens, setTotalTokens] = useState(0)
  const [tokens, setTokens] = useState<TokenWithMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // Bumped to force a re-fetch (retry / refresh) without changing page.
  const [reloadNonce, setReloadNonce] = useState(0)

  /**
   * `undefined` while the snapshot is being fetched or after it is cleared —
   * the next page fetch re-reads it from `getFactoryState()`.
   */
  const tokenCountSnapshotRef = useRef<number | undefined>(undefined)

  // Per-mount page cache keyed by (network, contractId, pageSize, page). The
  // key embeds network + contract so a page from another chain is never served
  // after a network switch. Created-event invalidation for shared app state
  // lives in the useTokens hook; here a stale cache is bypassed via
  // `reloadNonce`. Only ever read/written inside effects, never during render.
  const pageCacheRef = useRef<Map<string, { tokens: TokenInfo[]; total: number }>>(new Map())
  const eventIndexRef = useRef<(TokenEventIndex & { key: string }) | null>(null)

  const pageCacheKey = useCallback(
    (page: number) => `${network}:${contractId}:${EXPLORER_PAGE_SIZE}:${page}`,
    [network, contractId],
  )

  // Build (and memoise) the event-derived correlation. Paginated via
  // fetchAllContractEvents — a single capped getContractEvents() call would
  // silently drop the newest tokens once history exceeds one page.
  const getEventIndex = useCallback(async (): Promise<TokenEventIndex> => {
    const key = `${network}:${contractId}`
    if (eventIndexRef.current?.key === key) return eventIndexRef.current

    const events = await fetchAllContractEvents(stellarService, contractId)
    const index = { key, ...buildTokenEventIndex(events) }
    eventIndexRef.current = index
    return index
  }, [network, contractId, stellarService])

  // Enrich an authoritative index-range page with token address + metadata.
  // Best-effort: if events are unavailable the tokens still render (without a
  // detail link or image) rather than disappearing.
  const enrichPage = useCallback(
    async (infoPage: TokenInfo[]): Promise<TokenWithMetadata[]> => {
      const eventIndex = await getEventIndex().catch(() => null)

      return Promise.all(
        infoPage.map(async (info) => {
          const address =
            info.index != null ? (eventIndex?.indexToAddress.get(info.index) ?? '') : ''
          const metadataUri =
            info.metadataUri ?? (address ? eventIndex?.addressToMeta.get(address) : undefined)

          const enriched: TokenWithMetadata = {
            ...info,
            address,
            metadata: await fetchMetadataOrNull(metadataUri),
          }
          if (metadataUri !== undefined) enriched.metadataUri = metadataUri
          return enriched
        }),
      )
    },
    [getEventIndex],
  )

  // Load the current page, newest-first. "Latest request wins": a superseded
  // page fetch is discarded so rapid navigation cannot leave a stale page
  // rendered.
  useEffect(() => {
    let cancelled = false

    // eslint-disable-next-line react-hooks/set-state-in-effect -- entering the loading state is the first step of the page fetch this effect exists to run; see #1002 follow-up
    setLoading(true)
    setError(null)

    async function run() {
      try {
        // Snapshot tokenCount once per session so all page windows are
        // computed against the same baseline.
        if (tokenCountSnapshotRef.current === undefined) {
          const state = await stellarService.getFactoryState()
          if (cancelled) return
          tokenCountSnapshotRef.current = state.tokenCount
        }

        const key = pageCacheKey(currentPage)
        const cached = pageCacheRef.current.get(key)
        const page =
          cached ??
          (await stellarService.getAllTokens(
            (currentPage - 1) * EXPLORER_PAGE_SIZE,
            EXPLORER_PAGE_SIZE,
            tokenCountSnapshotRef.current,
          ))
        if (!cached) pageCacheRef.current.set(key, page)
        if (cancelled) return

        setTotalTokens(page.total)
        const enriched = await enrichPage(page.tokens)
        if (cancelled) return
        setTokens(enriched)
      } catch (err) {
        if (cancelled) return
        setTokens([])
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [currentPage, stellarService, enrichPage, pageCacheKey, reloadNonce])

  // The only sanctioned way to pick up newly created tokens mid-session —
  // keeping the count stable across pages is the snapshot's entire purpose.
  const refresh = useCallback(() => {
    tokenCountSnapshotRef.current = undefined
    pageCacheRef.current.clear()
    eventIndexRef.current = null
    setCurrentPage(1)
    setReloadNonce((n) => n + 1)
  }, [])

  const retry = useCallback(() => {
    // Bypass the cached (failed) page and any stale event index, and re-read
    // tokenCount fresh.
    tokenCountSnapshotRef.current = undefined
    pageCacheRef.current.delete(pageCacheKey(currentPage))
    eventIndexRef.current = null
    setReloadNonce((n) => n + 1)
  }, [pageCacheKey, currentPage])

  const resolveIndexAddress = useCallback(
    async (index: number) => (await getEventIndex()).indexToAddress.get(index),
    [getEventIndex],
  )

  return {
    tokens,
    totalTokens,
    loading,
    error,
    currentPage,
    setCurrentPage,
    refresh,
    retry,
    resolveIndexAddress,
  }
}
