import React from 'react'
import { useNetwork } from '../context/NetworkContext'
import { networkLabel } from '../config/stellar'
import type { NetworkGuard } from '../hooks/useNetworkGuard'

interface NetworkGuardAlertProps {
  guard: NetworkGuard
  /** Use the smaller text size, for alerts inside compact panels. */
  compact?: boolean
  className?: string
}

/**
 * Why a write form is blocked by {@link useNetworkGuard}, with the
 * "I've reviewed" acknowledgement when the app network changed since the form
 * was opened. Renders nothing while the form is not blocked.
 */
export const NetworkGuardAlert: React.FC<NetworkGuardAlertProps> = ({
  guard,
  compact = false,
  className = '',
}) => {
  const { network } = useNetwork()
  if (!guard.blocked || !guard.reason) return null

  return (
    <div
      role="alert"
      className={`${compact ? 'text-xs' : 'text-sm'} text-red-600 dark:text-red-400 space-y-1 ${className}`.trim()}
    >
      <p>{guard.reason}</p>
      {guard.networkChangedSinceMount && (
        <button
          type="button"
          onClick={guard.acknowledgeNetworkChange}
          className="underline text-red-700 dark:text-red-400 text-xs"
        >
          I've reviewed — continue on {networkLabel(network)}
        </button>
      )}
    </div>
  )
}
