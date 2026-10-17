/**
 * Integration tests for the scheduled pin-reconciliation endpoint (issue #1156).
 *
 * These cover the two operating states that used to mass-unpin live metadata:
 *
 * (a) the indexer is mid-backfill, so its token set is a partial view of the
 *     factory, and
 * (b) the instance silently degraded to an empty in-memory store while a
 *     durable one is configured.
 *
 * In both cases every pin is well past the 24-hour grace window, so the only
 * thing standing between them and deletion is the readiness gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './reconcile-pins'
import { setStoreForTesting } from '../_lib/indexer/store'
import { MemoryTokenStore } from '../_lib/indexer/memoryStore'
import type { IndexedToken, IndexerState } from '../_lib/indexer/types'
import type { PinataPin } from '../_lib/pinReconciliation'

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

// ── helpers ──────────────────────────────────────────────────────────────────

function fakeReqRes(query: Record<string, string> = {}) {
  const req = { method: 'GET', headers: {}, query } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status, setHeader: vi.fn() } as unknown as VercelResponse

  return { req, res, status, json }
}

function token(index: number): IndexedToken {
  return {
    address: `CTOKEN${index}`,
    tokenIndex: index,
    name: `Token ${index}`,
    symbol: `TK${index}`,
    decimals: 7,
    creator: 'GCREATOR',
    createdAt: Math.floor((NOW - 30 * DAY) / 1000),
    metadataUri: `ipfs://QmMeta${index}`,
    source: 'backfill',
  }
}

function pin(cid: string, ageMs: number): PinataPin {
  return {
    id: `pin-${cid}`,
    ipfs_pin_hash: cid,
    date_pinned: new Date(NOW - ageMs).toISOString(),
    metadata: {},
  }
}

/** Stub Pinata's pinList and unpin endpoints. */
function stubPinata(rows: PinataPin[]) {
  const fetchMock = vi.fn(async (url: unknown, options?: RequestInit) => {
    if ((options as RequestInit)?.method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({}) }
    }
    void url
    return { ok: true, status: 200, json: async () => ({ count: rows.length, rows }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function unpinnedCids(fetchMock: ReturnType<typeof stubPinata>): string[] {
  return fetchMock.mock.calls
    .filter(([, options]) => (options as RequestInit)?.method === 'DELETE')
    .map(([url]) => String(url).split('/pinning/unpin/')[1] ?? '')
}

/** Seed a store with `indexed` tokens and the given checkpoint. */
async function seedStore(indexed: number[], state: Partial<IndexerState>) {
  const store = new MemoryTokenStore()
  await store.upsertTokens(indexed.map(token))
  await store.saveState({
    lastLedger: 5000,
    lastLedgerCloseTime: NOW - 30_000,
    lastRunAt: NOW - 30_000,
    ...state,
  })
  return store
}

// ── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env['PINATA_API_KEY'] = 'test-key'
  process.env['PINATA_API_SECRET'] = 'test-secret'
  delete process.env['CRON_SECRET']
  delete process.env['VERCEL_ENV']
  delete process.env['POSTGRES_URL']
  delete process.env['RECONCILE_PINS_DRY_RUN']
  delete process.env['RECONCILE_PINS_OVERRIDE_CIRCUIT_BREAKER']
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setStoreForTesting(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env['PINATA_API_KEY']
  delete process.env['PINATA_API_SECRET']
  delete process.env['POSTGRES_URL']
})

// ── tests ────────────────────────────────────────────────────────────────────

describe('GET /api/cron/reconcile-pins', () => {
  it('rejects unauthenticated calls in production', async () => {
    process.env['CRON_SECRET'] = 'secret'
    const { req, res, status } = fakeReqRes()

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
  })

  it('unpins nothing while the indexer is still backfilling', async () => {
    // 60 tokens on chain, only the first 30 backfilled so far. Every pin —
    // including the metadata of the 30 tokens the indexer has not reached — is
    // three days old, well past the grace window.
    const indexed = Array.from({ length: 30 }, (_, i) => i + 1)
    setStoreForTesting(await seedStore(indexed, { backfillComplete: false }))

    const rows = Array.from({ length: 60 }, (_, i) => pin(`QmMeta${i + 1}`, 3 * DAY))
    const fetchMock = stubPinata(rows)

    const { req, res, status, json } = fakeReqRes()
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual([])
    expect(status).toHaveBeenCalledWith(200)

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.cleaned).toBe(0)
    expect(payload.skipped).toBe(true)
    expect(payload.skipReason).toBe('not_ready')
    expect((payload.readiness as { blocker: string }).blocker).toBe('backfill_incomplete')
  })

  it('unpins nothing when the store has silently degraded to memory', async () => {
    // A durable backend is configured, but this instance failed to connect and
    // is serving an empty in-memory store: every CID looks unreferenced.
    process.env['POSTGRES_URL'] = 'postgres://user:pw@example.test/db'
    setStoreForTesting(new MemoryTokenStore(), /* durable */ false)

    const rows = Array.from({ length: 60 }, (_, i) => pin(`QmMeta${i + 1}`, 3 * DAY))
    const fetchMock = stubPinata(rows)

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual([])

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.cleaned).toBe(0)
    expect(payload.skipped).toBe(true)
    expect((payload.readiness as { blocker: string }).blocker).toBe('store_degraded')
  })

  it('unpins nothing when ingest has fallen behind', async () => {
    setStoreForTesting(
      await seedStore(
        Array.from({ length: 60 }, (_, i) => i + 1),
        {
          backfillComplete: true,
          lastLedgerCloseTime: NOW - 2 * 60 * 60 * 1000, // 2h behind
        },
      ),
    )

    const fetchMock = stubPinata([pin('QmStrayOrphan', 3 * DAY)])

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual([])
    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect((payload.readiness as { blocker: string }).blocker).toBe('indexer_lagging')
  })

  it('cleans genuine orphans once the indexer is complete and current', async () => {
    const indexed = Array.from({ length: 30 }, (_, i) => i + 1)
    setStoreForTesting(await seedStore(indexed, { backfillComplete: true }))

    const rows = [
      ...indexed.map((i) => pin(`QmMeta${i}`, 3 * DAY)),
      pin('QmAbandonedUpload', 3 * DAY),
      pin('QmStillInFlight', 60 * 60 * 1000), // inside the grace window
    ]
    const fetchMock = stubPinata(rows)

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual(['QmAbandonedUpload'])
    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.cleaned).toBe(1)
    expect(payload.skipped).toBe(false)
  })

  it('dryRun=1 classifies orphans without deleting them', async () => {
    const indexed = Array.from({ length: 30 }, (_, i) => i + 1)
    setStoreForTesting(await seedStore(indexed, { backfillComplete: true }))

    const rows = [...indexed.map((i) => pin(`QmMeta${i}`, 3 * DAY)), pin('QmAbandoned', 3 * DAY)]
    const fetchMock = stubPinata(rows)

    const { req, res, json } = fakeReqRes({ dryRun: '1' })
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual([])
    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.dryRun).toBe(true)
    expect(payload.skipReason).toBe('dry_run')
    expect(payload.wouldUnpin).toEqual(['QmAbandoned'])
  })

  it('circuit breaker stops a mass unpin even when the gate passes', async () => {
    // The indexer reports itself complete and current, but its token set is
    // wrong — the failure mode a readiness check alone cannot catch.
    setStoreForTesting(await seedStore([1, 2], { backfillComplete: true }))

    const rows = Array.from({ length: 40 }, (_, i) => pin(`QmMeta${i + 1}`, 3 * DAY))
    const fetchMock = stubPinata(rows)

    const { req, res, json } = fakeReqRes()
    await handler(req, res)

    expect(unpinnedCids(fetchMock)).toEqual([])
    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.circuitBreakerTripped).toBe(true)
    expect(payload.skipReason).toBe('circuit_breaker')
    expect(payload.cleaned).toBe(0)
  })
})
