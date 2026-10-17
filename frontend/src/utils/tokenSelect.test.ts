import { describe, it, expect } from 'vitest'
import {
  MANUAL_TOKEN_VALUE,
  initialTokenSelection,
  tokenLabel,
  tokenSelectOptions,
} from './tokenSelect'

const token = { address: 'CTOKEN1', name: 'Forge', symbol: 'FRG' }

describe('tokenSelect', () => {
  it('labels a token as Name (SYM)', () => {
    expect(tokenLabel(token)).toBe('Forge (FRG)')
  })

  it('lists tokens followed by manual entry', () => {
    expect(tokenSelectOptions([token])).toEqual([
      { value: 'CTOKEN1', label: 'Forge (FRG)' },
      { value: MANUAL_TOKEN_VALUE, label: 'Manual input…' },
    ])
    expect(tokenSelectOptions([])).toEqual([{ value: MANUAL_TOKEN_VALUE, label: 'Manual input…' }])
  })

  it('prefers the given address, then the first token, then manual entry', () => {
    expect(initialTokenSelection('CGIVEN', [token])).toBe('CGIVEN')
    expect(initialTokenSelection('', [token])).toBe('CTOKEN1')
    expect(initialTokenSelection('', [])).toBe(MANUAL_TOKEN_VALUE)
  })
})
