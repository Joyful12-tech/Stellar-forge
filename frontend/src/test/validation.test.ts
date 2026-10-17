import { describe, it, expect } from 'vitest'
import { isValidIPFSUri } from '../utils/validation'

describe('isValidIPFSUri', () => {
  it('accepts a valid CIDv0 URI', () => {
    expect(isValidIPFSUri('ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')).toBe(true)
  })

  it('accepts a valid CIDv1 URI', () => {
    expect(
      isValidIPFSUri('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    ).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidIPFSUri('')).toBe(false)
  })

  it('rejects an HTTP URL', () => {
    expect(isValidIPFSUri('https://example.com/image.png')).toBe(false)
  })

  it('rejects ipfs:// with no CID', () => {
    expect(isValidIPFSUri('ipfs://')).toBe(false)
  })

  it('rejects a malformed CID', () => {
    expect(isValidIPFSUri('ipfs://notacid')).toBe(false)
  })

  it('rejects a plain CID without ipfs:// prefix', () => {
    expect(isValidIPFSUri('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')).toBe(false)
  })
})

import { validateTokenParams } from '../utils/validation'

const base = { name: 'MyToken', symbol: 'MTK', initialSupply: '1000' }

describe('validateTokenParams - decimals', () => {
  it('accepts decimals = 0', () => {
    expect(validateTokenParams({ ...base, decimals: 0 }).valid).toBe(true)
  })

  it('accepts decimals = 18', () => {
    expect(validateTokenParams({ ...base, decimals: 18 }).valid).toBe(true)
  })

  it('rejects decimals = -1', () => {
    const { valid, errors } = validateTokenParams({ ...base, decimals: -1 })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })

  it('rejects decimals = 19', () => {
    const { valid, errors } = validateTokenParams({ ...base, decimals: 19 })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })

  it('rejects missing decimals', () => {
    const { valid, errors } = validateTokenParams({ ...base })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })
})

import {
  isValidStellarAddress,
  isValidContractAddress,
  isValidImageFile,
  validateTokenName,
  validateTokenSymbol,
  validateDecimals,
} from '../utils/validation'
import { makeImageFile, makeTextFile, PNG_HEADER, JPEG_HEADER, GIF_HEADER } from './imageFixtures'

// A real valid Ed25519 public key (generated via Keypair.random())
const VALID_ACCOUNT = 'GDNQ2ULB7MXLA4GJBTAAZQON3IEO4HUCYFQMAHVAA2RTC4L4B4G5IK4C'
// Same address with last char flipped — valid format, invalid checksum
const INVALID_CHECKSUM_ACCOUNT =
  VALID_ACCOUNT.slice(0, 55) + (VALID_ACCOUNT[55] === 'N' ? 'M' : 'N')
// A real valid contract address (C...)
const VALID_CONTRACT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE'

describe('isValidStellarAddress', () => {
  it('accepts a real valid G address', () => {
    expect(isValidStellarAddress(VALID_ACCOUNT)).toBe(true)
  })

  it('rejects an address with valid format but invalid checksum', () => {
    expect(isValidStellarAddress(INVALID_CHECKSUM_ACCOUNT)).toBe(false)
  })

  it('rejects an address not starting with G', () => {
    expect(isValidStellarAddress('A' + 'A'.repeat(55))).toBe(false)
  })

  it('rejects an address that is too short', () => {
    expect(isValidStellarAddress('GABC')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false)
  })

  it('rejects a contract address (C...) as an account address', () => {
    expect(isValidStellarAddress(VALID_CONTRACT)).toBe(false)
  })
})

describe('isValidContractAddress', () => {
  it('accepts a valid contract address (C...)', () => {
    expect(isValidContractAddress(VALID_CONTRACT)).toBe(true)
  })

  it('rejects an account address (G...) as a contract address', () => {
    expect(isValidContractAddress(VALID_ACCOUNT)).toBe(false)
  })

  it('rejects an address that is too short', () => {
    expect(isValidContractAddress('CABC')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidContractAddress('')).toBe(false)
  })
})

describe('isValidImageFile', () => {
  it('accepts a real JPEG under the size limit', async () => {
    const file = makeImageFile(JPEG_HEADER, 'a.jpg', 'image/jpeg')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('accepts a real PNG under the size limit', async () => {
    const file = makeImageFile(PNG_HEADER, 'a.png', 'image/png')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('accepts a real GIF under the size limit', async () => {
    const file = makeImageFile(GIF_HEADER, 'a.gif', 'image/gif')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('rejects an unsupported file type', async () => {
    const result = await isValidImageFile(makeTextFile('RIFFxxxxWEBP', 'a.webp', 'image/webp'))
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects content that does not match its declared image type', async () => {
    const result = await isValidImageFile(makeTextFile('not an image', 'a.png', 'image/png'))
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects a file over the 4MB limit', async () => {
    const result = await isValidImageFile(
      makeImageFile(PNG_HEADER, 'big.png', 'image/png', 4 * 1024 * 1024 + 1),
    )
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('validateTokenName', () => {
  it('accepts a name within bounds', () => {
    expect(validateTokenName('MyToken')).toBe(true)
  })

  it('accepts a single character name', () => {
    expect(validateTokenName('A')).toBe(true)
  })

  it('accepts a 32-character name', () => {
    expect(validateTokenName('A'.repeat(32))).toBe(true)
  })

  it('accepts a name with spaces, hyphens, and underscores', () => {
    expect(validateTokenName('My Token-Name_1')).toBe(true)
  })

  it('strips leading/trailing whitespace before validating', () => {
    expect(validateTokenName('  MyToken  ')).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(validateTokenName('')).toBe(false)
  })

  it('rejects a name over 32 bytes', () => {
    expect(validateTokenName('A'.repeat(33))).toBe(false)
  })

  it('accepts a name with special characters (contract accepts all non-control chars)', () => {
    expect(validateTokenName('<script>alert(1)</script>')).toBe(true)
    expect(validateTokenName('Token<Name>')).toBe(true)
    expect(validateTokenName('Token&Name')).toBe(true)
    expect(validateTokenName('Token"Name')).toBe(true)
  })
})

describe('validateTokenSymbol', () => {
  it('accepts a valid symbol', () => {
    expect(validateTokenSymbol('MTK')).toBe(true)
  })

  it('accepts a single character symbol', () => {
    expect(validateTokenSymbol('X')).toBe(true)
  })

  it('accepts a 12-byte symbol', () => {
    expect(validateTokenSymbol('A'.repeat(12))).toBe(true)
  })

  it('strips leading/trailing whitespace before validating', () => {
    expect(validateTokenSymbol('  MTK  ')).toBe(true)
  })

  it('rejects an empty symbol', () => {
    expect(validateTokenSymbol('')).toBe(false)
  })

  it('rejects a symbol over 12 bytes', () => {
    expect(validateTokenSymbol('A'.repeat(13))).toBe(false)
  })

  it('rejects a symbol with special characters', () => {
    expect(validateTokenSymbol('MT<K>')).toBe(false)
  })

  it('rejects a symbol with spaces', () => {
    expect(validateTokenSymbol('MT K')).toBe(false)
  })

  it('rejects a symbol with HTML entities', () => {
    expect(validateTokenSymbol('MT&K')).toBe(false)
  })
})

describe('validateDecimals', () => {
  it('accepts 0', () => {
    expect(validateDecimals(0)).toBe(true)
  })

  it('accepts 18', () => {
    expect(validateDecimals(18)).toBe(true)
  })

  it('rejects -1', () => {
    expect(validateDecimals(-1)).toBe(false)
  })

  it('rejects 19', () => {
    expect(validateDecimals(19)).toBe(false)
  })
})

// ── validateTokenParams — maxSupply (issue #1022) ─────────────────────────────
//
// These tests mirror the contract's own validate_token_params guards so the
// frontend and the on-chain logic stay in sync:
//   - a positive cap >= initial_supply is valid
//   - a cap of 0 or negative is rejected
//   - a cap below initial_supply is rejected
//   - an empty/absent maxSupply means "uncapped" and is always valid
//
// Corresponds to the contract-side tests in test.rs:
//   test_create_token_max_supply_below_initial_rejected (test.rs:277)
//   test_create_token_nonpositive_max_supply_rejected (test.rs:296)

const baseWithSupply = { name: 'Token', symbol: 'TKN', decimals: 7, initialSupply: '1000' }

describe('validateTokenParams — maxSupply', () => {
  it('accepts an empty maxSupply (uncapped token)', () => {
    const { valid, errors } = validateTokenParams({ ...baseWithSupply, maxSupply: '' })
    expect(valid).toBe(true)
    expect(errors.maxSupply).toBeUndefined()
  })

  it('accepts an absent maxSupply (uncapped token)', () => {
    const { valid, errors } = validateTokenParams({ ...baseWithSupply })
    expect(valid).toBe(true)
    expect(errors.maxSupply).toBeUndefined()
  })

  it('accepts a cap equal to initial supply', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      maxSupply: '1000',
    })
    expect(valid).toBe(true)
    expect(errors.maxSupply).toBeUndefined()
  })

  it('accepts a cap greater than initial supply', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      maxSupply: '5000',
    })
    expect(valid).toBe(true)
    expect(errors.maxSupply).toBeUndefined()
  })

  it('rejects a cap of zero (mirrors test_create_token_nonpositive_max_supply_rejected)', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      initialSupply: '0',
      maxSupply: '0',
    })
    expect(valid).toBe(false)
    expect(errors.maxSupply).toBeDefined()
  })

  it('rejects a negative cap', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      maxSupply: '-1',
    })
    expect(valid).toBe(false)
    expect(errors.maxSupply).toBeDefined()
  })

  it('rejects a cap below initial supply (mirrors test_create_token_max_supply_below_initial_rejected)', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      initialSupply: '1000',
      maxSupply: '500',
    })
    expect(valid).toBe(false)
    expect(errors.maxSupply).toBeDefined()
  })

  it('rejects a non-numeric maxSupply', () => {
    const { valid, errors } = validateTokenParams({
      ...baseWithSupply,
      maxSupply: 'not-a-number',
    })
    expect(valid).toBe(false)
    expect(errors.maxSupply).toBeDefined()
  })
})
