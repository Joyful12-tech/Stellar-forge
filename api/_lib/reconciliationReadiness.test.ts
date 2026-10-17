/**
 * Tests for the destructive-reconciliation safety gate (issue #1156).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkReconciliationReadiness } from './reconciliationReadiness'
import { setStoreForTesting } from './indexer/store'
import { MemoryTokenStore } from './indexer/memoryStore'
import { LAG_WARNING_SECONDS } from './indexer/ingest'
import type { IndexerState, TokenStore } from './indexer/types'

const NOW = Date.parse('2026-08-25T12:00:00Z')

/** A store whose checkpoint says "fully backfilled and current". */
async function healthyStore(patch: Partial<IndexerState> = {}): Promise<MemoryTokenStore> {
  const store = new MemoryTokenStore()
  await store.saveState({
    lastLedger: 1000,
    lastLedgerCloseTime: NOW - 30_000,
    lastRunAt: NOW - 30_000,
    backfillComplete: true,
    ...patch,
  })
  return store
}

beforeEach(() => {
  delete process.env['POSTGRES_URL']
  delete process.env['DATABASE_URL']
})

afterEach(() => {
  setStoreForTesting(null)
  delete process.env['POSTGRES_URL']
  delete process.env['DATABASE_URL']
})

describe('checkReconciliationReadiness', () => {
  it('is ready when the store is durable, backfilled and current', async () => {
    setStoreForTesting(await healthyStore())

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(true)
    expect(readiness.blocker).toBeNull()
    expect(readiness.backfillComplete).toBe(true)
    expect(readiness.lagSeconds).toBe(30)
  })

  it('refuses while backfill is incomplete', async () => {
    setStoreForTesting(await healthyStore({ backfillComplete: false }))

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(false)
    expect(readiness.blocker).toBe('backfill_incomplete')
    expect(readiness.detail).toMatch(/partial/)
  })

  it('refuses when ingest has fallen behind the warning threshold', async () => {
    const store = await healthyStore({
      lastLedgerCloseTime: NOW - (LAG_WARNING_SECONDS + 60) * 1000,
    })
    setStoreForTesting(store)

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(false)
    expect(readiness.blocker).toBe('indexer_lagging')
  })

  it('refuses when the indexer has never run', async () => {
    setStoreForTesting(new MemoryTokenStore())

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(false)
    expect(readiness.blocker).toBe('never_ingested')
  })

  it('refuses when a durable store is configured but the instance degraded to memory', async () => {
    process.env['POSTGRES_URL'] = 'postgres://user:pw@example.test/db'
    // A fully backfilled, current *in-memory* store is exactly what a degraded
    // instance would look like if the checkpoint happened to be populated.
    setStoreForTesting(await healthyStore(), /* durable */ false)

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(false)
    expect(readiness.blocker).toBe('store_degraded')
  })

  it('refuses when the store query throws', async () => {
    const exploding = {
      getState: async () => {
        throw new Error('connection reset')
      },
    } as unknown as TokenStore
    setStoreForTesting(exploding)

    const readiness = await checkReconciliationReadiness(NOW)

    expect(readiness.ready).toBe(false)
    expect(readiness.blocker).toBe('store_unreachable')
    expect(readiness.detail).toContain('connection reset')
  })
})
