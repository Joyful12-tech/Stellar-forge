/**
 * Read-API tests for the contract-event indexer (issue #943, milestone M3).
 *
 * Covers what the spec calls out as load-bearing:
 *   - pagination covers every row with no duplicates and no gaps across page
 *     boundaries (this is the truncation bug the indexer exists to remove),
 *   - `limit` is clamped server-side,
 *   - a 404 on address lookup is explicitly non-authoritative.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MemoryTokenStore } from '../_lib/indexer/memoryStore'
import { setStoreForTesting } from '../_lib/indexer/store'
import { MAX_PAGE_LIMIT, clampLimit, parseCursor, type IndexedToken } from '../_lib/indexer/types'
import listHandler from './index'
import addressHandler from './[address]'

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

interface Captured {
  status: number
  body: unknown
}

/** Minimal VercelResponse stub capturing the status and JSON body. */
function mockRes(): VercelResponse & { captured: Captured } {
  const captured: Captured = { status: 0, body: undefined }
  const res = {
    captured,
    setHeader: vi.fn(),
    status(code: number) {
      captured.status = code
      return this
    },
    json(body: unknown) {
      captured.body = body
      return this
    },
  }
  return res as unknown as VercelResponse & { captured: Captured }
}

function mockReq(query: Record<string, string> = {}, method = 'GET'): VercelRequest {
  return { method, query, headers: {} } as unknown as VercelRequest
}

let store: MemoryTokenStore

beforeEach(() => {
  store = new MemoryTokenStore()
  setStoreForTesting(store)
})

describe('clampLimit', () => {
  it('defaults when absent or unparseable', () => {
    expect(clampLimit(undefined)).toBe(20)
    expect(clampLimit('not-a-number')).toBe(20)
  })

  it('clamps above the maximum', () => {
    expect(clampLimit('100000')).toBe(MAX_PAGE_LIMIT)
  })

  it('rejects zero and negative values', () => {
    expect(clampLimit('0')).toBe(20)
    expect(clampLimit('-5')).toBe(20)
  })

  it('passes a valid limit through', () => {
    expect(clampLimit('50')).toBe(50)
  })
})

describe('parseCursor', () => {
  it('treats absent, empty and invalid cursors as "start from the beginning"', () => {
    expect(parseCursor(undefined)).toBeUndefined()
    expect(parseCursor('')).toBeUndefined()
    expect(parseCursor('abc')).toBeUndefined()
    expect(parseCursor('-1')).toBeUndefined()
  })

  it('parses a positive cursor', () => {
    expect(parseCursor('42')).toBe(42)
  })
})

describe('GET /api/tokens', () => {
  it('rejects non-GET methods', async () => {
    const res = mockRes()
    await listHandler(mockReq({}, 'POST'), res)
    expect(res.captured.status).toBe(405)
  })

  it('returns an empty page for an empty index', async () => {
    const res = mockRes()
    await listHandler(mockReq(), res)

    expect(res.captured.status).toBe(200)
    expect(res.captured.body).toMatchObject({ tokens: [], nextCursor: null })
  })

  it('returns tokens newest-index-first', async () => {
    await store.upsertTokens([token(1), token(2), token(3)])

    const res = mockRes()
    await listHandler(mockReq(), res)

    const body = res.captured.body as { tokens: IndexedToken[] }
    expect(body.tokens.map((t) => t.tokenIndex)).toEqual([3, 2, 1])
  })

  it('paginates over more than 100 tokens with no duplicates and no gaps', async () => {
    // 250 tokens — well past the 100-event RPC page cap that silently
    // truncated the explorer before the indexer existed (issue #930/#943).
    const all = Array.from({ length: 250 }, (_, i) => token(i + 1))
    await store.upsertTokens(all)

    const seen: number[] = []
    let cursor: string | undefined
    let pages = 0

    do {
      const res = mockRes()
      await listHandler(mockReq(cursor ? { limit: '40', cursor } : { limit: '40' }), res)
      const body = res.captured.body as {
        tokens: IndexedToken[]
        nextCursor: string | null
      }

      seen.push(...body.tokens.map((t) => t.tokenIndex))
      cursor = body.nextCursor ?? undefined
      pages++
      expect(pages).toBeLessThan(20) // guard against a non-terminating cursor
    } while (cursor)

    expect(seen).toHaveLength(250)
    expect(new Set(seen).size).toBe(250) // no duplicates
    // Descending and contiguous — no gaps across page boundaries.
    expect(seen).toEqual(Array.from({ length: 250 }, (_, i) => 250 - i))
  })

  it('clamps limit to 100 server-side', async () => {
    await store.upsertTokens(Array.from({ length: 150 }, (_, i) => token(i + 1)))

    const res = mockRes()
    await listHandler(mockReq({ limit: '1000' }), res)

    const body = res.captured.body as { tokens: IndexedToken[] }
    expect(body.tokens).toHaveLength(MAX_PAGE_LIMIT)
  })

  it('filters by creator', async () => {
    await store.upsertTokens([
      token(1, { creator: 'GALICE' }),
      token(2, { creator: 'GBOB' }),
      token(3, { creator: 'GALICE' }),
    ])

    const res = mockRes()
    await listHandler(mockReq({ creator: 'GALICE' }), res)

    const body = res.captured.body as { tokens: IndexedToken[] }
    expect(body.tokens.map((t) => t.tokenIndex)).toEqual([3, 1])
  })

  it('reports indexedAt so the client can judge staleness', async () => {
    await store.saveState({ lastLedgerCloseTime: 1_700_000_000_000 })

    const res = mockRes()
    await listHandler(mockReq(), res)

    const body = res.captured.body as { indexedAt: string | null }
    expect(body.indexedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })
})

describe('GET /api/tokens/:address', () => {
  it('returns an indexed token', async () => {
    await store.upsertTokens([token(1)])

    const res = mockRes()
    await addressHandler(mockReq({ address: 'CTOKEN1' }), res)

    expect(res.captured.status).toBe(200)
    expect(res.captured.body).toMatchObject({
      address: 'CTOKEN1',
      tokenIndex: 1,
    })
  })

  it('400s when no address is supplied', async () => {
    const res = mockRes()
    await addressHandler(mockReq({}), res)
    expect(res.captured.status).toBe(400)
  })

  it('404s for an unknown address and marks the answer non-authoritative', async () => {
    const res = mockRes()
    await addressHandler(mockReq({ address: 'CUNKNOWN' }), res)

    expect(res.captured.status).toBe(404)
    // A token created since the last ingest run is legitimately absent, so the
    // client must fall through to RPC rather than reporting "does not exist".
    expect(res.captured.body).toMatchObject({ authoritative: false })
  })
})
