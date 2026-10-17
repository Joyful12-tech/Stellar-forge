import { describe, it, expect } from 'vitest'
import { validateTokenParams } from '../utils/validation'

const valid = { name: 'MyToken', symbol: 'MTK', decimals: 7, initialSupply: '1000' }

describe('validateTokenParams - valid input', () => {
  it('accepts a fully valid set of params', () => {
    expect(validateTokenParams(valid).valid).toBe(true)
  })

  it('returns no errors for valid params', () => {
    expect(validateTokenParams(valid).errors).toEqual({})
  })
})

describe('validateTokenParams - name', () => {
  it('accepts a 1-character name', () => {
    expect(validateTokenParams({ ...valid, name: 'A' }).valid).toBe(true)
  })

  it('accepts a 32-byte name', () => {
    expect(validateTokenParams({ ...valid, name: 'A'.repeat(32) }).valid).toBe(true)
  })

  it('strips leading/trailing whitespace from name', () => {
    expect(validateTokenParams({ ...valid, name: '  MyToken  ' }).valid).toBe(true)
  })

  it('accepts spaces, hyphens, and underscores in a name', () => {
    expect(validateTokenParams({ ...valid, name: 'My Token_Name' }).valid).toBe(true)
  })

  it('accepts non-Latin scripts the contract accepts (Café / 日本コイン / Наира / نايرا)', () => {
    for (const name of ['Café', '日本コイン', 'Наира', 'نايرا']) {
      expect(validateTokenParams({ ...valid, name }).valid).toBe(true)
    }
  })

  it('rejects a name containing a control character', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, name: 'Token\x00Name' })
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects a name containing a zero-width space', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, name: 'To\u200Bken' })
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects a name containing a bidirectional override', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, name: 'To\u202Eken' })
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects an unpaired surrogate name that cannot be UTF-8 encoded', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, name: 'Bad\uD800Name' })
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects an empty name', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, name: '' })
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('accepts a name of exactly 32 UTF-8 bytes in a multi-byte script', () => {
    // '日' is 3 UTF-8 bytes; 10 × 3 = 30 bytes, plus 2 ASCII = 32 bytes
    const name = `${'日'.repeat(10)}ab`
    const { valid: ok, errors } = validateTokenParams({ ...valid, name })
    expect(ok).toBe(true)
    expect(new TextEncoder().encode(name).length).toBe(32)
    expect(errors.name).toBeUndefined()
  })

  it('rejects a name over 32 UTF-8 bytes counting bytes not code units', () => {
    // 11 × 3 = 33 bytes for '日'.repeat(11) — passes a code-unit check
    // (length 11) but must fail a byte check matching the contract.
    const name = '日'.repeat(11)
    const { valid: ok, errors } = validateTokenParams({ ...valid, name })
    expect(ok).toBe(false)
    expect(new TextEncoder().encode(name).length).toBe(33)
    expect(errors.name).toBeDefined()
  })

  it('rejects undefined name', () => {
    const { name: _n, ...rest } = valid
    const { valid: ok, errors } = validateTokenParams(rest)
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
  })
})

describe('validateTokenParams - symbol', () => {
  it('accepts a 1-character symbol', () => {
    expect(validateTokenParams({ ...valid, symbol: 'X' }).valid).toBe(true)
  })

  it('accepts a 12-byte symbol', () => {
    expect(validateTokenParams({ ...valid, symbol: 'A'.repeat(12) }).valid).toBe(true)
  })

  it('accepts a symbol with hyphens', () => {
    expect(validateTokenParams({ ...valid, symbol: 'MY-TOKEN' }).valid).toBe(true)
  })

  it('rejects a symbol with non-ASCII characters', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, symbol: 'TOKÉN' })
    expect(ok).toBe(false)
    expect(errors.symbol).toBeDefined()
  })

  it('rejects an empty symbol', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, symbol: '' })
    expect(ok).toBe(false)
    expect(errors.symbol).toBeDefined()
  })

  it('rejects a symbol over 12 bytes', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, symbol: 'A'.repeat(13) })
    expect(ok).toBe(false)
    expect(errors.symbol).toBeDefined()
  })

  it('rejects undefined symbol', () => {
    const { symbol: _s, ...rest } = valid
    const { valid: ok, errors } = validateTokenParams(rest)
    expect(ok).toBe(false)
    expect(errors.symbol).toBeDefined()
  })
})

describe('validateTokenParams - initialSupply', () => {
  it('accepts a positive supply', () => {
    expect(validateTokenParams({ ...valid, initialSupply: '1' }).valid).toBe(true)
  })

  it('accepts a large supply', () => {
    expect(validateTokenParams({ ...valid, initialSupply: '999999999' }).valid).toBe(true)
  })

  it('rejects zero supply', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, initialSupply: '0' })
    expect(ok).toBe(false)
    expect(errors.initialSupply).toBeDefined()
  })

  it('rejects a negative supply', () => {
    const { valid: ok, errors } = validateTokenParams({ ...valid, initialSupply: '-1' })
    expect(ok).toBe(false)
    expect(errors.initialSupply).toBeDefined()
  })

  it('rejects undefined supply', () => {
    const { initialSupply: _i, ...rest } = valid
    const { valid: ok, errors } = validateTokenParams(rest)
    expect(ok).toBe(false)
    expect(errors.initialSupply).toBeDefined()
  })
})

describe('validateTokenParams - multiple errors', () => {
  it('reports all invalid fields at once', () => {
    const { valid: ok, errors } = validateTokenParams({})
    expect(ok).toBe(false)
    expect(errors.name).toBeDefined()
    expect(errors.symbol).toBeDefined()
    expect(errors.decimals).toBeDefined()
    expect(errors.initialSupply).toBeDefined()
  })
})
