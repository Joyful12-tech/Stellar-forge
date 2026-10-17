import { useState, useEffect, useCallback, useRef } from 'react'
import { StrKey } from 'stellar-sdk'
import { STELLAR_CONFIG } from '../config/stellar'

/**
 * Fee split recipients configured on the factory contract via
 * `set_fee_split`. Each entry maps a recipient address to its share in
 * basis points (bps, out of 10_000). The contract guarantees the bps of a
 * configured split sum to exactly 10_000 (`set_fee_split` enforcement).
 */
export interface FeeSplitRecipient {
  /** Stellar account address receiving a share of each fee payment. */
  address: string
  /** Share in basis points (1 bps = 0.01%). Sums to 10_000 when a split is set. */
  bps: number
}

// ── Module-level cache ────────────────────────────────────────────────────────
// Shared across all hook instances so components mounted after the first fetch
// within the TTL window reuse the same result without a network call.

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  recipients: FeeSplitRecipient[]
  fetchedAt: number // Date.now()
}

let cache: CacheEntry | null = null

function getRpcUrl(): string {
  const network = STELLAR_CONFIG.network as 'testnet' | 'mainnet'
  return STELLAR_CONFIG[network].sorobanRpcUrl
}

async function rpcSimulate(contractId: string, method: string): Promise<unknown> {
  const { xdr, Contract } = await import('stellar-sdk')

  const contract = new Contract(contractId)
  const tx = contract.call(method)

  const res = await fetch(getRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: tx.toXDR() },
    }),
  })

  if (!res.ok) throw new Error(`RPC HTTP error ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? 'RPC error')

  // simulateTransaction returns results[0].xdr — a base64 ScVal
  const resultXdr: string = json.result?.results?.[0]?.xdr
  if (!resultXdr) throw new Error('No result returned from simulateTransaction')

  return xdr.ScVal.fromXDR(resultXdr, 'base64')
}

/**
 * Decode the `Map<Address, u32>` returned by `get_fee_split()`.
 *
 * An unset split is stored on-chain as an empty map (see
 * `contracts/token-factory/src/lib.rs`), which decodes to `[]` — reported as
 * an empty recipient list so the caller falls back to a single treasyury row.
 */
async function decodeFeeSplit(scVal: unknown): Promise<FeeSplitRecipient[]> {
  const { xdr } = await import('stellar-sdk')

  // get_fee_split() returns a Map<Address, u32> encoded as ScvMap
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const val = scVal as any
  if (val.switch() !== xdr.ScValType.scvMap()) {
    throw new Error('Unexpected ScVal type for fee split')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pairs = val.map() as any[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pairs.map((entry: any) => {
    const addr = entry.key().address()
    let address: string
    if (addr.switch() === xdr.ScAddressType.scAddressTypeAccount()) {
      address = StrKey.encodeEd25519PublicKey(addr.accountId().ed25519())
    } else {
      address = [...new Uint8Array(addr.contractId() as ArrayBuffer)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
    const bps = entry.val().u32() as number
    return { address, bps }
  })
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseFeeSplitResult {
  /**
   * Configured split recipients, or an empty array when no split is set
   * (the contract falls back to paying the whole fee to treasury).
   * `null` while loading or when the RPC call errored.
   */
  recipients: FeeSplitRecipient[] | null
  isLoading: boolean
  error: Error | null
}

export function useFeeSplit(): UseFeeSplitResult {
  const [recipients, setRecipients] = useState<FeeSplitRecipient[] | null>(() =>
    cache ? cache.recipients : null,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Tracks whether a fetch is already in-flight to avoid duplicate requests
  // when multiple components mount simultaneously.
  const fetchingRef = useRef(false)

  const fetchSplit = useCallback(async (bypassCache: boolean) => {
    const now = Date.now()

    if (!bypassCache && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      setRecipients(cache.recipients)
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true

    setIsLoading(true)
    setError(null)

    try {
      const contractId = STELLAR_CONFIG.factoryContractId
      if (!contractId) throw new Error('VITE_FACTORY_CONTRACT_ID is not configured')

      const scVal = await rpcSimulate(contractId, 'get_fee_split')
      const decoded = await decodeFeeSplit(scVal)

      cache = { recipients: decoded, fetchedAt: Date.now() }
      setRecipients(decoded)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
      fetchingRef.current = false
    }
  }, [])

  // Initial fetch on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchSplit transitions to loading synchronously; a mount fetch is exactly what this effect is for.
    fetchSplit(false)
  }, [fetchSplit])

  return { recipients, isLoading, error }
}
