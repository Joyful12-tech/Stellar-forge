import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatAddress, ipfsToGatewayUrl, formatTimestamp } from '../utils/formatting'
import { CopyButton } from './CopyButton'
import type { TokenWithMetadata } from '../hooks/useExplorerTokens'

interface ExplorerTokenDetailsProps {
  token: TokenWithMetadata
  showIndex?: boolean
}

/** One token's summary in the Token Explorer's list and search result. */
export const ExplorerTokenDetails: React.FC<ExplorerTokenDetailsProps> = ({ token, showIndex }) => {
  const { t } = useTranslation()
  const imageUrl = token.metadata?.image ? ipfsToGatewayUrl(token.metadata.image) : null

  return (
    <div className="space-y-4">
      {/* Token Header with Image */}
      <div className="flex gap-4 items-start">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={`${token.name} logo`}
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-200 dark:border-gray-700"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {showIndex && token.index !== undefined && (
              <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
                #{token.index}
              </span>
            )}
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{token.name}</h4>
            <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
              ({token.symbol})
            </span>
          </div>
          {token.metadata?.description && (
            // Clamped hard with no expand affordance: this is a list row, and a
            // single token must not be able to grow its card and push the rest
            // of the results off-screen.
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-2 break-words">
              {token.metadata.description}
            </p>
          )}
        </div>
      </div>

      {/* Token Details */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {token.address && (
          <CopyableDetail
            label={t('tokenExplorer.address', 'Address')}
            value={token.address}
            display={formatAddress(token.address)}
            copyLabel="Copy token address"
          />
        )}

        <div>
          <dt className="text-gray-500 dark:text-gray-400">
            {t('tokenExplorer.totalSupply', 'Total Supply')}
          </dt>
          <dd className="text-gray-900 dark:text-gray-100 mt-1 font-mono">
            {token.totalSupply ?? '—'}
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 dark:text-gray-400">
            {t('tokenExplorer.decimals', 'Decimals')}
          </dt>
          <dd className="text-gray-900 dark:text-gray-100 mt-1">{token.decimals}</dd>
        </div>

        {token.creator && (
          <CopyableDetail
            label={t('tokenExplorer.creator', 'Creator')}
            value={token.creator}
            display={formatAddress(token.creator)}
            copyLabel="Copy creator address"
          />
        )}

        {token.createdAt && token.createdAt > 0 && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {t('tokenExplorer.created', 'Created')}
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {formatTimestamp(token.createdAt)}
            </dd>
          </div>
        )}

        {token.metadataUri && (
          <CopyableDetail
            label={t('tokenExplorer.metadataUri', 'Metadata URI')}
            value={token.metadataUri}
            copyLabel="Copy metadata URI"
            className="sm:col-span-2"
            truncate
          />
        )}
      </dl>

      {/* View Details Link — only when the token address is known (resolved
          from events); the index-range listing alone carries no address. */}
      {token.address && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <Link
            to={`/tokens/${token.address}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            {t('tokenExplorer.viewDetails', 'View full details')} →
          </Link>
        </div>
      )}
    </div>
  )
}

interface CopyableDetailProps {
  label: string
  /** Full value, copied and shown on hover. */
  value: string
  /** Shortened text to show instead of `value`. */
  display?: string
  copyLabel: string
  className?: string
  truncate?: boolean
}

const CopyableDetail: React.FC<CopyableDetailProps> = ({
  label,
  value,
  display = value,
  copyLabel,
  className,
  truncate = false,
}) => (
  <div className={className}>
    <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
    <dd className="flex items-center gap-1 font-mono text-xs break-all text-gray-900 dark:text-gray-100 mt-1">
      <span className={truncate ? 'truncate' : undefined} title={value}>
        {display}
      </span>
      <CopyButton value={value} ariaLabel={copyLabel} />
    </dd>
  </div>
)
