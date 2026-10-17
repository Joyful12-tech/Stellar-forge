import React, { useCallback, useEffect, useState } from 'react'
import { useStellarContext } from '../context/StellarContext'
import { useNetwork } from '../context/NetworkContext'
import { formatAddress, formatTimestamp } from '../utils/formatting'
import { ExplorerLink } from './ExplorerLink'
import type { ContractEvent } from '../types'
import { Card, Button, Spinner } from './UI'

interface TokenHistoryProps {
  tokenAddress: string
}

export const TokenHistory: React.FC<TokenHistoryProps> = ({ tokenAddress }) => {
  const { stellarService } = useStellarContext()
  const { network } = useNetwork()
  const [events, setEvents] = useState<ContractEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Disclosure: Soroban RPC only retains events for a bounded window, so this
  // list is never the token's complete lifetime. See getTokenEvents.
  const [retentionDays, setRetentionDays] = useState<number | null>(null)

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // getTokenEvents paginates exhaustively through the RPC's retained event
      // history, so a single call returns everything available for this token.
      const result = await stellarService.getTokenEvents(tokenAddress)

      setEvents(result.events)
      setRetentionDays(result.retentionLimited ? result.retentionDays : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event history')
    } finally {
      setLoading(false)
    }
  }, [stellarService, tokenAddress])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadEvents sets loading state synchronously as it starts fetching; see #1002 follow-up
    loadEvents()
  }, [loadEvents])

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'created':
        return '🎉'
      case 'mint':
        return '➕'
      case 'burn':
        return '🔥'
      case 'meta':
        return '📝'
      case 'fees':
        return '💰'
      case 'pause':
        return '⏸️'
      case 'unpause':
        return '▶️'
      default:
        return '📋'
    }
  }

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'created':
        return 'Token Created'
      case 'mint':
        return 'Tokens Minted'
      case 'burn':
        return 'Tokens Burned'
      case 'meta':
        return 'Metadata Set'
      case 'fees':
        return 'Fees Updated'
      case 'pause':
        return 'Contract Paused'
      case 'unpause':
        return 'Contract Unpaused'
      default:
        return type
    }
  }

  const renderEventDetails = (event: ContractEvent) => {
    const { type, data } = event

    switch (type) {
      case 'created':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Creator:</span>
              <ExplorerLink
                type="account"
                value={data.creator ?? ''}
                network={network}
                label={formatAddress(data.creator ?? '')}
                className="text-indigo-500 hover:underline font-mono text-xs"
              />
            </div>
          </div>
        )

      case 'mint':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">To:</span>
              <ExplorerLink
                type="account"
                value={data.to ?? ''}
                network={network}
                label={formatAddress(data.to ?? '')}
                className="text-indigo-500 hover:underline font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Amount:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100 text-xs">
                {data.amount}
              </span>
            </div>
          </div>
        )

      case 'burn':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">From:</span>
              <ExplorerLink
                type="account"
                value={data.from ?? ''}
                network={network}
                label={formatAddress(data.from ?? '')}
                className="text-indigo-500 hover:underline font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Amount:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100 text-xs">
                {data.amount}
              </span>
            </div>
          </div>
        )

      case 'meta':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">URI:</span>
              <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate max-w-xs">
                {data.metadataUri}
              </span>
            </div>
          </div>
        )

      case 'fees':
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Base Fee:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100 text-xs">
                {data.baseFee}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Metadata Fee:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100 text-xs">
                {data.metadataFee}
              </span>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  if (loading) {
    return (
      <Card title="Token History">
        <div className="flex justify-center py-8">
          <Spinner size="md" label="Loading event history..." />
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card title="Token History">
        <div className="text-center py-8">
          <p className="text-red-500 text-sm">{error}</p>
          <Button onClick={() => loadEvents()} variant="outline" size="sm" className="mt-4">
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  const retentionNotice = retentionDays !== null && (
    <p
      role="note"
      className="mt-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3"
    >
      Event history is limited by the RPC provider&apos;s retention window. Events older than about{' '}
      {retentionDays} days are not available from this RPC and are not shown here.
    </p>
  )

  if (events.length === 0) {
    return (
      <Card title="Token History">
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No events found for this token yet.
          </p>
        </div>
        {retentionNotice}
      </Card>
    )
  }

  return (
    <Card title="Token History">
      <div className="space-y-3">
        {events.map((event: ContractEvent) => (
          <div
            key={event.id}
            className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-2xl" role="img" aria-label={event.type}>
                  {getEventIcon(event.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                      {getEventLabel(event.type)}
                    </h4>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  {renderEventDetails(event)}
                </div>
              </div>
              <ExplorerLink
                type="tx"
                value={event.txHash}
                network={network}
                label="View Tx"
                className="text-indigo-500 hover:underline text-xs whitespace-nowrap"
              />
            </div>
          </div>
        ))}
      </div>

      {retentionNotice}
    </Card>
  )
}
