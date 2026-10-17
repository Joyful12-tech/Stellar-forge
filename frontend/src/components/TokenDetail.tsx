import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStellarContext } from '../context/StellarContext'
import { useNetwork } from '../context/NetworkContext'
import { useToast } from '../context/ToastContext'
import { useWallet } from '../hooks/useWallet'
import { ipfsService } from '../services/ipfs'
import { ipfsToGatewayUrl, formatAddress, formatTimestamp } from '../utils/formatting'
import { isValidContractAddress } from '../utils/validation'
import type { TokenInfo, IPFSMetadata } from '../types'
import { Card, Button } from './UI'
import { TokenDetailSkeleton } from './UI/Skeleton'
import { CopyButton } from './CopyButton'
import { ExplorerLink } from './ExplorerLink'
import { QRCodeModal } from './UI/QRCodeModal'
import { ShareButton } from './ShareButton'
import { MintForm } from './MintForm'
import { BurnForm } from './BurnForm'
import { SetMetadataForm } from './SetMetadataForm'
import { TokenHistory } from './TokenHistory'
import { NotFound } from './NotFound'
import { ClampedText } from './ClampedText'

const BASE_URL = 'https://stellarforge.app'

type ActivePanel = 'mint' | 'burn' | 'metadata' | null

function setMeta(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export const TokenDetail: React.FC = () => {
  const { t } = useTranslation()
  const { stellarService } = useStellarContext()
  const { address } = useParams<{ address: string }>()
  const { addToast } = useToast()
  const { network } = useNetwork()
  const { wallet } = useWallet()

  const [token, setToken] = useState<TokenInfo | null>(null)
  const [metadata, setMetadata] = useState<IPFSMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Set when the factory cannot confirm a token at this address. Distinct from
  // `notFound` (invalid address / hard failure): we never fabricate placeholder
  // token data, so an unresolvable address renders an explicit marker instead.
  const [unresolved, setUnresolved] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [showQR, setShowQR] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCreator = token?.creator && wallet.address && token.creator === wallet.address

  useEffect(() => {
    if (!address || !isValidContractAddress(address)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- validating the address param before fetching
      setNotFound(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setNotFound(false)
    setUnresolved(null)
    setError(null)

    stellarService
      .resolveTokenInfoByAddress(address)
      .then(async (result) => {
        if (result.status === 'unresolved') {
          // Never render fabricated identity — surface the unresolved marker.
          setUnresolved(result.message)
          return
        }
        const { status: _status, ...info } = result
        setToken(info)
        if (info.metadataUri) {
          try {
            const meta = await ipfsService.getMetadata(info.metadataUri)
            setMetadata(meta as IPFSMetadata)
          } catch {
            // metadata fetch failure is non-fatal
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message || t('tokenDetail.loadError'))
        setNotFound(true)
      })
      .finally(() => setLoading(false))
  }, [address, stellarService, t])

  // Inject Open Graph meta tags for rich link previews
  useEffect(() => {
    if (!token || !address) return

    const title = `${token.name} (${token.symbol}) — StellarForge`
    const description = `${token.name} is a Stellar token with symbol ${token.symbol}, ${token.decimals} decimals, and a total supply of ${token.totalSupply}. Created by ${token.creator}.`
    const url = `${BASE_URL}/token/${address}`

    document.title = title
    setMeta('og:type', 'website')
    setMeta('og:title', title)
    setMeta('og:description', description)
    setMeta('og:url', url)
    setMeta('og:site_name', 'StellarForge')
    setMeta('twitter:card', 'summary')
    setMeta('twitter:title', title)
    setMeta('twitter:description', description)
    setMeta('twitter:site', '@StellarForge')

    return () => {
      document.title = 'StellarForge - Stellar Token Deployer'
    }
  }, [token, address])

  /**
   * Stable callback — only recreated when token or addToast changes.
   * Passed to SetMetadataForm as onSubmit prop; useCallback prevents
   * SetMetadataForm from re-rendering when unrelated state changes.
   */
  const handleSetMetadata = useCallback(
    async (_addr: string, uri: string) => {
      addToast(`Metadata URI set: ${uri}`, 'success')
      if (token) setToken({ ...token, metadataUri: uri })
      setActivePanel(null)
    },
    [addToast, token],
  )

  /**
   * Stable callback — toggles the active action panel.
   * Wrapped in useCallback so Button onClick refs stay stable across renders.
   */
  const togglePanel = useCallback(
    (panel: ActivePanel) => setActivePanel((prev) => (prev === panel ? null : panel)),
    [],
  )

  if (loading) {
    return <TokenDetailSkeleton />
  }

  if (unresolved) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card title="Token unresolved">
          <p className="text-sm text-gray-700 dark:text-gray-300">{unresolved}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
            {address}
          </p>
          <div className="mt-4">
            <Link to="/tokens">
              <Button variant="outline" size="sm">
                ← Back to tokens
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (notFound || !token) {
    return <NotFound />
  }

  // ipfsToGatewayUrl resolves anything that is not a well-formed ipfs:// URI to
  // an inline placeholder, so attacker-supplied metadata can never turn this
  // into an outbound request to a host of the token creator's choosing.
  const imageUrl = metadata ? ipfsToGatewayUrl(metadata.image ?? '') : null

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white min-w-0">
          <span className="break-words">{token.name}</span>
          <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
            ({token.symbol})
          </span>
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {address && (
            <ShareButton tokenAddress={address} tokenName={token.name} tokenSymbol={token.symbol} />
          )}
          <Link to="/tokens">
            <Button variant="outline" size="sm">
              ← Back
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {t('transactionHistory.dataLabels.token')}
            </dt>
            <dd className="flex items-center gap-1 font-mono text-xs break-all text-gray-900 dark:text-gray-100 mt-1">
              <ExplorerLink
                type="contract"
                value={address!}
                network={network}
                label="View on Stellar Expert"
                ariaLabel={`View contract ${address} on Stellar Expert`}
                className="text-indigo-500 hover:underline"
              />
              <CopyButton value={address!} ariaLabel="Copy token address" />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Total Supply</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">{token.totalSupply ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">{t('tokenForm.decimals')}</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">{token.decimals}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {t('transactionHistory.dataLabels.creator')}
            </dt>
            <dd className="flex items-center gap-1 font-mono text-xs break-all text-gray-900 dark:text-gray-100 mt-1">
              {token.creator ? (
                <ExplorerLink
                  type="account"
                  value={token.creator}
                  network={network}
                  label={formatAddress(token.creator)}
                  ariaLabel={`View account ${token.creator} on Stellar Expert`}
                  className="text-indigo-500 hover:underline"
                />
              ) : (
                '—'
              )}
            </dd>
          </div>
          {/* Resolved: Admin field relabeled to "Deployed by" since the actual
              on-chain admin may differ from the deploy-time creator. A live
              SEP-41 admin() read is tracked as follow-up per audit issue #1109. */}
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Deployed by</dt>
            <dd className="flex items-center gap-1 font-mono text-xs break-all text-gray-900 dark:text-gray-100 mt-1">
              {token.creator ? (
                <ExplorerLink
                  type="account"
                  value={token.creator}
                  network={network}
                  label={formatAddress(token.creator)}
                  ariaLabel={`View account ${token.creator} on Stellar Expert`}
                  className="text-indigo-500 hover:underline"
                />
              ) : (
                '—'
              )}
            </dd>
          </div>
          {token.createdAt ? (
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Created</dt>
              <dd className="text-gray-900 dark:text-gray-100 mt-1">
                {formatTimestamp(token.createdAt)}
              </dd>
            </div>
          ) : null}
          {token.metadataUri ? (
            <div className="sm:col-span-2">
              <dt className="text-gray-500 dark:text-gray-400">{t('setMetadata.metadataUri')}</dt>
              <dd className="flex items-center gap-1 font-mono text-xs break-all text-gray-900 dark:text-gray-100 mt-1">
                <span className="truncate" title={token.metadataUri}>
                  {token.metadataUri}
                </span>
                <CopyButton value={token.metadataUri} ariaLabel="Copy metadata URI" />
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {metadata && (
        <Card title="Metadata">
          <div className="flex gap-4 items-start">
            {imageUrl && (
              <img
                src={imageUrl}
                alt={metadata.name || `${token.name} token art`}
                className="w-24 h-24 rounded-lg object-cover flex-shrink-0 border border-gray-200 dark:border-gray-700"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <div className="space-y-1 text-sm">
              {metadata.name && (
                <p className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2 break-words">
                  {metadata.name}
                </p>
              )}
              {metadata.description && (
                <ClampedText lines={3} expandable className="text-gray-600 dark:text-gray-400">
                  {metadata.description}
                </ClampedText>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        {isCreator ? (
          <>
            <Button onClick={() => togglePanel('mint')} variant="primary">
              {activePanel === 'mint' ? 'Cancel Mint' : 'Mint More'}
            </Button>
            <Button onClick={() => togglePanel('burn')} variant="secondary">
              {activePanel === 'burn' ? 'Cancel Burn' : 'Burn Tokens'}
            </Button>
            {!token.metadataUri && (
              <Button onClick={() => togglePanel('metadata')} variant="outline">
                {activePanel === 'metadata' ? 'Cancel' : 'Set Metadata'}
              </Button>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
            Only the token creator can perform actions on this token.
          </div>
        )}
        <Button onClick={() => setShowQR(true)} variant="outline">
          Show QR
        </Button>
      </div>

      <QRCodeModal isOpen={showQR} address={address!} onClose={() => setShowQR(false)} />

      {/* Inline action panels - only for creator */}
      {isCreator && (
        <>
          {activePanel === 'mint' && address && (
            <Card title="Mint More Tokens">
              <MintForm tokenAddress={address} onSuccess={() => setActivePanel(null)} />
            </Card>
          )}
          {activePanel === 'burn' && address && (
            <Card title="Burn Tokens">
              <BurnForm tokenAddress={address} onSuccess={() => setActivePanel(null)} />
            </Card>
          )}
          {activePanel === 'metadata' && address && (
            <Card title="Set Metadata">
              <SetMetadataForm tokenAddress={address} onSubmit={handleSetMetadata} />
            </Card>
          )}
        </>
      )}

      {/* Token History */}
      {address && <TokenHistory tokenAddress={address} />}
    </div>
  )
}
