import React from 'react'
import { useTransactionPolling } from '../hooks/useTransaction'
import { useNetwork } from '../context/NetworkContext'
import { stellarExplorerUrl } from '../utils/stellarExplorer'
import { Spinner } from './UI/Spinner'
import { CopyButton } from './CopyButton'

export interface TransactionStatusProps {
  txHash: string
  onSuccess?: () => void
  onError?: (error: string) => void
  /**
   * Called when polling ends without a verdict. Distinct from `onError`: the
   * transaction may still be included, so callers must not treat it as a
   * failure (no cache mutation, no automatic re-submission).
   */
  onUnconfirmed?: (message: string) => void
  /**
   * Retry affordance. Only rendered when the transaction is *known* not to
   * have applied — never for an unconfirmed one, where re-signing could
   * execute the same call twice.
   */
  onRetry?: () => void
}

export const TransactionStatus: React.FC<TransactionStatusProps> = ({
  txHash,
  onSuccess,
  onError,
  onUnconfirmed,
  onRetry,
}) => {
  const { status, error, sentryEventId, safeToRetry, retryRequirement } =
    useTransactionPolling(txHash)
  const { network } = useNetwork()

  React.useEffect(() => {
    if (status === 'success') onSuccess?.()
    if (status === 'failed') onError?.(error ?? 'Transaction failed')
    if (status === 'unconfirmed') onUnconfirmed?.(error ?? 'Transaction not confirmed yet')
  }, [status, error, onSuccess, onError, onUnconfirmed])

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-4 bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-sm mx-auto">
      {status === 'pending' && (
        <div className="flex flex-col items-center space-y-3 text-blue-600">
          <Spinner size="lg" />
          <span className="font-medium animate-pulse">Transaction pending...</span>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center space-y-3 text-green-600">
          <div className="flex items-center space-x-2 bg-green-50 p-2 rounded-full">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <span className="font-bold text-lg text-gray-800">Transaction Successful</span>
          <div className="inline-flex items-center gap-2">
            <a
              href={stellarExplorerUrl('transaction', txHash, network)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on Stellar Expert"
              className="text-sm font-mono text-blue-500 hover:text-blue-700 underline truncate max-w-xs"
              title={txHash}
            >
              {txHash.slice(0, 8)}...{txHash.slice(-8)}
            </a>
            <CopyButton value={txHash} ariaLabel="Copy transaction hash" />
          </div>
        </div>
      )}

      {status === 'unconfirmed' && (
        <div
          className="flex flex-col items-center space-y-3 text-amber-700"
          data-testid="unconfirmed-panel"
        >
          <div className="flex items-center space-x-2 bg-amber-50 p-2 rounded-full">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <span className="font-bold text-lg text-gray-800">Not Confirmed Yet</span>
          {error && <p className="text-sm text-amber-700 text-center px-2">{error}</p>}
          {/* No retry affordance: the transaction may still be included, and
              re-signing it would risk executing the same call twice. */}
          <p className="text-xs text-gray-500 text-center px-2">
            Do not submit it again until you have checked the explorer.
          </p>
          <a
            href={stellarExplorerUrl('transaction', txHash, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-500 hover:text-blue-700 underline"
          >
            View on Stellar Expert
          </a>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex flex-col items-center space-y-3 text-red-600">
          <div className="flex items-center space-x-2 bg-red-50 p-2 rounded-full">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <span className="font-bold text-lg text-gray-800">Transaction Failed</span>
          {error && <p className="text-sm text-red-500 text-center px-2">{error}</p>}
          {/* A contract rejected this call on its own terms — resubmitting the
              same transaction pays the fee again for the same verdict, so say
              what has to change instead of offering a one-click retry. */}
          {retryRequirement && (
            <p className="text-xs text-gray-600 text-center px-2" data-testid="retry-requirement">
              {retryRequirement}
            </p>
          )}
          {safeToRetry && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Try again
            </button>
          )}
          <a
            href={stellarExplorerUrl('transaction', txHash, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-500 hover:text-blue-700 underline"
          >
            View on Stellar Expert
          </a>

          {/* Report an issue affordance — surfaces both the txHash and Sentry
              event ID so support can correlate on-chain data with the captured
              error report in a single step. */}
          <div
            className="mt-2 w-full rounded-lg border border-red-200 bg-red-50 p-3 text-left text-xs text-gray-600"
            data-testid="report-issue-panel"
          >
            <p className="mb-2 font-semibold text-gray-700">Having trouble? Report this issue</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Transaction hash:</span>
                <span className="flex items-center gap-1 font-mono">
                  {txHash.slice(0, 8)}…{txHash.slice(-8)}
                  <CopyButton value={txHash} ariaLabel="Copy transaction hash" />
                </span>
              </div>
              {sentryEventId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">Error reference ID:</span>
                  <span className="flex items-center gap-1 font-mono">
                    {sentryEventId.slice(0, 8)}
                    <CopyButton value={sentryEventId} ariaLabel="Copy error reference ID" />
                  </span>
                </div>
              )}
            </div>
            <p className="mt-2 text-gray-500">
              Include both values when{' '}
              <a
                href="https://github.com/Favourorg/Stellar-forge/issues/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700 underline"
              >
                opening a support issue
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
