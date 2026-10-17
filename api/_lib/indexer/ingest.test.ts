/**
 * Ingest tests for the contract-event indexer (issue #943, spec milestone M2).
 *
 * Covers the three properties the spec calls out as load-bearing:
 *   - re-ingesting the same data is idempotent,
 *   - the cursor does not advance past a page that failed to write,
 *   - reconciliation detects and repairs a deliberately skipped index.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryTokenStore } from './memoryStore'
import { runIngest, lagSeconds, type ChainReader, type EventPage } from './ingest'
import type { IndexedToken } from './types'

const token = (index: number, overrides: Partial<IndexedToken> = {}): IndexedToken => ({
  address: `CTOKEN${index}`,
  tokenIndex: index,
  name: `Token ${index}`,
  symbol: `T${index}`,
  decimals: 7,
  creator: 'GCREATOR',
  createdAt: 1_700_000_000 + index,
  metadataUri: null,
  source: 'backfill',
  ...overrides,
})

const emptyPage: EventPage = {
  events: [],
  cursor: null,
  latestLedger: 100,
  latestLedgerCloseTime: 1_700_000_000_000,
}

/** A chain with `count` tokens and no events. */
function stubChain(count: number, overrides: Partial<ChainReader> = {}): ChainReader {
  return {
    getTokenCount: async () => count,
    getTokenByIndex: async (i) => (i >= 1 && i <= count ? token(i) : null),
    getEventPage: async () => emptyPage,
    ...overrides,
  }
}

describe('runIngest — backfill (Phase A)', () => {
  let store: MemoryTokenStore

  beforeEach(() => {
    store = new MemoryTokenStore()
  })

  it('backfills every token and marks the backfill complete', async () => {
    const result = await runIngest(store, stubChain(5))

    expect(result.error).toBeNull()
    expect(result.backfilled).toBe(5)
    expect(result.indexedCount).toBe(5)
    expect(result.backfillComplete).toBe(true)
    expect((await store.getState()).backfillComplete).toBe(true)
  })

  it('is idempotent — re-running writes no duplicates', async () => {
    const chain = stubChain(5)
    await runIngest(store, chain)
    const second = await runIngest(store, chain)

    expect(second.backfilled).toBe(0)
    expect(await store.countTokens()).toBe(5)
  })

  it('resumes across runs when the factory exceeds one run budget', async () => {
    // 400 tokens > MAX_BACKFILL_BATCHES_PER_RUN (8) * BACKFILL_BATCH_SIZE (25).
    const chain = stubChain(400)

    const first = await runIngest(store, chain)
    expect(first.backfillComplete).toBe(false)
    expect(await store.countTokens()).toBeLessThan(400)

    // Keep running until it settles; must converge, not stall.
    for (let i = 0; i < 10; i++) {
      const r = await runIngest(store, chain)
      if (r.backfillComplete) break
    }

    expect(await store.countTokens()).toBe(400)
    expect((await store.getState()).backfillComplete).toBe(true)
  })

  it('skips an index the factory cannot resolve instead of aborting the batch', async () => {
    const chain = stubChain(5, {
      getTokenByIndex: async (i) => (i === 3 ? null : token(i)),
    })

    const result = await runIngest(store, chain)

    expect(result.error).toBeNull()
    // 4 of 5 present; index 3 is genuinely unreadable.
    expect(await store.countTokens()).toBe(4)
    expect(await store.getToken('CTOKEN3')).toBeNull()
    expect(result.backfillComplete).toBe(false)
  })
})

describe('runIngest — steady state (Phase B)', () => {
  let store: MemoryTokenStore

  beforeEach(() => {
    store = new MemoryTokenStore()
  })

  it('applies created events and advances the cursor', async () => {
    const chain = stubChain(0, {
      getEventPage: async (cursor) =>
        cursor === null
          ? {
              events: [{ type: 'created', token: token(1) }],
              cursor: 'c1',
              latestLedger: 101,
              latestLedgerCloseTime: 1_700_000_100_000,
            }
          : { ...emptyPage, cursor: null },
    })

    const result = await runIngest(store, chain)

    expect(result.eventsApplied).toBeGreaterThanOrEqual(1)
    expect((await store.getToken('CTOKEN1'))?.source).toBe('event')
    expect((await store.getState()).lastLedger).toBe(100)
  })

  it('applies meta events to an already-indexed token', async () => {
    const chain = stubChain(1, {
      getEventPage: async (cursor) =>
        cursor === null
          ? {
              events: [
                {
                  type: 'meta',
                  address: 'CTOKEN1',
                  metadataUri: 'ipfs://bafyfoo',
                },
              ],
              cursor: null,
              latestLedger: 101,
              latestLedgerCloseTime: 1_700_000_100_000,
            }
          : emptyPage,
    })

    await runIngest(store, chain)

    expect((await store.getToken('CTOKEN1'))?.metadataUri).toBe('ipfs://bafyfoo')
  })

  it('does not lose a metadata URI when a later backfill re-reads the token', async () => {
    // `get_token_info` carries no metadata URI, so a naive upsert would null
    // out a URI already learned from a `meta` event.
    await store.upsertTokens([token(1, { metadataUri: 'ipfs://bafyfoo' })])
    await store.upsertTokens([token(1)])

    expect((await store.getToken('CTOKEN1'))?.metadataUri).toBe('ipfs://bafyfoo')
  })

  it('leaves the cursor untouched when a page fails, so the range is retried', async () => {
    const failing = stubChain(0, {
      getEventPage: async () => {
        throw new Error('RPC 502')
      },
    })

    const result = await runIngest(store, failing)

    expect(result.error).toBe('RPC 502')
    const state = await store.getState()
    // Never advanced past the range that failed — at-least-once, not at-most-once.
    expect(state.lastCursor).toBeNull()
    expect(state.lastError).toBe('RPC 502')
  })

  it('records the error and keeps the previous cursor across a failed run', async () => {
    await store.saveState({ lastCursor: 'c5' })

    const result = await runIngest(
      store,
      stubChain(0, {
        getEventPage: async () => {
          throw new Error('boom')
        },
      }),
    )

    expect(result.error).toBe('boom')
    expect((await store.getState()).lastCursor).toBe('c5')
  })

  it('clears last_error after a run that succeeds', async () => {
    await store.saveState({ lastError: 'previous failure' })

    await runIngest(store, stubChain(1))

    expect((await store.getState()).lastError).toBeNull()
  })
})

describe('runIngest — reconciliation', () => {
  it('detects and repairs a deliberately skipped index', async () => {
    const store = new MemoryTokenStore()
    const chain = stubChain(5)

    // Simulate a lost cursor range: indices 1, 2, 4, 5 arrived; 3 never did,
    // and the backfill was already marked complete so Phase A will not rerun.
    await store.upsertTokens([token(1), token(2), token(4), token(5)])
    await store.saveState({ backfillComplete: true })

    const result = await runIngest(store, chain)

    expect(result.reconciled).toBe(1)
    expect(await store.getToken('CTOKEN3')).not.toBeNull()
    expect(await store.countTokens()).toBe(5)
    expect(result.backfillComplete).toBe(true)
  })

  it('does nothing when the indexed count already matches token_count', async () => {
    const store = new MemoryTokenStore()
    const chain = stubChain(3)
    await runIngest(store, chain)

    const second = await runIngest(store, chain)

    expect(second.reconciled).toBe(0)
    expect(second.indexedCount).toBe(3)
  })
})

describe('lagSeconds', () => {
  it('returns null before the first ledger is seen', () => {
    expect(lagSeconds({ lastLedgerCloseTime: null })).toBeNull()
  })

  it('measures seconds since the newest ledger close time', () => {
    const now = 1_700_000_600_000
    expect(lagSeconds({ lastLedgerCloseTime: 1_700_000_000_000 }, now)).toBe(600)
  })

  it('never reports negative lag when the ledger clock runs ahead', () => {
    const now = 1_700_000_000_000
    expect(lagSeconds({ lastLedgerCloseTime: 1_700_000_600_000 }, now)).toBe(0)
  })
})
