import type { ContractEvent } from '../types'

/**
 * Correlation derived from factory events between a token's on-chain 1-based
 * index, its contract address and its latest metadata URI. `get_token_info`
 * (the authoritative index-range listing) carries neither address nor URI, so
 * events are the complementary path used purely for enrichment.
 */
export interface TokenEventIndex {
  indexToAddress: Map<number, string>
  addressToMeta: Map<string, string>
}

/**
 * Build a {@link TokenEventIndex} from the factory's full event history.
 *
 * Creation order is 1-based index order: the k-th `created` event (oldest
 * first, ties broken by event id) is the token stored at index k+1. For
 * metadata, the latest `meta` event per token wins.
 */
export function buildTokenEventIndex(events: ContractEvent[]): TokenEventIndex {
  const created = events
    .filter((e) => e.type === 'created')
    .sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id))
  const indexToAddress = new Map<number, string>()
  created.forEach((e, k) => {
    if (e.data.tokenAddress) indexToAddress.set(k + 1, e.data.tokenAddress)
  })

  const addressToMeta = new Map<string, string>()
  const metaEvents = events.filter((e) => e.type === 'meta').sort((a, b) => a.ledger - b.ledger)
  for (const e of metaEvents) {
    if (e.data.tokenAddress && e.data.metadataUri) {
      addressToMeta.set(e.data.tokenAddress, e.data.metadataUri)
    }
  }

  return { indexToAddress, addressToMeta }
}
