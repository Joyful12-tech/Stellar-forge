import React from 'react'
import { useNetwork } from '../context/NetworkContext'
import { stellarExplorerUrl } from '../utils/formatting'

interface TxSuccessNoticeProps {
  /** Confirmed transaction hash, or `null` to render nothing. */
  txHash: string | null
  message: string
}

/** Green confirmation box with a link to the transaction on Stellar Explorer. */
export const TxSuccessNotice: React.FC<TxSuccessNoticeProps> = ({ txHash, message }) => {
  const { network } = useNetwork()
  if (!txHash) return null

  return (
    <div
      role="status"
      className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 text-sm text-green-800 dark:text-green-300 flex flex-col gap-1"
    >
      <span className="font-medium">✓ {message}</span>
      <a
        href={stellarExplorerUrl('tx', txHash, network)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-green-700 dark:text-green-400 text-xs"
      >
        View on Stellar Explorer →
      </a>
    </div>
  )
}
