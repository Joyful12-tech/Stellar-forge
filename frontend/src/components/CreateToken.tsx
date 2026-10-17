import React, { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../context/ToastContext'
import { useStellarContext } from '../context/StellarContext'
import { useWalletContext } from '../context/WalletContext'
import { useFactoryState } from '../hooks/useFactoryState'
import { useTransaction, isTransactionInFlight } from '../hooks/useTransaction'
import { TokenForm } from './TokenForm'
import { ShareButton } from './ShareButton'
import { CopyButton } from './CopyButton'
import ErrorBoundary from './ErrorBoundary'
import { logger } from '../utils/logger'
import { TransactionSubmissionError } from '../services/transactionSubmission'

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum time (ms) the component waits for deployToken to settle before
 *  surfacing an uncertainty banner. Aligned with Soroban's ~60s ledger
 *  close window plus network buffer. */
const DEPLOY_TIMEOUT_MS = 90_000

/** Error class used to distinguish a component-level timeout from a
 *  genuine RPC / contract error. */
class TimeoutError extends Error {
  constructor() {
    super('Transaction timed out')
    this.name = 'TimeoutError'
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface DeployedToken {
  address: string
  name: string
  symbol: string
}

export interface CreateTokenProps {
  /** Called after the transaction is confirmed on-chain so the parent can
   *  refresh caches (e.g. the token list). Follows the reconciliation
   *  policy: caches are only invalidated after confirmed success. */
  onSuccess?: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export const CreateToken: React.FC<CreateTokenProps> = ({ onSuccess }) => {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const { stellarService } = useStellarContext()
  const { refreshBalance } = useWalletContext()
  const { state: factoryState } = useFactoryState()

  const [deployedToken, setDeployedToken] = useState<DeployedToken | null>(null)
  const [showTimeoutBanner, setShowTimeoutBanner] = useState(false)

  const paramsRef = useRef<{
    name: string
    symbol: string
    decimals: number
    initialSupply: string
    maxSupply?: string
  } | null>(null)

  const txBuilder = useCallback(
    () =>
      stellarService.deployToken({
        name: paramsRef.current!.name,
        symbol: paramsRef.current!.symbol,
        decimals: paramsRef.current!.decimals,
        initialSupply: paramsRef.current!.initialSupply,
        maxSupply: paramsRef.current!.maxSupply,
        salt:
          Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
        feePayment: factoryState?.baseFee ?? '100000',
      }),
    [stellarService, factoryState?.baseFee],
  )

  const { execute, status } = useTransaction(txBuilder)

  const isSubmitting = isTransactionInFlight(status)

  const handleTokenFormSubmit = useCallback(
    async (params: {
      name: string
      symbol: string
      decimals: number
      initialSupply: string
      maxSupply?: string
    }) => {
      setShowTimeoutBanner(false)
      paramsRef.current = params

      try {
        // ── Component-level timeout ──────────────────────────────────────
        // useTransaction doesn't impose a deadline — each write component
        // guards its own builder with Promise.race so the timeout matches
        // the expected confirmation window for the specific operation.
        const result = await Promise.race([
          execute(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new TimeoutError()), DEPLOY_TIMEOUT_MS),
          ),
        ])

        // ── Reconciliation policy step 2: only mutate on confirmed success
        if (result.success) {
          setDeployedToken({
            address: result.tokenAddress,
            name: params.name,
            symbol: params.symbol,
          })
          addToast(t('tokenForm.deploySuccess'), 'success')
          await refreshBalance()
          onSuccess?.()
        } else {
          // ── Reconciliation policy step 3: failure → no cache mutation
          addToast(t('tokenForm.deployFailed'), 'error')
        }
      } catch (err) {
        // ── Reconciliation policy step 3: timeout → no cache mutation,
        //     communicate uncertainty
        if (err instanceof TimeoutError) {
          setShowTimeoutBanner(true)
          addToast(
            t('tokenForm.deployTimeout', {
              defaultValue:
                'Transaction submitted but not yet confirmed. Check the explorer for the final status.',
            }),
            'warning',
          )
        } else if (err instanceof TransactionSubmissionError && err.status === 'unconfirmed') {
          // The envelope may still land: same uncertainty as a client-side
          // timeout, so show the banner rather than an error the user would
          // answer by re-signing (and possibly minting twice).
          setShowTimeoutBanner(true)
          addToast(err.message, 'warning')
        } else if (err instanceof TransactionSubmissionError && err.retryRequirement) {
          // A decoded contract rejection: the same call cannot succeed until
          // the named condition changes, so say so rather than leaving the
          // user to resubmit and pay the fee again.
          addToast(`${err.message} ${err.retryRequirement}`, 'error')
        } else {
          logger.error('Deployment error:', err)
          addToast(err instanceof Error ? err.message : t('tokenForm.deployError'), 'error')
        }
      }
    },
    [execute, addToast, t, refreshBalance, onSuccess],
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          {t('createToken.title')}
        </h2>
        <p className="mt-1 sm:mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t('createToken.description')}
        </p>
      </div>

      {deployedToken && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <span className="text-2xl shrink-0" aria-hidden="true">
              🎉
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-800 dark:text-green-300 text-sm sm:text-base">
                {deployedToken.name} (${deployedToken.symbol}) {t('tokenForm.deployedSuccessfully')}
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-2">
                <p className="text-xs sm:text-sm text-green-700 dark:text-green-400 font-mono break-all">
                  {deployedToken.address}
                </p>
                <CopyButton value={deployedToken.address} ariaLabel="Copy token address" />
              </div>
              <div className="mt-3">
                <ShareButton
                  tokenAddress={deployedToken.address}
                  tokenName={deployedToken.name}
                  tokenSymbol={deployedToken.symbol}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeout / unconfirmed state — reconciliation policy step 3 */}
      {showTimeoutBanner && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300"
          role="alert"
          data-testid="timeout-banner"
        >
          <p className="font-medium">Transaction submitted but not yet confirmed</p>
          <p className="mt-1">
            Your transaction has been broadcast to the network but has not reached a terminal state.
            It may still succeed — check a Stellar explorer for the final status before retrying.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 shadow-sm">
        <ErrorBoundary>
          <TokenForm onSubmit={handleTokenFormSubmit} isLoading={isSubmitting} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
