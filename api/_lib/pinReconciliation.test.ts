import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyPins,
  extractCidsFromMetadataUris,
  listAllPins,
  runReconciliation,
  unpinCids,
  GRACE_WINDOW_MS,
  type PinataPin,
} from './pinReconciliation'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePin(cid: string, pinnedAtMs: number): PinataPin {
  return {
    id: `pin-${cid}`,
    ipfs_pin_hash: cid,
    date_pinned: new Date(pinnedAtMs).toISOString(),
    metadata: {},
  }
}

const NOW = Date.parse('2026-08-23T12:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('extractCidsFromMetadataUris', () => {
  it('extracts CIDs from ipfs:// URIs', () => {
    const cids = extractCidsFromMetadataUris(['ipfs://QmImg1', 'ipfs://QmMeta1'])
    expect(cids).toEqual(new Set(['QmImg1', 'QmMeta1']))
  })

  it('accepts bare CIDs too', () => {
    const cids = extractCidsFromMetadataUris(['QmBare1234567890123456789012345678901234567890'])
    expect(cids.size).toBe(1)
  })

  it('ignores empty lines and non-CID garbage', () => {
    const cids = extractCidsFromMetadataUris(['', 'not-a-cid', null as unknown as string])
    expect(cids.size).toBe(0)
  })
})

describe('classifyPins', () => {
  it('preserves pins referenced by a confirmed meta event', () => {
    const pins = [makePin('QmOnChain1', NOW - DAY), makePin('QmOnChain2', NOW - DAY)]
    const { toUnpin, preserved } = classifyPins(pins, new Set(['QmOnChain1', 'QmOnChain2']), NOW)

    expect(toUnpin).toEqual([])
    expect(preserved).toBe(2)
  })

  it('removes pins with no matching on-chain reference older than the grace window', () => {
    const pins = [makePin('QmOrphan1', NOW - 2 * DAY), makePin('QmOrphan2', NOW - 3 * DAY)]
    const { toUnpin, preserved } = classifyPins(pins, new Set(['QmOnChain1']), NOW)

    expect(toUnpin.sort()).toEqual(['QmOrphan1', 'QmOrphan2'])
    expect(preserved).toBe(0)
  })

  it('keeps pins younger than the grace window even when unreferenced', () => {
    const pins = [makePin('QmFresh', NOW - 2 * HOUR)]
    const { toUnpin, preserved } = classifyPins(pins, new Set(), NOW)

    expect(toUnpin).toEqual([])
    expect(preserved).toBe(1)
  })

  it('preserves pins with an unparseable date', () => {
    const pin = makePin('QmBrokenDate', NOW)
    pin.date_pinned = 'not-a-date'
    const { toUnpin, preserved } = classifyPins([pin], new Set(), NOW)

    expect(toUnpin).toEqual([])
    expect(preserved).toBe(1)
  })

  it('pin at exactly the grace boundary is preserved (non-strict comparison)', () => {
    const pins = [makePin('QmBoundary', NOW - GRACE_WINDOW_MS)]
    const { toUnpin, preserved } = classifyPins(pins, new Set(), NOW)

    expect(toUnpin).toEqual([])
    expect(preserved).toBe(1)
  })
})

describe('unpinCids', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  it('unpins a list of CIDs and counts successes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await unpinCids(['QmOrphan1', 'QmOrphan2'])

    expect(result.cleaned).toBe(2)
    expect(result.errors).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a 404 as cleaned (already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const result = await unpinCids(['QmGone'])

    expect(result.cleaned).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('counts failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await unpinCids(['QmFail1', 'QmFail2'])

    expect(result.cleaned).toBe(0)
    expect(result.errors).toBe(2)
    expect(result.errorMessage).toContain('HTTP 500')
  })

  it('handles network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await unpinCids(['QmNet'])

    expect(result.cleaned).toBe(0)
    expect(result.errors).toBe(1)
  })
})

describe('listAllPins', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  it('paginates through all pins', async () => {
    const mockedRows = [makePin('QmPage1', NOW), makePin('QmPage2', NOW)]
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ count: 2, rows: mockedRows }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ count: 2, rows: [] }),
        }),
    )

    const pins = await listAllPins(2)

    expect(pins).toHaveLength(2)
    expect(pins[0].ipfs_pin_hash).toBe('QmPage1')
  })

  it('throws when Pinata returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    await expect(listAllPins()).rejects.toThrow(/401/)
  })
})

describe('runReconciliation', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  it('preserves on-chain-referenced pins, cleans orphans past grace', async () => {
    const rows = [
      makePin('QmReferenced', NOW - DAY), // referenced on-chain → keep
      makePin('QmOrphanOld', NOW - 3 * DAY), // orphan past grace → clean
      makePin('QmOrphanFresh', NOW - HOUR), // orphan within grace → keep
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 3, rows }) }),
    )

    const result = await runReconciliation(async () => ['ipfs://QmReferenced'], NOW)

    // One cleanup called for QmOrphanOld
    const deleteCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([, options]) => (options as RequestInit)?.method === 'DELETE')
    expect(deleteCalls).toHaveLength(1)
    expect(String(deleteCalls[0][0])).toContain('/pinning/unpin/QmOrphanOld')
    expect(result.checked).toBe(3)
    expect(result.preserved).toBe(2)
    expect(result.cleaned).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('reports a failure to list pins', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await runReconciliation(async () => [])

    expect(result.checked).toBe(0)
    expect(result.errorMessage).toContain('Failed to list pins')
  })

  it('preserves all pins when on-chain query fails', async () => {
    const rows = [makePin('QmWhatever', NOW - 5 * DAY)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, rows }) }),
    )

    const result = await runReconciliation(async () => {
      throw new Error('indexer down')
    }, NOW)

    expect(result.errorMessage).toContain('indexer down')
    expect(result.cleaned).toBe(0)
    // All pins preserved — conservative fail-safe.
    expect(result.preserved).toBe(1)
    expect(result.checked).toBe(1)
  })
})

// ── Safety gates (issue #1156) ───────────────────────────────────────────────

describe('runReconciliation safety gates', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  /** Stub Pinata's pinList with the given rows; records every fetch call. */
  function stubPinata(rows: PinataPin[]) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: rows.length, rows }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function deleteCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      ([, options]) => (options as RequestInit)?.method === 'DELETE',
    )
  }

  it('unpins nothing when the readiness gate refuses', async () => {
    const fetchMock = stubPinata([makePin('QmOrphanOld', NOW - 3 * DAY)])

    const result = await runReconciliation(async () => [], NOW, {
      checkReadiness: async () => ({
        ready: false,
        detail: 'indexer backfill has not finished; token set is partial',
      }),
    })

    expect(deleteCalls(fetchMock)).toHaveLength(0)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('not_ready')
    expect(result.cleaned).toBe(0)
    expect(result.errorMessage).toContain('backfill has not finished')
    // The gate runs before anything else — not even the pin list is fetched.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a throwing readiness gate as a refusal', async () => {
    const fetchMock = stubPinata([makePin('QmOrphanOld', NOW - 3 * DAY)])

    const result = await runReconciliation(async () => [], NOW, {
      checkReadiness: async () => {
        throw new Error('store unreachable')
      },
    })

    expect(deleteCalls(fetchMock)).toHaveLength(0)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('not_ready')
    expect(result.errorMessage).toContain('store unreachable')
  })

  it('proceeds normally when the gate passes', async () => {
    const fetchMock = stubPinata([
      makePin('QmReferenced', NOW - 3 * DAY),
      makePin('QmOrphanOld', NOW - 3 * DAY),
    ])

    const result = await runReconciliation(async () => ['ipfs://QmReferenced'], NOW, {
      checkReadiness: async () => ({ ready: true }),
    })

    expect(deleteCalls(fetchMock)).toHaveLength(1)
    expect(result.skipped).toBe(false)
    expect(result.cleaned).toBe(1)
  })

  it('dry run reports what it would unpin without calling Pinata', async () => {
    const fetchMock = stubPinata([
      makePin('QmOrphanA', NOW - 3 * DAY),
      makePin('QmOrphanB', NOW - 3 * DAY),
    ])

    const result = await runReconciliation(async () => [], NOW, {
      checkReadiness: async () => ({ ready: true }),
      dryRun: true,
    })

    expect(deleteCalls(fetchMock)).toHaveLength(0)
    expect(result.dryRun).toBe(true)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('dry_run')
    expect(result.cleaned).toBe(0)
    expect(result.wouldUnpin.sort()).toEqual(['QmOrphanA', 'QmOrphanB'])
  })

  it('circuit breaker refuses a run that would unpin most of the account', async () => {
    // 20 pins, all stale and none referenced: the shape of a bad reference set.
    const rows = Array.from({ length: 20 }, (_, i) => makePin(`QmMass${i}`, NOW - 3 * DAY))
    const fetchMock = stubPinata(rows)

    const result = await runReconciliation(async () => [], NOW, {
      checkReadiness: async () => ({ ready: true }),
    })

    expect(deleteCalls(fetchMock)).toHaveLength(0)
    expect(result.circuitBreakerTripped).toBe(true)
    expect(result.skipReason).toBe('circuit_breaker')
    expect(result.cleaned).toBe(0)
    expect(result.wouldUnpin).toHaveLength(20)
    expect(result.errorMessage).toContain('Circuit breaker')
  })

  it('circuit breaker yields to an explicit manual override', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makePin(`QmMass${i}`, NOW - 3 * DAY))
    const fetchMock = stubPinata(rows)

    const result = await runReconciliation(async () => [], NOW, {
      checkReadiness: async () => ({ ready: true }),
      overrideCircuitBreaker: true,
    })

    expect(deleteCalls(fetchMock)).toHaveLength(20)
    expect(result.circuitBreakerTripped).toBe(false)
    expect(result.cleaned).toBe(20)
  })

  it('circuit breaker does not block a small number of genuine orphans', async () => {
    // 3 orphans out of 6 pins is above the ratio but below the absolute floor.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => makePin(`QmKeep${i}`, NOW - 3 * DAY)),
      ...Array.from({ length: 3 }, (_, i) => makePin(`QmOrphan${i}`, NOW - 3 * DAY)),
    ]
    const fetchMock = stubPinata(rows)

    const result = await runReconciliation(
      async () => ['ipfs://QmKeep0', 'ipfs://QmKeep1', 'ipfs://QmKeep2'],
      NOW,
      { checkReadiness: async () => ({ ready: true }) },
    )

    expect(deleteCalls(fetchMock)).toHaveLength(3)
    expect(result.circuitBreakerTripped).toBe(false)
    expect(result.cleaned).toBe(3)
  })
})
