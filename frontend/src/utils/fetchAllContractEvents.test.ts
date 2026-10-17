import { describe, test, expect, vi } from 'vitest'
import { fetchAllContractEvents, type ContractEventSource } from './fetchAllContractEvents'
import type { ContractEvent } from '../types'

function makeEvent(ledger: number): ContractEvent {
  return {
    id: String(ledger),
    type: 'created',
    ledger,
    timestamp: ledger,
    txHash: `tx${ledger}`,
    data: { tokenAddress: `CADDR${ledger}` },
  }
}

describe('fetchAllContractEvents', () => {
  test('returns all events from a single short page without pagination', async () => {
    const events = [makeEvent(1), makeEvent(2)]
    const source: ContractEventSource = {
      getContractEvents: vi.fn().mockResolvedValue({ events, cursor: 'c1' }),
    }

    const result = await fetchAllContractEvents(source, 'CFACTORY', 100)

    expect(result).toEqual(events)
    expect(source.getContractEvents).toHaveBeenCalledTimes(1)
  })

  // This is the exact scenario that caused the "all tokens" explorer to
  // silently drop newly-created tokens: a factory with more created events
  // than fit in one page. A single fixed-size call would only see the first
  // page; pagination via the cursor must walk forward to collect the rest.
  test('pages through the cursor until a short page signals end-of-data', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeEvent(i))
    const page2 = Array.from({ length: 100 }, (_, i) => makeEvent(100 + i))
    const page3 = Array.from({ length: 30 }, (_, i) => makeEvent(200 + i))

    const getContractEvents = vi
      .fn()
      .mockResolvedValueOnce({ events: page1, cursor: 'c1' })
      .mockResolvedValueOnce({ events: page2, cursor: 'c2' })
      .mockResolvedValueOnce({ events: page3, cursor: 'c3' })
    const source: ContractEventSource = { getContractEvents }

    const result = await fetchAllContractEvents(source, 'CFACTORY', 100)

    expect(result).toHaveLength(230)
    expect(getContractEvents).toHaveBeenCalledTimes(3)
    expect(getContractEvents).toHaveBeenNthCalledWith(1, 'CFACTORY', 100, undefined)
    expect(getContractEvents).toHaveBeenNthCalledWith(2, 'CFACTORY', 100, 'c1')
    expect(getContractEvents).toHaveBeenNthCalledWith(3, 'CFACTORY', 100, 'c2')
  })

  test('stops when the cursor comes back null even on a full page', async () => {
    const page = Array.from({ length: 100 }, (_, i) => makeEvent(i))
    const getContractEvents = vi.fn().mockResolvedValueOnce({ events: page, cursor: null })
    const source: ContractEventSource = { getContractEvents }

    const result = await fetchAllContractEvents(source, 'CFACTORY', 100)

    expect(result).toHaveLength(100)
    expect(getContractEvents).toHaveBeenCalledTimes(1)
  })

  test('returns an empty list when there are no events', async () => {
    const source: ContractEventSource = {
      getContractEvents: vi.fn().mockResolvedValue({ events: [], cursor: null }),
    }

    const result = await fetchAllContractEvents(source, 'CFACTORY', 100)

    expect(result).toEqual([])
  })
})
