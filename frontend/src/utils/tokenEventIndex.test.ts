import { describe, it, expect } from 'vitest'
import { buildTokenEventIndex } from './tokenEventIndex'
import type { ContractEvent } from '../types'

const event = (
  type: ContractEvent['type'],
  ledger: number,
  data: Record<string, string>,
  id = `${type}-${ledger}`,
): ContractEvent => ({ id, type, ledger, timestamp: ledger, txHash: `tx-${ledger}`, data })

describe('buildTokenEventIndex', () => {
  it('maps creation order to 1-based indices, regardless of input order', () => {
    const { indexToAddress } = buildTokenEventIndex([
      event('created', 30, { tokenAddress: 'C3' }),
      event('created', 10, { tokenAddress: 'C1' }),
      event('mint', 15, { tokenAddress: 'C1' }),
      event('created', 20, { tokenAddress: 'C2' }),
    ])
    expect([...indexToAddress]).toEqual([
      [1, 'C1'],
      [2, 'C2'],
      [3, 'C3'],
    ])
  })

  it('breaks same-ledger ties by event id', () => {
    const { indexToAddress } = buildTokenEventIndex([
      event('created', 5, { tokenAddress: 'CB' }, 'b'),
      event('created', 5, { tokenAddress: 'CA' }, 'a'),
    ])
    expect(indexToAddress.get(1)).toBe('CA')
    expect(indexToAddress.get(2)).toBe('CB')
  })

  it('keeps the latest metadata URI per token', () => {
    const { addressToMeta } = buildTokenEventIndex([
      event('meta', 9, { tokenAddress: 'C1', metadataUri: 'ipfs://new' }),
      event('meta', 3, { tokenAddress: 'C1', metadataUri: 'ipfs://old' }),
    ])
    expect(addressToMeta.get('C1')).toBe('ipfs://new')
  })
})
