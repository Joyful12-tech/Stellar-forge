import React from 'react'
import { useWasmHashVerification } from '../hooks/useWasmHashVerification'

const truncateHash = (hash: string): string =>
  hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-10)}` : hash

/**
 * WasmHashMismatchBanner — full-width warning shown when the factory's on-chain
 * `token_wasm_hash` differs from the VITE_TOKEN_WASM_HASH this frontend was
 * built with, i.e. tokens are being deployed from code this build does not
 * expect. Renders nothing while checking, when verified, or when the check is
 * inconclusive.
 */
export const WasmHashMismatchBanner: React.FC = () => {
  const { isMismatch, expectedHash, onChainHash, recheck } = useWasmHashVerification()

  if (!isMismatch || !expectedHash || !onChainHash) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="wasm-hash-mismatch-banner"
      className="w-full bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-700 px-4 py-3 flex items-start gap-3"
    >
      <span className="flex-shrink-0 text-red-500 mt-0.5" aria-hidden="true">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <div className="text-sm text-red-800 dark:text-red-200 flex-1">
        <p>
          <span className="font-semibold">Token contract mismatch:</span> this factory deploys
          tokens from a different contract than this app was configured to expect. Verify the
          deployment before creating or interacting with tokens.
        </p>
        <p className="mt-1 font-mono text-xs break-all">
          expected <span className="font-semibold">{truncateHash(expectedHash)}</span> · on-chain{' '}
          <span className="font-semibold">{truncateHash(onChainHash)}</span>
        </p>
      </div>
      <button
        onClick={recheck}
        className="flex-shrink-0 text-xs text-red-700 dark:text-red-300 underline hover:text-red-900 dark:hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
        aria-label="Re-check token WASM hash"
      >
        Re-check
      </button>
    </div>
  )
}
