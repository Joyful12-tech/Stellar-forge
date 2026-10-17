import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { FactoryState, TokenInfo } from '../types'

vi.mock('../config/stellar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/stellar')>()
  return {
    ...actual,
    STELLAR_CONFIG: { ...actual.STELLAR_CONFIG, factoryContractId: 'CFACTORY' },
  }
})

import { StellarService } from './stellar-impl'

const factoryState = (tokenCount: number): FactoryState => ({
  admin: 'GADMIN',
  paused: false,
  treasury: 'GTREASURY',
  baseFee: '0',
  metadataFee: '0',
  tokenCount,
  whitelistEnabled: false,
})

/** A deterministic TokenInfo keyed by its 1-based contract index. */
const tokenAt = (index: number): TokenInfo => ({
  name: `Token ${index}`,
  symbol: `TK${index}`,
  decimals: 7,
  creator: `GCREATOR${index}`,
  createdAt: 1_700_000_000 + index,
})

describe('StellarService.getAllTokens', () => {
  let service: StellarService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new StellarService('testnet')
  })

  test('first page returns the newest tokens first', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(25))
    const getTokenInfo = vi
      .spyOn(service, 'getTokenInfo')
      .mockImplementation(async (i: number) => tokenAt(i))

    const { tokens, total } = await service.getAllTokens(0, 10)

    expect(total).toBe(25)
    expect(tokens).toHaveLength(10)
    // Newest-first: index 25 down to 16.
    expect(tokens.map((t) => t.index)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16])
    const requested = getTokenInfo.mock.calls.map((c) => c[0]).sort((a, b) => a - b)
    expect(requested).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
  })

  test('last page is partial and stops at index 1', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(25))
    const getTokenInfo = vi
      .spyOn(service, 'getTokenInfo')
      .mockImplementation(async (i: number) => tokenAt(i))

    // offset 20 → highIndex 5, window [5..1].
    const { tokens, total } = await service.getAllTokens(20, 10)

    expect(total).toBe(25)
    expect(tokens.map((t) => t.index)).toEqual([5, 4, 3, 2, 1])
    // Never reads a non-existent index 0 or negative.
    expect(getTokenInfo.mock.calls.every((c) => c[0] >= 1)).toBe(true)
  })

  test('offset past the oldest token yields an empty page but a truthful total', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(25))
    const getTokenInfo = vi.spyOn(service, 'getTokenInfo').mockResolvedValue(tokenAt(1))

    const { tokens, total } = await service.getAllTokens(30, 10)

    expect(tokens).toEqual([])
    expect(total).toBe(25) // distinguishable from "zero tokens exist"
    expect(getTokenInfo).not.toHaveBeenCalled()
  })

  test('an empty factory returns zero tokens without any index reads', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(0))
    const getTokenInfo = vi.spyOn(service, 'getTokenInfo').mockResolvedValue(tokenAt(1))

    const { tokens, total } = await service.getAllTokens(0, 10)

    expect(tokens).toEqual([])
    expect(total).toBe(0)
    expect(getTokenInfo).not.toHaveBeenCalled()
  })

  test('a non-positive limit returns no tokens but the real total', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(5))
    const getTokenInfo = vi.spyOn(service, 'getTokenInfo').mockResolvedValue(tokenAt(1))

    const { tokens, total } = await service.getAllTokens(0, 0)

    expect(tokens).toEqual([])
    expect(total).toBe(5)
    expect(getTokenInfo).not.toHaveBeenCalled()
  })

  test('defaults to the first page of ten when called with no arguments', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(3))
    vi.spyOn(service, 'getTokenInfo').mockImplementation(async (i: number) => tokenAt(i))

    const { tokens, total } = await service.getAllTokens()

    expect(total).toBe(3)
    expect(tokens.map((t) => t.index)).toEqual([3, 2, 1])
  })

  test('individual index-read failures are skipped, not fatal', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(5))
    vi.spyOn(service, 'getTokenInfo').mockImplementation(async (i: number) => {
      if (i === 3) throw new Error('transient RPC error at index 3')
      return tokenAt(i)
    })

    const { tokens, total } = await service.getAllTokens(0, 10)

    expect(total).toBe(5)
    // Index 3 dropped; the rest of the page still resolves, newest-first.
    expect(tokens.map((t) => t.index)).toEqual([5, 4, 2, 1])
  })

  test('throws (never a fake-empty list) when every index read in the window fails', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(5))
    vi.spyOn(service, 'getTokenInfo').mockRejectedValue(new Error('RPC unavailable'))

    await expect(service.getAllTokens(0, 10)).rejects.toThrow('RPC unavailable')
  })

  test('propagates a factory-state read failure rather than reporting zero tokens', async () => {
    vi.spyOn(service, 'getFactoryState').mockRejectedValue(new Error('cannot read factory state'))
    const getTokenInfo = vi.spyOn(service, 'getTokenInfo')

    await expect(service.getAllTokens(0, 10)).rejects.toThrow('cannot read factory state')
    expect(getTokenInfo).not.toHaveBeenCalled()
  })

  test('bounds in-flight index reads to the concurrency cap', async () => {
    vi.spyOn(service, 'getFactoryState').mockResolvedValue(factoryState(50))

    let inFlight = 0
    let maxInFlight = 0
    vi.spyOn(service, 'getTokenInfo').mockImplementation(async (i: number) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return tokenAt(i)
    })

    const { tokens } = await service.getAllTokens(0, 30)

    expect(tokens).toHaveLength(30)
    // GET_ALL_TOKENS_CONCURRENCY is 5 — the window is fetched in bounded batches.
    expect(maxInFlight).toBeLessThanOrEqual(5)
  })

  test('snapshot pins page windows — no duplicate or skipped token when a new token is created between page fetches', async () => {
    // Simulate a factory that starts with 20 tokens. The user fetches page 1
    // using a snapshot of tokenCount=20. Between page 1 and page 2, a new token
    // (index 21) is created, making tokenCount=21.
    //
    // Without a snapshot, page 2 would compute:
    //   highIndex = 21 - 10 = 11  → window [11..2]
    // which overlaps with page 1's window [20..11] at index 11 (duplicate).
    //
    // With the snapshot (tokenCount=20), page 2 computes:
    //   highIndex = 20 - 10 = 10  → window [10..1]
    // which is exactly non-overlapping: pages cover [20..11] then [10..1].

    const snapshot = 20

    // Page 1: pass snapshot=20, factory would report 20 anyway (not called).
    const getFactoryState = vi.spyOn(service, 'getFactoryState')
    vi.spyOn(service, 'getTokenInfo').mockImplementation(async (i: number) => tokenAt(i))

    const page1 = await service.getAllTokens(0, 10, snapshot)

    // getFactoryState must NOT have been called — the snapshot bypasses it.
    expect(getFactoryState).not.toHaveBeenCalled()
    expect(page1.total).toBe(20)
    expect(page1.tokens.map((t) => t.index)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])

    // A new token is now created on-chain (tokenCount becomes 21).
    // getAllTokens must still use the caller-supplied snapshot=20, not re-read
    // the chain, so the page 2 window remains anchored to the same baseline.

    const page2 = await service.getAllTokens(10, 10, snapshot)

    expect(getFactoryState).not.toHaveBeenCalled()
    expect(page2.total).toBe(20)
    expect(page2.tokens.map((t) => t.index)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])

    // Verify: no index appears in both pages (no duplicates).
    const page1Indices = new Set(page1.tokens.map((t) => t.index))
    const page2Indices = page2.tokens.map((t) => t.index)
    expect(page2Indices.every((i) => !page1Indices.has(i))).toBe(true)

    // Verify: together they cover every index from 1 to 20 exactly once (no gaps).
    const allIndices = [...page1.tokens, ...page2.tokens]
      .map((t) => t.index)
      .sort((a, b) => a! - b!)
    expect(allIndices).toEqual(Array.from({ length: 20 }, (_, k) => k + 1))
  })
})
