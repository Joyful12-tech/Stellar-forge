/**
 * Tests for store selection (issue #1156).
 *
 * The behaviour under test is the one that made mass-unpinning possible: a
 * single failed Postgres connect used to be cached as an empty in-memory store
 * for the rest of the instance's life, invisibly, so every later reader —
 * including pin reconciliation — believed the account had no tokens.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getStore,
  getStoreHealth,
  isDurableStoreConfigured,
  setStoreForTesting,
  DURABLE_RETRY_BACKOFF_MS,
} from './store'

const WORKING_DRIVER = './testFixtures/fakeNeonDriver'
const BROKEN_DRIVER = './testFixtures/thisModuleDoesNotExist'

const NOW = Date.parse('2026-08-25T00:00:00Z')

beforeEach(() => {
  setStoreForTesting(null)
  delete process.env['POSTGRES_URL']
  delete process.env['DATABASE_URL']
  delete process.env['INDEXER_PG_DRIVER']
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setStoreForTesting(null)
  delete process.env['POSTGRES_URL']
  delete process.env['DATABASE_URL']
  delete process.env['INDEXER_PG_DRIVER']
  vi.restoreAllMocks()
})

describe('getStore with no database configured', () => {
  it('uses the in-memory store and keeps its state across calls', async () => {
    const first = await getStore(NOW)
    const second = await getStore(NOW)

    expect(first).toBe(second)
    expect(isDurableStoreConfigured()).toBe(false)
    expect(getStoreHealth()).toEqual({
      durableConfigured: false,
      usingDurableStore: false,
      lastDurableError: null,
    })
  })
})

describe('getStore when the durable backend is configured', () => {
  beforeEach(() => {
    process.env['POSTGRES_URL'] = 'postgres://user:pw@example.test/db'
  })

  it('reports the durable store once connected and caches it', async () => {
    process.env['INDEXER_PG_DRIVER'] = WORKING_DRIVER

    const first = await getStore(NOW)
    const second = await getStore(NOW + 10 * DURABLE_RETRY_BACKOFF_MS)

    expect(first).toBe(second)
    expect(getStoreHealth().usingDurableStore).toBe(true)
    expect(getStoreHealth().lastDurableError).toBeNull()
  })

  it('degrades to memory on a connect failure but reports it as degraded', async () => {
    process.env['INDEXER_PG_DRIVER'] = BROKEN_DRIVER

    const store = await getStore(NOW)

    // Reads still work — the read API stays up — but they return nothing.
    expect(await store.countTokens()).toBe(0)

    const health = getStoreHealth()
    expect(health.durableConfigured).toBe(true)
    expect(health.usingDurableStore).toBe(false)
    expect(health.lastDurableError).toBeTruthy()
  })

  it('does not cache the degrade: a later call retries and recovers', async () => {
    process.env['INDEXER_PG_DRIVER'] = BROKEN_DRIVER
    await getStore(NOW)
    expect(getStoreHealth().usingDurableStore).toBe(false)

    // Database comes back. The next call past the backoff must pick it up
    // rather than serving the empty fallback forever.
    process.env['INDEXER_PG_DRIVER'] = WORKING_DRIVER
    await getStore(NOW + DURABLE_RETRY_BACKOFF_MS + 1)

    expect(getStoreHealth().usingDurableStore).toBe(true)
    expect(getStoreHealth().lastDurableError).toBeNull()
  })

  it('rate-limits reconnect attempts to the backoff window', async () => {
    process.env['INDEXER_PG_DRIVER'] = BROKEN_DRIVER
    await getStore(NOW)

    process.env['INDEXER_PG_DRIVER'] = WORKING_DRIVER
    await getStore(NOW + DURABLE_RETRY_BACKOFF_MS - 1)

    // Still inside the backoff window — no reconnect attempt was made.
    expect(getStoreHealth().usingDurableStore).toBe(false)
  })
})
