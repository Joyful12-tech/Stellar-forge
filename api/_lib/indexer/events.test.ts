/**
 * Tests for the event-storage half of the `TokenStore` seam (issue #1111).
 *
 * Both implementations are exercised against the same expectations, because
 * the whole point of the seam is that ingest and the read API cannot tell them
 * apart. The Postgres store is driven through a fake `SqlExecutor` so these
 * stay unit tests with no live database.
 */

import { describe, it, expect } from 'vitest'
import { MemoryTokenStore } from './memoryStore'
import { createPostgresStore, type SqlExecutor } from './postgresStore'
import { MAX_PAGE_LIMIT, type StoredEvent } from './types'

const TOKEN = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'
const OTHER = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K'

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    tokenAddress: TOKEN,
    ledgerSeq: 100,
    topic: 'mint',
    payload: { amount: '1000' },
    txHash: 'abc123',
    ...overrides,
  }
}

describe('MemoryTokenStore events', () => {
  it('round-trips an upserted event', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents([event()])

    const { events, nextCursor } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(events).toEqual([event()])
    expect(nextCursor).toBeNull()
  })

  it('is idempotent on (tokenAddress, ledgerSeq, topic)', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents([event({ payload: { amount: '1' } })])
    await store.upsertEvents([event({ payload: { amount: '2' } })])

    const { events } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    // Replaying a ledger range must overwrite, not duplicate.
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({ amount: '2' })
  })

  it('treats a differing topic at the same ledger as a distinct event', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents([event({ topic: 'mint' }), event({ topic: 'burn' })])

    const { events } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(events).toHaveLength(2)
  })

  it('scopes listing to the requested token', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents([event(), event({ tokenAddress: OTHER })])

    const { events } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(events).toHaveLength(1)
    expect(events[0]?.tokenAddress).toBe(TOKEN)
  })

  it('returns events newest-first and paginates by keyset cursor', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents([
      event({ ledgerSeq: 1 }),
      event({ ledgerSeq: 2 }),
      event({ ledgerSeq: 3 }),
    ])

    const first = await store.listEvents({ tokenAddress: TOKEN, limit: 2 })
    expect(first.events.map((e) => e.ledgerSeq)).toEqual([3, 2])
    expect(first.nextCursor).toBe('2')

    const second = await store.listEvents({
      tokenAddress: TOKEN,
      limit: 2,
      cursor: Number(first.nextCursor),
    })
    // Cursor is exclusive, so ledger 2 is not repeated.
    expect(second.events.map((e) => e.ledgerSeq)).toEqual([1])
    expect(second.nextCursor).toBeNull()
  })

  it('clamps limit to MAX_PAGE_LIMIT', async () => {
    const store = new MemoryTokenStore()
    await store.upsertEvents(
      Array.from({ length: MAX_PAGE_LIMIT + 5 }, (_, i) => event({ ledgerSeq: i + 1 })),
    )

    const { events } = await store.listEvents({ tokenAddress: TOKEN, limit: 10_000 })

    expect(events).toHaveLength(MAX_PAGE_LIMIT)
  })

  it('returns an empty page for a token with no events', async () => {
    const store = new MemoryTokenStore()

    const { events, nextCursor } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(events).toEqual([])
    expect(nextCursor).toBeNull()
  })
})

describe('createPostgresStore events', () => {
  /** Records every statement so the tests can assert on SQL shape and params. */
  function recordingSql(rows: Record<string, unknown>[] = []) {
    const calls: { text: string; params: unknown[] }[] = []
    const sql = (async (text: string, params: unknown[]) => {
      calls.push({ text, params })
      return rows
    }) as SqlExecutor
    return { sql, calls }
  }

  it('upserts with an ON CONFLICT clause on the composite key', async () => {
    const { sql, calls } = recordingSql()
    const store = createPostgresStore(sql)

    await store.upsertEvents([event()])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.text).toContain('INSERT INTO token_events')
    expect(calls[0]?.text).toContain('ON CONFLICT (token_address, ledger_seq, topic) DO UPDATE')
  })

  it('serializes the payload as JSON and passes params out-of-band', async () => {
    const { sql, calls } = recordingSql()
    const store = createPostgresStore(sql)

    await store.upsertEvents([event({ payload: { amount: '1000' } })])

    expect(calls[0]?.params).toEqual([
      TOKEN,
      100,
      'mint',
      JSON.stringify({ amount: '1000' }),
      'abc123',
    ])
    // The address must never be interpolated into the statement text.
    expect(calls[0]?.text).not.toContain(TOKEN)
  })

  it('maps snake_case rows onto StoredEvent', async () => {
    const { sql } = recordingSql([
      {
        token_address: TOKEN,
        // BIGINT arrives from the driver as a string; it must be normalized.
        ledger_seq: '100',
        topic: 'mint',
        payload: { amount: '1000' },
        tx_hash: 'abc123',
      },
    ])
    const store = createPostgresStore(sql)

    const { events } = await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(events).toEqual([event()])
  })

  it('omits the cursor predicate on a first page', async () => {
    const { sql, calls } = recordingSql()
    const store = createPostgresStore(sql)

    await store.listEvents({ tokenAddress: TOKEN, limit: 10 })

    expect(calls[0]?.text).not.toContain('ledger_seq <')
    // token address, then limit + 1
    expect(calls[0]?.params).toEqual([TOKEN, 11])
  })

  it('adds an exclusive cursor predicate and orders newest-first', async () => {
    const { sql, calls } = recordingSql()
    const store = createPostgresStore(sql)

    await store.listEvents({ tokenAddress: TOKEN, limit: 10, cursor: 50 })

    expect(calls[0]?.text).toContain('ledger_seq < $2')
    expect(calls[0]?.text).toContain('ORDER BY ledger_seq DESC')
    expect(calls[0]?.params).toEqual([TOKEN, 50, 11])
  })

  it('reports a next cursor only when an extra row came back', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      token_address: TOKEN,
      ledger_seq: 3 - i,
      topic: 'mint',
      payload: {},
      tx_hash: null,
    }))
    const { sql } = recordingSql(rows)
    const store = createPostgresStore(sql)

    // limit 2 with 3 rows returned → one extra → another page exists.
    const { events, nextCursor } = await store.listEvents({ tokenAddress: TOKEN, limit: 2 })

    expect(events.map((e) => e.ledgerSeq)).toEqual([3, 2])
    expect(nextCursor).toBe('2')
  })

  it('clamps limit to MAX_PAGE_LIMIT before querying', async () => {
    const { sql, calls } = recordingSql()
    const store = createPostgresStore(sql)

    await store.listEvents({ tokenAddress: TOKEN, limit: 10_000 })

    expect(calls[0]?.params).toEqual([TOKEN, MAX_PAGE_LIMIT + 1])
  })
})
