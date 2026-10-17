import React from 'react'

import { stroopsToXLM, formatXLM, formatAddress } from '../utils/formatting'
import { useXlmPrice } from '../hooks/useXlmPrice'
import { useFactoryState } from '../hooks/useFactoryState'
import { useFeeSplit } from '../hooks/useFeeSplit'

interface FeeDisplayProps {
  feeType: 'base' | 'metadata'
  className?: string
  /** When false, render only the amount (+USD) without the "Creation Fee:" prefix. */
  showLabel?: boolean
  /**
   * Batch count (e.g. number of tokens created in one `create_tokens_batch`
   * call). When > 1 the displayed total is `fee × count` — matching the
   * on-chain `total_fee = base_fee × tokens.len()` charged by the contract —
   * instead of the per-token fee.
   */
  count?: number
}

const LABELS: Record<FeeDisplayProps['feeType'], string> = {
  base: 'Creation Fee',
  metadata: 'Metadata Fee',
}

/**
 * Pre-signature fee display.
 *
 * Renders the fee amount in XLM (+USD estimate) and, when the admin has
 * configured a fee split via `set_fee_split`, a breakdown of each recipient's
 * share (basis points → percentage). With no split configured, the contract
 * pays the entire fee to `treasury` — rendered as a single row so the
 * recipient is never invisible.
 *
 * When `count > 1` (batch creation), the displayed total is multiplied by the
 * batch size so the user sees the real on-chain charge
 * (`base_fee × tokens.len()` per `create_tokens_batch`), not the per-token fee.
 */
export const FeeDisplay: React.FC<FeeDisplayProps> = ({
  feeType,
  className = '',
  showLabel = true,
  count = 1,
}: FeeDisplayProps) => {
  // Source fees from useFactoryState (env-resolved network) so the value matches
  // the rest of the app. The module `stellarService` singleton is never synced
  // to the active network, so reading fees from it would always return testnet.
  const { state, error } = useFactoryState()
  const { price: xlmUsdPrice } = useXlmPrice()
  const { recipients, error: splitError } = useFeeSplit()

  const label = LABELS[feeType]

  if (error) {
    return <span className={`text-sm text-red-500 ${className}`}>{label}: unavailable</span>
  }

  if (!state) {
    // Loading skeleton
    return (
      <span
        className={`inline-block h-4 w-32 animate-pulse rounded bg-gray-200 ${className}`}
        aria-label={`Loading ${label}…`}
        role="status"
      />
    )
  }

  const stroops = feeType === 'base' ? state.baseFee : state.metadataFee
  const stroopsBig = BigInt(stroops)
  const totalStroops = stroopsBig * BigInt(Math.max(1, count))
  const xlm = stroopsToXLM(totalStroops.toString())
  const usdAmount =
    xlmUsdPrice !== null ? (xlm * xlmUsdPrice * Math.max(1, count)).toFixed(2) : null

  // ── Recipient split ─────────────────────────────────────────────────────────
  // When the admin has configured a split, show every recipient and its share.
  // Without a split (or while the split is loading / errored) fall back to a
  // single treasury row — the recipient of every fee payment is never hidden.
  const showSplit = recipients !== null && recipients.length > 0 && !splitError

  const splitRows = showSplit
    ? recipients!.map((r) => ({
        address: r.address,
        share: `${((r.bps / 10_000) * 100).toFixed(r.bps % 10 === 0 ? 0 : 2)}%`,
        stroops: (totalStroops * BigInt(r.bps)) / 10_000n,
      }))
    : [
        {
          address: state.treasury,
          share: '100%',
          stroops: totalStroops,
        },
      ]

  return (
    <span className={`text-sm text-gray-700 ${className}`}>
      <span className="inline-flex items-center gap-x-1 whitespace-nowrap">
        {showLabel && `${label}: `}
        {/* formatXLM expects stroops, not the converted XLM value */}
        {formatXLM(totalStroops.toString())}
        {count > 1 && (
          <span className="text-gray-400" aria-label={`${count} items`}>
            × {count}
          </span>
        )}
        {usdAmount !== null && <span className="text-gray-400 ml-1">≈ ${usdAmount} USD</span>}
      </span>

      {/* Recipient breakdown — shown on its own line(s) below the amount */}
      <span className="mt-1 flex flex-col gap-0.5">
        {splitRows.map((row, i) => (
          <span
            key={`${row.address}-${i}`}
            className="text-xs text-gray-500"
            data-testid="fee-recipient-row"
          >
            {row.address === state.treasury && !showSplit
              ? 'Treasury'
              : (formatAddress(row.address) ?? row.address)}
            {' — '}
            {row.share}
            {count > 1 && (
              <>
                {' ('}
                {formatXLM(row.stroops.toString())}
                {')'}
              </>
            )}
          </span>
        ))}
      </span>
    </span>
  )
}
