import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ContractEvent, GetEventsResult, TokenInfo } from '../types'

vi.mock('../config/stellar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/stellar')>()
  return {
    ...actual,
    STELLAR_CONFIG: { ...actual.STELLAR_CONFIG, factoryContractId: 'CFACTORY' },
  }
})

import { StellarService, RPC_EVENT_RETENTION_DAYS } from './stellar-impl'

/** Matches the default page size in `fetchAllContractEvents`. */
const PAGE_SIZE = 100

const tokenInfo = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  name: 'AncientToken',
  symbol: 'OLD',
  decimals: 18,
  creator: 'GCREATOR',
  createdAt: 1_700_000_042,
  ...overrides,
})

const event = (
  type: ContractEvent['type'],
  ledger: number,
  address: string,
  extra: Record<string, string> = {},
): ContractEvent => ({
  id: `${type}-${ledger}`,
  type,
  ledger,
  timestamp: 1_700_000_000 + ledger,
  txHash: `tx-${ledger}`,
  data: { tokenAddress: address, ...extra },
})

/**
 * Serves `events` in fixed-size pages, mirroring the `getEvents` contract that
 * `fetchAllContractEvents` relies on: ascending ledger order, and a page
 * shorter than the requested limit signals end-of-history.
 */
const pagedSource = (events: ContractEvent[]) =>
  vi.fn(async (_contractId: string, limit = 20, cursor?: string): Promise<GetEventsResult> => {
    const start = cursor ? Number(cursor) : 0
    const slice = events.slice(start, start + limit)
    const next = start + slice.length
    return { events: slice, cursor: next < events.length ? String(next) : null }
  })

describe('StellarService.getTokenInfoByAddress (contract-view resolution)', () => {
  let service: StellarService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new StellarService('testnet')
  })

  test('resolves authoritative identity from the contract regardless of event age', async () => {
    // Regression for #1018: identity used to be derived from factory events, so
    // a token created beyond the first event page fell out of the window and
    // resolved to a placeholder (address-as-name, guessed decimals=7). Reading
    // the on-chain view has no such window — event history is not consulted at
    // all, so decimals are always authoritative.
    const viewSpy = vi
      .spyOn(service, 'getTokenInfoByAddressView')
      .mockResolvedValue(tokenInfo({ decimals: 18 }))
    vi.spyOn(service, 'getTokenMetadataUri').mockResolvedValue('ipfs://QmMeta')

    const info = await service.getTokenInfoByAddress('C_TOKEN')

    expect(info.name).toBe('AncientToken')
    expect(info.symbol).toBe('OLD')
    expect(info.decimals).toBe(18) // never a guessed 7
    expect(info.creator).toBe('GCREATOR')
    expect(info.metadataUri).toBe('ipfs://QmMeta')
    expect(viewSpy).toHaveBeenCalledWith('C_TOKEN')
  })

  test('throws "No token found" when the factory has no such token', async () => {
    // Contract surfaces TokenNotFound (code 4), mapped to "Token not found."
    vi.spyOn(service, 'getTokenInfoByAddressView').mockRejectedValue(new Error('Token not found.'))

    await expect(service.getTokenInfoByAddress('C_MISSING')).rejects.toThrow(
      /No token found at address C_MISSING/,
    )
  })
})

describe('StellarService.resolveTokenInfoByAddress (typed result)', () => {
  let service: StellarService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new StellarService('testnet')
  })

  test('returns a resolved result with metadata', async () => {
    vi.spyOn(service, 'getTokenInfoByAddressView').mockResolvedValue(tokenInfo())
    vi.spyOn(service, 'getTokenMetadataUri').mockResolvedValue('ipfs://QmMeta')

    const result = await service.resolveTokenInfoByAddress('C_TOKEN')

    expect(result).toMatchObject({
      status: 'resolved',
      decimals: 18,
      metadataUri: 'ipfs://QmMeta',
    })
  })

  test('marks not-found addresses unresolved instead of fabricating a placeholder', async () => {
    vi.spyOn(service, 'getTokenInfoByAddressView').mockRejectedValue(new Error('Token not found.'))

    const result = await service.resolveTokenInfoByAddress('C_MISSING')

    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('not-found')
      expect(result.address).toBe('C_MISSING')
    }
  })

  test('classifies transport failures as rpc-error, not not-found', async () => {
    vi.spyOn(service, 'getTokenInfoByAddressView').mockRejectedValue(
      new Error('Network timeout. The Stellar network did not respond in time.'),
    )

    const result = await service.resolveTokenInfoByAddress('C_TOKEN')

    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('rpc-error')
    }
  })

  test('a metadata read failure does not downgrade a resolved token', async () => {
    vi.spyOn(service, 'getTokenInfoByAddressView').mockResolvedValue(tokenInfo())
    vi.spyOn(service, 'getTokenMetadataUri').mockRejectedValue(new Error('transient'))

    const result = await service.resolveTokenInfoByAddress('C_TOKEN')

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.metadataUri).toBe('')
    }
  })
})

describe('StellarService.getTokenEvents (paginated history + retention)', () => {
  let service: StellarService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new StellarService('testnet')
  })

  test('returns token history from beyond the first event page', async () => {
    // 150 unrelated events precede this token's events, pushing them past the
    // first 100-event page. A single fixed-size call would have dropped them;
    // exhaustive pagination surfaces the complete retained history.
    const noise = Array.from({ length: 150 }, (_, i) => event('created', i + 1, `C_OTHER_${i}`))
    const mine = [
      event('created', 200, 'C_MINE', { name: 'Mine', creator: 'G1' }),
      event('mint', 205, 'C_MINE', { to: 'G2', amount: '100' }),
      event('burn', 210, 'C_MINE', { from: 'G2', amount: '40' }),
    ]
    const getContractEvents = pagedSource([...noise, ...mine])
    vi.spyOn(service, 'getContractEvents').mockImplementation(getContractEvents)

    const result = await service.getTokenEvents('C_MINE')

    expect(result.events.map((e) => e.type)).toEqual(['burn', 'mint', 'created']) // newest first
    expect(getContractEvents.mock.calls.length).toBeGreaterThan(1)
    expect(getContractEvents.mock.calls[0]?.[1]).toBe(PAGE_SIZE)
  })

  test('always discloses the RPC retention boundary', async () => {
    vi.spyOn(service, 'getContractEvents').mockImplementation(
      pagedSource([event('created', 1, 'C_MINE')]),
    )

    const result = await service.getTokenEvents('C_MINE')

    expect(result.retentionLimited).toBe(true)
    expect(result.retentionDays).toBe(RPC_EVENT_RETENTION_DAYS)
  })
})
