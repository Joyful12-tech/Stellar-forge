import type { ContractEvent, GetEventsResult } from '../types'

export interface ContractEventSource {
  getContractEvents(contractId: string, limit?: number, cursor?: string): Promise<GetEventsResult>
}

const DEFAULT_PAGE_SIZE = 100
// Defensive only — getContractEvents guarantees a short page once the
// cursor reaches the end of history, so this bounds runaway loops rather
// than reflecting a real expected page count.
const MAX_PAGES = 10_000

/**
 * Soroban's `getEvents` RPC returns events in ascending ledger order (oldest
 * first) starting from the earliest retained ledger when no cursor is given.
 * A single capped `getContractEvents(contractId, limit)` call therefore
 * silently truncates the *newest* events once the contract's event history
 * exceeds one page — e.g. a token created after the page limit was already
 * reached would never appear in an "all tokens" view built on one fixed-size
 * call, while older tokens keep showing up. This is the opposite of the
 * usual "stale/missing old data" assumption, so it's easy to miss in review.
 *
 * Page through with the cursor `getContractEvents` already returns (the same
 * end-of-data signal `fetchAllTokensByCreator` uses for the contract's
 * paginated view call: a page shorter than requested means no more data) so
 * callers see the complete event history instead of a silently truncated
 * slice.
 *
 * This re-walks the full event history on every call — acceptable at
 * today's scale, but the right long-term fix for an all-tokens view is an
 * off-chain indexer (#35) rather than the frontend re-deriving state from
 * raw contract events on each load.
 */
export async function fetchAllContractEvents(
  source: ContractEventSource,
  contractId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<ContractEvent[]> {
  const collected: ContractEvent[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const { events, cursor: nextCursor } = await source.getContractEvents(
      contractId,
      pageSize,
      cursor,
    )
    collected.push(...events)
    if (events.length < pageSize || !nextCursor) break
    cursor = nextCursor
  }

  return collected
}
