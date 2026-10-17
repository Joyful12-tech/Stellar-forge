import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Button, ConfirmModal, InsufficientBalanceWarning } from './UI'
import { isValidIPFSUri } from '../utils/validation'
import { useToast } from '../context/ToastContext'
import { useBalanceCheck } from '../hooks/useBalanceCheck'
import { useNetworkGuard } from '../hooks/useNetworkGuard'
import { NetworkGuardAlert } from './NetworkGuardAlert'
import { FeeDisplay } from './FeeDisplay'
import { useFactoryState } from '../hooks/useFactoryState'
import { stroopsToXLM } from '../utils/formatting'

const METADATA_FEE_STROOPS = '100000'

interface Props {
  tokenAddress?: string
  onSubmit: (tokenAddress: string, metadataUri: string) => Promise<void>
}

export const SetMetadataForm: React.FC<Props> = ({
  tokenAddress: initialAddress = '',
  onSubmit,
}) => {
  const { t } = useTranslation()
  const [tokenAddress, setTokenAddress] = useState(initialAddress)
  const [metadataUri, setMetadataUri] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const { addToast } = useToast()
  const { state: factoryState } = useFactoryState()
  // No IPFS readiness gate here: this form takes an ipfs:// URI that is
  // already pinned and passes it to the contract's `set_metadata`. It never
  // uploads, so pinning credentials are irrelevant to whether it can be used —
  // gating it on them just disabled a working form on deployments that pin
  // elsewhere.
  const networkGuard = useNetworkGuard()
  const networkBlocked = networkGuard.blocked

  const feePaymentStroops = factoryState?.metadataFee ?? METADATA_FEE_STROOPS
  const feeXlm = stroopsToXLM(feePaymentStroops)
  const { hasSufficientBalance, shortfall, isTestnet } = useBalanceCheck(feeXlm)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidIPFSUri(metadataUri)) {
      addToast(t('setMetadata.invalidUri'), 'error')
      return
    }
    setPending(true)
  }

  const handleConfirm = async () => {
    setPending(false)
    setLoading(true)
    try {
      await onSubmit(tokenAddress, metadataUri)
      addToast(t('setMetadata.success'), 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('setMetadata.success'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Token Address"
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          placeholder="G..."
          required
        />
        <Input
          label="Metadata URI"
          value={metadataUri}
          onChange={(e) => setMetadataUri(e.target.value)}
          placeholder="ipfs://Qm..."
          required
        />

        {/* Fee display */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-300">Estimated fee</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                Fee required to set metadata on-chain
              </p>
            </div>
            <FeeDisplay
              feeType="metadata"
              showLabel={false}
              className="text-lg font-semibold text-blue-900 dark:text-blue-300"
            />
          </div>
        </div>

        <Button type="submit" disabled={loading || !hasSufficientBalance || networkBlocked}>
          {loading ? 'Submitting...' : 'Set Metadata'}
        </Button>
        <NetworkGuardAlert guard={networkGuard} />
        {!hasSufficientBalance && (
          <InsufficientBalanceWarning shortfall={shortfall} isTestnet={isTestnet} />
        )}
      </form>

      <ConfirmModal
        isOpen={pending}
        title="Confirm Set Metadata"
        description="Review the metadata update before submitting on-chain."
        details={[
          { label: 'Token Address', value: tokenAddress },
          { label: 'Metadata URI', value: metadataUri },
          { label: 'Estimated Fee', value: feeXlm.toFixed(7) + ' XLM' },
        ]}
        onConfirm={handleConfirm}
        onCancel={() => setPending(false)}
        confirmLabel="Set Metadata"
      />
    </>
  )
}
