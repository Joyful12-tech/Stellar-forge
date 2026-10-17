import { useEffect, useMemo } from 'react'
import { ENV } from '../config/env'
import { useFactoryState } from './useFactoryState'

/**
 * Result of comparing the frontend's expected token WASM hash against the
 * hash the factory actually deploys from.
 *
 * - `checking`    — the factory state has not been read yet.
 * - `verified`    — configured hash matches on-chain `token_wasm_hash`.
 * - `mismatch`    — they differ. This is the case that must be surfaced.
 * - `unavailable` — the comparison could not be made (no configured hash, the
 *                   factory read failed, or the contract's state predates the
 *                   `token_wasm_hash` field). Deliberately NOT reported as a
 *                   mismatch: an inconclusive check must not cry wolf.
 */
export type WasmHashStatus = 'checking' | 'verified' | 'mismatch' | 'unavailable'

export interface WasmHashVerification {
  status: WasmHashStatus
  /** Hash the frontend build expects (VITE_TOKEN_WASM_HASH), lowercase hex. */
  expectedHash: string | null
  /** Hash the factory reports on-chain, lowercase hex. */
  onChainHash: string | null
  /** Convenience flag for banner rendering. */
  isMismatch: boolean
  /** Force a fresh read of the factory state. */
  recheck: () => void
}

/**
 * Re-read the factory state on this cadence so drift introduced by a factory
 * upgrade is noticed within a session rather than only at page load. Kept well
 * above useFactoryState's 30s cache TTL — this is a safety net, not a monitor.
 */
const RECHECK_INTERVAL_MS = 5 * 60_000

const normalise = (hash: string | null | undefined): string | null => {
  if (!hash) return null
  const trimmed = hash.trim().toLowerCase().replace(/^0x/, '')
  return trimmed.length > 0 ? trimmed : null
}

/**
 * useWasmHashVerification — independent client-side check that the token
 * contract code the factory deploys matches what this frontend build was
 * configured for.
 *
 * `token_wasm_hash` is set at factory `initialize` time and can only change via
 * a contract upgrade + migrate, so the realistic failure mode is not a rogue
 * factory: it is a frontend deployment whose VITE_TOKEN_WASM_HASH went stale
 * relative to the chain (e.g. the factory was upgraded and the frontend was not
 * redeployed in lockstep). Without this check users would silently interact
 * with whatever code is deployed, trusting an expectation nothing verified.
 *
 * See docs/mainnet-deployment-checklist.md — this is a safety net, not a
 * substitute for keeping the two in sync during deployment.
 */
export function useWasmHashVerification(): WasmHashVerification {
  const { state, isLoading, error, refetch } = useFactoryState()

  // Periodically re-verify for long-lived sessions.
  useEffect(() => {
    const id = setInterval(refetch, RECHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refetch])

  return useMemo(() => {
    const expectedHash = normalise(ENV.tokenWasmHash)
    const onChainHash = normalise(state?.tokenWasmHash)

    let status: WasmHashStatus
    if (!expectedHash) {
      // Nothing to compare against — a build without VITE_TOKEN_WASM_HASH set.
      status = 'unavailable'
    } else if (error) {
      status = 'unavailable'
    } else if (!state) {
      status = isLoading ? 'checking' : 'unavailable'
    } else if (!onChainHash) {
      status = 'unavailable'
    } else {
      status = onChainHash === expectedHash ? 'verified' : 'mismatch'
    }

    return {
      status,
      expectedHash,
      onChainHash,
      isMismatch: status === 'mismatch',
      recheck: refetch,
    }
  }, [state, isLoading, error, refetch])
}
