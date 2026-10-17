/**
 * Tests for `GET /api/health/indexer` — focused on the sanitization of
 * `lastError` so that the public endpoint never leaks internal infrastructure
 * details (connection strings, hostnames, port numbers, etc.).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { TokenStore, IndexerState } from '../_lib/indexer/types'

// ——— helpers ———

function fakeReqRes(method = 'GET') {
  const req = { method, headers: {} } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const setHeader = vi.fn()
  const res = { status, setHeader } as unknown as VercelResponse

  return { req, res, status, setHeader, json }
}

type MockStore = Pick<TokenStore, 'getState' | 'countTokens'>

function mockStore(overrides: Partial<IndexerState> = {}, tokenCount = 42): MockStore {
  const state: IndexerState = {
    lastCursor: 'abc',
    lastLedger: 12345,
    lastLedgerCloseTime: Date.now() - 30_000, // 30s ago → lag ~30s → ok
    lastRunAt: Date.now() - 30_000,
    lastError: null,
    backfillComplete: true,
    ...overrides,
  }
  return {
    getState: async () => state,
    countTokens: async () => tokenCount,
  }
}

// ——— setup ———

let store: MockStore

let storeHealth = { durableConfigured: true, usingDurableStore: true, lastDurableError: null }

vi.mock('../_lib/indexer/store', () => ({
  getStore: async () => store,
  isDurableStoreConfigured: () => true,
  getStoreHealth: () => storeHealth,
}))

// Import after mocking so the module picks up the hoisted mock.
// eslint-disable-next-line import/first
import handler from './indexer'

beforeEach(() => {
  store = mockStore()
  storeHealth = { durableConfigured: true, usingDurableStore: true, lastDurableError: null }
})

// ——— tests ———

describe('GET /api/health/indexer', () => {
  describe('lastError sanitization', () => {
    it.each([
      // [raw error, expected category]
      ['ECONNREFUSED connect to 10.0.0.1:5432', 'connection_failed'],
      ['connect ETIMEDOUT 192.168.1.1:5432', 'connection_failed'],
      ['getaddrinfo ENOTFOUND db.example.com', 'connection_failed'],
      ['Connection refused: no hosts available', 'connection_failed'],
      ['could not connect to server: Connection refused', 'connection_failed'],
      ['query timeout expired after 30s', 'query_timeout'],
      ['timeout: query took too long', 'query_timeout'],
      ['timed out waiting for database response', 'query_timeout'],
      ['disk full: cannot write to WAL', 'unknown'],
      ['division by zero in SQL function', 'unknown'],
      ['null value in column "name" violates not-null constraint', 'unknown'],
      ['connection pool exhausted', 'unknown'],
      ['ECDHE-RSA-AES128-GCM-SHA256 TLS error', 'unknown'],
    ])('sanitizes "%s" to "%s"', async (rawError, expected) => {
      // Set lastError to the raw error string
      store = mockStore({ lastError: rawError })

      const { req, res, json } = fakeReqRes()
      await handler(req, res)

      const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
      expect(payload.lastError).toBe(expected)
    })

    it('returns null when there is no error', async () => {
      store = mockStore({ lastError: null })

      const { req, res, json } = fakeReqRes()
      await handler(req, res)

      const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
      expect(payload.lastError).toBeNull()
    })

    it('never contains raw driver error strings in the response', async () => {
      const rawError =
        'connect() to PostgreSQL at postgresql://admin:hunter2@internal-db-1.example.com:5432/stellarforge failed: could not connect to server: Connection refused'
      store = mockStore({ lastError: rawError })

      const { req, res, json } = fakeReqRes()
      await handler(req, res)

      const payload = JSON.stringify(json.mock.calls[0]?.[0])
      expect(payload).not.toContain('hunter2')
      expect(payload).not.toContain('internal-db-1')
      expect(payload).not.toContain('postgresql://')
      expect(payload).not.toContain('Connection refused')
    })
  })

  describe('existing fields unaffected', () => {
    it('reports healthy when the indexer is running fine', async () => {
      store = mockStore({
        lastError: null,
        lastRunAt: Date.now() - 10_000,
        lastLedgerCloseTime: Date.now() - 10_000,
      })

      const { req, res, json } = fakeReqRes()
      await handler(req, res)

      const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
      expect(payload.healthy).toBe(true)
      expect(payload.severity).toBe('ok')
      expect(typeof payload.lagSeconds).toBe('number')
      expect(payload.lastLedger).toBe(12345)
      expect(payload.indexedCount).toBe(42)
      expect(payload.durable).toBe(true)
    })

    it('reports severity=critical when lag is too large', async () => {
      store = mockStore({
        lastLedgerCloseTime: Date.now() - 2 * 60 * 60 * 1000, // 2h ago
        lastRunAt: Date.now() - 2 * 60 * 60 * 1000,
      })

      const { req, res, json } = fakeReqRes()
      await handler(req, res)

      const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
      expect(payload.severity).toBe('critical')
      expect(payload.healthy).toBe(false)
    })
  })

  describe('method check', () => {
    it('rejects non-GET methods', async () => {
      const { req, res, status, json } = fakeReqRes('POST')

      await handler(req, res)

      expect(status).toHaveBeenCalledWith(405)
      expect(json).toHaveBeenCalledWith({ error: 'Method not allowed' })
    })
  })
})

describe('reconciliation readiness (issue #1156)', () => {
  it('reports ready when the indexer is durable, backfilled and current', async () => {
    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.reconciliationReady).toBe(true)
    expect(payload.reconciliationBlocker).toBeNull()
    expect(payload.durableStoreConnected).toBe(true)
  })

  it('reports the blocker while backfill is incomplete', async () => {
    store = mockStore({ backfillComplete: false })

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.reconciliationReady).toBe(false)
    expect(payload.reconciliationBlocker).toBe('backfill_incomplete')
  })

  it('reports a silently degraded store', async () => {
    storeHealth = {
      durableConfigured: true,
      usingDurableStore: false,
      lastDurableError: null,
    }

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.durableStoreConnected).toBe(false)
    expect(payload.reconciliationReady).toBe(false)
    expect(payload.reconciliationBlocker).toBe('store_degraded')
  })
})
