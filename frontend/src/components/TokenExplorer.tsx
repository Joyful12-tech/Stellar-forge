import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStellarContext } from '../context/StellarContext'
import { useToast } from '../context/ToastContext'
import { isValidContractAddress } from '../utils/validation'
import { Card, Button, Input, Spinner } from './UI'
import { PaginationControls } from './UI/PaginationControls'
import { useDebounce } from '../hooks/useDebounce'
import {
  EXPLORER_PAGE_SIZE,
  fetchMetadataOrNull,
  useExplorerTokens,
  type TokenWithMetadata,
} from '../hooks/useExplorerTokens'
import { ExplorerTokenDetails } from './ExplorerTokenDetails'

export const TokenExplorer: React.FC = () => {
  const { t } = useTranslation()
  const { stellarService } = useStellarContext()
  const { addToast } = useToast()

  const [searchInput, setSearchInput] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const debouncedCreatorFilter = useDebounce(creatorFilter, 300)

  const [searchResult, setSearchResult] = useState<TokenWithMetadata | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const {
    tokens,
    totalTokens,
    loading: loadingTokens,
    // Distinct from an empty list: a non-null value means the page fetch failed,
    // so the UI must show an error state rather than "no tokens exist".
    error: listError,
    currentPage,
    setCurrentPage,
    refresh,
    retry,
    resolveIndexAddress,
  } = useExplorerTokens()

  const loadTokenByAddress = useCallback(
    async (address: string): Promise<TokenWithMetadata | null> => {
      try {
        const info = await stellarService.getTokenInfoByAddress(address)
        return { ...info, address, metadata: await fetchMetadataOrNull(info.metadataUri) }
      } catch {
        return null
      }
    },
    [stellarService],
  )

  const filteredTokens = debouncedCreatorFilter
    ? tokens.filter((t) => t.creator?.toLowerCase().includes(debouncedCreatorFilter.toLowerCase()))
    : tokens

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const query = searchInput.trim()

    if (!query) {
      setSearchError('Please enter a token address or index')
      return
    }

    setSearching(true)
    setSearchError(null)
    setSearchResult(null)

    try {
      // Check if input is a number (contract index, 1-based to match the
      // `#index` shown in the list below).
      if (/^\d+$/.test(query)) {
        const index = parseInt(query, 10)
        if (index < 1 || index > totalTokens) {
          setSearchError(`Token index ${index} does not exist. Total tokens: ${totalTokens}`)
          return
        }

        // Resolve the address from factory events (the same correlation the
        // list uses, so a cached history is not fetched again).
        const address = await resolveIndexAddress(index)
        const result = address ? await loadTokenByAddress(address) : null
        if (result) {
          setSearchResult(result)
        } else {
          setSearchError('Token not found at this index')
        }
        return
      }

      // Otherwise treat as address
      if (!isValidContractAddress(query)) {
        setSearchError('Invalid token address format')
        return
      }

      const result = await loadTokenByAddress(query)
      if (result) {
        setSearchResult(result)
      } else {
        setSearchError('Token not found')
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Token not found')
      addToast('Token not found', 'error')
    } finally {
      setSearching(false)
    }
  }

  const totalPages = Math.ceil(totalTokens / EXPLORER_PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('tokenExplorer.title', 'Token Explorer')}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t(
            'tokenExplorer.description',
            'Search for any token by address or index, or browse all tokens',
          )}
        </p>
      </div>

      {/* Search Form */}
      <Card>
        <form onSubmit={handleSearch} className="space-y-4">
          <Input
            label={t('tokenExplorer.searchLabel', 'Token Address or Index')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t(
              'tokenExplorer.searchPlaceholder',
              'Enter token address (C...) or index (0, 1, 2...)',
            )}
            disabled={searching}
          />
          <Input
            label={t('tokenExplorer.filterByCreator', 'Filter by Creator Address')}
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
            placeholder={t(
              'tokenExplorer.creatorPlaceholder',
              'Enter creator address to filter tokens (optional)',
            )}
            disabled={searching}
          />
          {searchError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {searchError}
            </p>
          )}
          <Button type="submit" disabled={searching} loading={searching}>
            {searching
              ? t('tokenExplorer.searching', 'Searching...')
              : t('tokenExplorer.search', 'Search')}
          </Button>
        </form>
      </Card>

      {/* Search Result */}
      {searchResult && (
        <Card title={t('tokenExplorer.searchResult', 'Search Result')}>
          <ExplorerTokenDetails token={searchResult} />
        </Card>
      )}

      {/* All Tokens List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('tokenExplorer.allTokens', 'All Tokens')} ({totalTokens})
          </h3>
          {/* Explicit refresh: re-snapshots tokenCount and resets to page 1. */}
          <Button type="button" variant="secondary" disabled={loadingTokens} onClick={refresh}>
            {t('tokenExplorer.refresh', 'Refresh')}
          </Button>
        </div>

        {loadingTokens ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label={t('tokenExplorer.loadingTokens', 'Loading tokens...')} />
          </div>
        ) : listError ? (
          // Fetch failure — never render as an empty list, which would read as
          // "no tokens exist" and mask the outage.
          <Card>
            <div className="text-center py-8" role="alert">
              <p className="text-red-600 dark:text-red-400 font-medium">
                {t('tokenExplorer.loadError', 'Could not load tokens')}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-words">
                {listError.message}
              </p>
              <Button type="button" variant="secondary" className="mt-4" onClick={retry}>
                {t('tokenExplorer.retry', 'Retry')}
              </Button>
            </div>
          </Card>
        ) : filteredTokens.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              {debouncedCreatorFilter
                ? t('tokenExplorer.noTokensForCreator', 'No tokens found for this creator address')
                : t('tokenExplorer.noTokens', 'No tokens have been deployed yet')}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredTokens.map((token, index) => (
              <Card key={`${token.address || token.index}-${index}`}>
                <ExplorerTokenDetails token={token} showIndex />
              </Card>
            ))}
          </div>
        )}

        {totalPages > 1 && !loadingTokens && !listError && !debouncedCreatorFilter && (
          <PaginationControls
            page={currentPage}
            totalPages={totalPages}
            totalCount={totalTokens}
            pageSize={EXPLORER_PAGE_SIZE}
            onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
            onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </div>
    </div>
  )
}
