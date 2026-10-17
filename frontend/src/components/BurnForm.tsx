import React, { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { Input, Button, ConfirmModal, InsufficientBalanceWarning, Select } from './UI'
import { useDebounce } from '../hooks/useDebounce'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useTransaction, isTransactionInFlight } from '../hooks/useTransaction'
import { useWalletContext } from '../context/WalletContext'
import { useTos } from '../context/TosContext'
import { useStellarContext } from '../context/StellarContext'
import { useToast } from '../context/ToastContext'
import { useNetworkGuard } from '../hooks/useNetworkGuard'
import { NetworkGuardAlert } from './NetworkGuardAlert'
import { useBalanceCheck } from '../hooks/useBalanceCheck'
import { useTokenDashboard } from '../hooks/useTokenDashboard'
import { isValidContractAddress } from '../utils/validation'
import {
  MANUAL_TOKEN_VALUE,
  initialTokenSelection,
  tokenLabel,
  tokenSelectOptions,
} from '../utils/tokenSelect'
import { useMountedRef } from '../hooks/useMountedRef'
import { TxSuccessNotice } from './TxSuccessNotice'

const ESTIMATED_FEE_DISPLAY = '0.01 XLM'
const ESTIMATED_FEE_XLM = 0.01

interface BurnFormData {
  tokenSelect: string
  tokenManual: string
  amount: string
}

interface BurnFormProps {
  tokenAddress?: string
  onSuccess?: () => void
}

export const BurnForm: React.FC<BurnFormProps> = ({
  tokenAddress: initialAddress = '',
  onSuccess,
}) => {
  const { stellarService } = useStellarContext()
  const { wallet } = useWalletContext()
  const { addToast } = useToast()
  const { requireTos } = useTos()
  const networkGuard = useNetworkGuard()
  const networkBlocked = networkGuard.blocked
  const { hasSufficientBalance, shortfall, isTestnet } = useBalanceCheck(ESTIMATED_FEE_XLM)
  const { rows: myTokens } = useTokenDashboard()
  const mountedRef = useMountedRef()

  const [pending, setPending] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BurnFormData>({
    defaultValues: {
      tokenSelect: initialTokenSelection(initialAddress, myTokens),
      tokenManual: initialAddress,
      amount: '',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch() is intentionally non-memoizable; the React Compiler skips this component rather than miscompiling it. See #1002 follow-up
  const tokenSelect = watch('tokenSelect')
  const tokenManual = watch('tokenManual')
  const amount = watch('amount')

  const resolvedTokenAddress = tokenSelect === MANUAL_TOKEN_VALUE ? tokenManual : tokenSelect
  const selectedToken = myTokens.find((t) => t.address === tokenSelect)

  const debouncedAddress = useDebounce(resolvedTokenAddress, 300)
  const {
    balance,
    isLoading: balanceLoading,
    refresh: refreshBalance,
  } = useTokenBalance(debouncedAddress, wallet.address ?? '')

  // Validate amount against balance using BigInt (token amounts can be large)
  const amountExceedsBalance =
    !!amount &&
    !!balance &&
    balance !== '0' &&
    (() => {
      try {
        return BigInt(amount) > BigInt(balance)
      } catch {
        return false
      }
    })()

  const burnBuilder = useCallback(
    () => stellarService.burnTokens({ tokenAddress: resolvedTokenAddress, amount }),
    [stellarService, resolvedTokenAddress, amount],
  )

  const { execute: executeBurn, status: txStatus } = useTransaction(burnBuilder)
  const isSubmitting = isTransactionInFlight(txStatus)

  const onValid = () => {
    if (!wallet.isConnected) {
      addToast('Connect your wallet first', 'error')
      return
    }
    requireTos(() => setPending(true))
  }

  const handleConfirm = async () => {
    setPending(false)
    try {
      const hash = await executeBurn()
      if (mountedRef.current) {
        setTxHash(hash)
        addToast('Tokens burned successfully', 'success')
        refreshBalance()
        onSuccess?.()
      }
    } catch (err) {
      if (mountedRef.current) {
        addToast(err instanceof Error ? err.message : 'Burn failed', 'error')
      }
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
        {/* Danger zone header */}
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <p className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
            <span aria-hidden="true">🔥</span>
            Burning tokens is <strong>permanent and irreversible</strong>. Burned tokens cannot be
            recovered.
          </p>
        </div>

        {/* Token selector */}
        <Select
          label="Token"
          options={tokenSelectOptions(myTokens)}
          error={errors.tokenSelect?.message}
          required
          disabled={!!initialAddress}
          {...register('tokenSelect', { required: 'Select a token' })}
          value={tokenSelect}
          onChange={(e) => setValue('tokenSelect', e.target.value)}
        />

        {/* Manual token address */}
        {tokenSelect === MANUAL_TOKEN_VALUE && (
          <Input
            label="Token Address"
            placeholder="C..."
            required
            disabled={!!initialAddress}
            error={errors.tokenManual?.message}
            {...register('tokenManual', {
              required: 'Token address is required',
              validate: (v) =>
                isValidContractAddress(v.trim()) || 'Enter a valid Soroban contract address',
            })}
          />
        )}

        {/* Balance display */}
        {wallet.address && debouncedAddress && (
          <div
            className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
            data-testid="burn-balance-display"
          >
            <span className="text-gray-500 dark:text-gray-400">Your balance</span>
            <span
              className="font-mono font-medium text-gray-900 dark:text-gray-100"
              data-testid="burn-balance-value"
            >
              {balanceLoading ? (
                <span className="animate-pulse text-gray-400">Loading…</span>
              ) : (
                <>
                  {balance}
                  {selectedToken && (
                    <span className="ml-1 text-gray-400 text-xs">{selectedToken.symbol}</span>
                  )}
                </>
              )}
            </span>
          </div>
        )}

        {/* Amount + Max button */}
        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Amount to Burn"
                type="number"
                placeholder="0"
                required
                error={errors.amount?.message}
                {...register('amount', {
                  required: 'Amount is required',
                  validate: (v) => {
                    try {
                      return BigInt(v) > 0n || 'Amount must be greater than 0'
                    } catch {
                      return 'Enter a valid amount'
                    }
                  },
                })}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!balance || balance === '0' || balanceLoading}
              onClick={() => setValue('amount', balance, { shouldValidate: true })}
              className="mb-0.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              data-testid="burn-max-button"
            >
              Max
            </Button>
          </div>
          {amountExceedsBalance && (
            <p
              className="mt-1 text-xs text-red-600 dark:text-red-400"
              role="alert"
              data-testid="burn-exceeds-balance-error"
            >
              Amount exceeds your balance of {balance}
            </p>
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Estimated fee: <span className="font-medium">{ESTIMATED_FEE_DISPLAY}</span>
        </p>

        <Button
          type="submit"
          loading={isSubmitting}
          disabled={isSubmitting || amountExceedsBalance || !hasSufficientBalance || networkBlocked}
          className="w-full sm:w-auto bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white disabled:opacity-50"
        >
          {isSubmitting ? 'Processing…' : '🔥 Burn Tokens'}
        </Button>

        <NetworkGuardAlert guard={networkGuard} />

        {!hasSufficientBalance && (
          <InsufficientBalanceWarning shortfall={shortfall} isTestnet={isTestnet} />
        )}
      </form>

      <TxSuccessNotice txHash={txHash} message="Tokens burned successfully" />

      <ConfirmModal
        isOpen={pending}
        title="⚠️ Confirm Burn"
        description="This action is irreversible. These tokens will be permanently destroyed and cannot be recovered."
        details={[
          {
            label: 'Token',
            value: selectedToken ? tokenLabel(selectedToken) : resolvedTokenAddress,
          },
          { label: 'Amount to Burn', value: amount },
          { label: 'Your Balance', value: balance },
          { label: 'Estimated Fee', value: ESTIMATED_FEE_DISPLAY },
        ]}
        onConfirm={handleConfirm}
        onCancel={() => setPending(false)}
        confirmLabel="Yes, Burn Permanently"
      />
    </>
  )
}
