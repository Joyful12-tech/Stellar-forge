/**
 * Fallback tests for the `TokenSource` seam (issue #943, milestone M4).
 *
 * The spec requires a test per fallback branch — success, error, timeout,
 * stale-lag and 404-falls-through — each asserting that the RPC path is
 * *actually* invoked. A fallback that silently does nothing would reintroduce
 * exactly the silent-wrong-answer class of bug the indexer exists to remove.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createFallbackTokenSource,
  createIndexerTokenSource,
  IndexerNotFoundError,
  IndexerStaleError,
  IndexerTimeoutError,
  type DowngradeReason,
  type TokenSource,
} from './tokenSource'
import type { TokenInfo } from '../types'

const indexedToken: TokenInfo = {
  name: 'Indexed',
  symbol: 'IDX',
  decimals: 7,
  creator: 'GCREATOR',
  createdAt: 1_700_000_000,
  index: 1,
}

const rpcToken: TokenInfo = { ...indexedToken, name: 'FromRpc', symbol: 'RPC' }

function stubSource(overrides: Partial<TokenSource> = {}): TokenSource {
  return {
    getAllTokens: vi.fn(async () => ({ tokens: [indexedToken], total: 1 })),
    getTokenInfoByAddress: vi.fn(async () => indexedToken),
    ...overrides,
  }
}

function rpcSource(): TokenSource {
  return {
    getAllTokens: vi.fn(async () => ({ tokens: [rpcToken], total: 99 })),
    getTokenInfoByAddress: vi.fn(async () => rpcToken),
  }
}

describe('createFallbackTokenSource', () => {
  let downgrades: DowngradeReason[]

  beforeEach(() => {
    downgrades = []
  })

  const compose = (indexer: TokenSource, rpc: TokenSource, timeoutMs = 50) =>
    createFallbackTokenSource(indexer, rpc, {
      timeoutMs,
      onDowngrade: (reason) => downgrades.push(reason),
    })

  it('serves indexed data and does not touch RPC when the indexer is healthy', async () => {
    const rpc = rpcSource()
    const source = compose(stubSource(), rpc)

    const page = await source.getAllTokens(0, 10)

    expect(page.tokens[0]!.symbol).toBe('IDX')
    expect(rpc.getAllTokens).not.toHaveBeenCalled()
    expect(downgrades).toEqual([])
  })

  it('falls back to RPC when the indexer errors', async () => {
    const rpc = rpcSource()
    const indexer = stubSource({
      getAllTokens: vi.fn(async () => {
        throw new Error('indexer 500')
      }),
    })

    const page = await compose(indexer, rpc).getAllTokens(0, 10)

    expect(page.tokens[0]!.symbol).toBe('RPC')
    expect(rpc.getAllTokens).toHaveBeenCalledOnce()
    expect(downgrades).toEqual(['error'])
  })

  it('falls back to RPC when the indexer exceeds its deadline', async () => {
    const rpc = rpcSource()
    const indexer = stubSource({
      // Never settles — a hung indexer must not stall the page.
      getAllTokens: vi.fn(() => new Promise<never>(() => {})),
    })

    const page = await compose(indexer, rpc, 20).getAllTokens(0, 10)

    expect(page.tokens[0]!.symbol).toBe('RPC')
    expect(rpc.getAllTokens).toHaveBeenCalledOnce()
    expect(downgrades).toEqual(['timeout'])
  })

  it('falls back to RPC when the indexer is too far behind', async () => {
    const rpc = rpcSource()
    const indexer = stubSource({
      getAllTokens: vi.fn(async () => {
        throw new IndexerStaleError(3_600)
      }),
    })

    const page = await compose(indexer, rpc).getAllTokens(0, 10)

    expect(page.tokens[0]!.symbol).toBe('RPC')
    expect(rpc.getAllTokens).toHaveBeenCalledOnce()
    expect(downgrades).toEqual(['stale'])
  })

  it('falls through to RPC on a 404, because "not indexed" is not "does not exist"', async () => {
    const rpc = rpcSource()
    const indexer = stubSource({
      getTokenInfoByAddress: vi.fn(async () => {
        throw new IndexerNotFoundError('CTOKEN1')
      }),
    })

    const info = await compose(indexer, rpc).getTokenInfoByAddress('CTOKEN1')

    // A token created since the last ingest run is legitimately absent from
    // the index; RPC is the only correct answer.
    expect(info.symbol).toBe('RPC')
    expect(rpc.getTokenInfoByAddress).toHaveBeenCalledWith('CTOKEN1')
    expect(downgrades).toEqual(['not-found'])
  })

  it('propagates an RPC failure when both sources fail', async () => {
    const rpc: TokenSource = {
      getAllTokens: vi.fn(async () => {
        throw new Error('rpc down')
      }),
      getTokenInfoByAddress: vi.fn(async () => rpcToken),
    }
    const indexer = stubSource({
      getAllTokens: vi.fn(async () => {
        throw new Error('indexer down')
      }),
    })

    await expect(compose(indexer, rpc).getAllTokens(0, 10)).rejects.toThrow('rpc down')
  })

  it('reports every downgrade so the degradation rate stays observable', async () => {
    const rpc = rpcSource()
    const indexer = stubSource({
      getAllTokens: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const source = compose(indexer, rpc)

    await source.getAllTokens(0, 10)
    await source.getAllTokens(0, 10)

    expect(downgrades).toEqual(['error', 'error'])
  })
})

describe('createIndexerTokenSource', () => {
  const okResponse = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

  const payload = {
    address: 'CTOKEN1',
    tokenIndex: 1,
    name: 'Indexed',
    symbol: 'IDX',
    decimals: 7,
    creator: 'GCREATOR',
    createdAt: 1_700_000_000,
    metadataUri: null,
  }

  it('maps the list payload onto TokenInfo', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({
        tokens: [payload],
        nextCursor: null,
        indexedAt: new Date().toISOString(),
      }),
    )

    const source = createIndexerTokenSource({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const page = await source.getAllTokens(0, 10)

    expect(page.tokens).toEqual([
      {
        name: 'Indexed',
        symbol: 'IDX',
        decimals: 7,
        creator: 'GCREATOR',
        createdAt: 1_700_000_000,
        index: 1,
      },
    ])
  })

  it('clamps the request to the requested limit and forwards the cursor', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({ tokens: [], nextCursor: null, indexedAt: new Date().toISOString() }),
    )

    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>
    const source = createIndexerTokenSource({ fetchImpl: spy as unknown as typeof fetch })
    await source.getAllTokens(40, 25)

    const url = String(spy.mock.calls[0]?.[0])
    expect(url).toContain('limit=25')
    expect(url).toContain('cursor=40')
  })

  it('throws IndexerStaleError when indexedAt is older than the lag budget', async () => {
    const stale = new Date(Date.now() - 3_600_000).toISOString()
    const fetchImpl = vi.fn(async () =>
      okResponse({ tokens: [payload], nextCursor: null, indexedAt: stale }),
    )

    const source = createIndexerTokenSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxLagSeconds: 900,
    })

    await expect(source.getAllTokens(0, 10)).rejects.toBeInstanceOf(IndexerStaleError)
  })

  it('throws IndexerNotFoundError on a 404 address lookup', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ error: 'Token not indexed' }, 404))

    const source = createIndexerTokenSource({ fetchImpl: fetchImpl as unknown as typeof fetch })

    await expect(source.getTokenInfoByAddress('CNOPE')).rejects.toBeInstanceOf(IndexerNotFoundError)
  })

  it('throws on any other non-OK status', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ error: 'boom' }, 503))

    const source = createIndexerTokenSource({ fetchImpl: fetchImpl as unknown as typeof fetch })

    await expect(source.getTokenInfoByAddress('CTOKEN1')).rejects.toThrow('Indexer returned 503')
  })

  it('surfaces a metadata URI when the indexer has one', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({
        ...payload,
        metadataUri: 'ipfs://bafyfoo',
        indexedAt: new Date().toISOString(),
      }),
    )

    const source = createIndexerTokenSource({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const info = await source.getTokenInfoByAddress('CTOKEN1')

    expect(info.metadataUri).toBe('ipfs://bafyfoo')
  })
})

describe('IndexerTimeoutError', () => {
  it('is distinguishable from a generic failure so timeouts can be counted', () => {
    expect(new IndexerTimeoutError()).toBeInstanceOf(Error)
    expect(new IndexerTimeoutError().name).toBe('IndexerTimeoutError')
  })
})
