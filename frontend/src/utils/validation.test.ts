import { describe, it, expect } from 'vitest'
import { isValidStellarAddress, validateTokenParams, isValidImageFile } from './validation'
import {
  makeImageFile,
  makeTextFile,
  PNG_HEADER,
  JPEG_HEADER,
  GIF_HEADER,
} from '../test/imageFixtures'

// Real valid Ed25519 public key
const VALID_ADDRESS = 'GDNQ2ULB7MXLA4GJBTAAZQON3IEO4HUCYFQMAHVAA2RTC4L4B4G5IK4C'

describe('isValidStellarAddress', () => {
  it('accepts a valid G-address', () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true)
  })

  it('rejects an address that is too short', () => {
    expect(isValidStellarAddress('GABC')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false)
  })

  it('rejects a string not starting with G', () => {
    expect(isValidStellarAddress('XABC' + 'A'.repeat(52))).toBe(false)
  })

  it('rejects a malformed string', () => {
    expect(isValidStellarAddress('not-a-stellar-address')).toBe(false)
  })

  it('rejects a contract address (C...) as an account address', () => {
    expect(isValidStellarAddress('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE')).toBe(
      false,
    )
  })
})

const BASE = { name: 'MyToken', symbol: 'MTK', decimals: 7, initialSupply: '1000' }

describe('validateTokenParams', () => {
  it('accepts a fully valid object', () => {
    expect(validateTokenParams(BASE).valid).toBe(true)
  })

  it('rejects missing name', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, name: '' })
    expect(valid).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects name longer than 32 bytes', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, name: 'A'.repeat(33) })
    expect(valid).toBe(false)
    expect(errors.name).toBeDefined()
  })

  it('rejects missing symbol', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, symbol: '' })
    expect(valid).toBe(false)
    expect(errors.symbol).toBeDefined()
  })

  it('rejects symbol longer than 12 bytes', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, symbol: 'A'.repeat(13) })
    expect(valid).toBe(false)
    expect(errors.symbol).toBeDefined()
  })

  it('accepts decimals = 0 (boundary)', () => {
    expect(validateTokenParams({ ...BASE, decimals: 0 }).valid).toBe(true)
  })

  it('accepts decimals = 18 (boundary)', () => {
    expect(validateTokenParams({ ...BASE, decimals: 18 }).valid).toBe(true)
  })

  it('rejects decimals = -1', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, decimals: -1 })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })

  it('rejects decimals = 19', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, decimals: 19 })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })

  it('rejects missing decimals', () => {
    const { valid, errors } = validateTokenParams({
      name: BASE.name,
      symbol: BASE.symbol,
      initialSupply: BASE.initialSupply,
    })
    expect(valid).toBe(false)
    expect(errors.decimals).toBeDefined()
  })

  it('rejects zero initial supply', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, initialSupply: '0' })
    expect(valid).toBe(false)
    expect(errors.initialSupply).toBeDefined()
  })

  it('rejects missing initial supply', () => {
    const { valid, errors } = validateTokenParams({ ...BASE, initialSupply: '' })
    expect(valid).toBe(false)
    expect(errors.initialSupply).toBeDefined()
  })
})

describe('isValidImageFile', () => {
  it('accepts a real PNG under the size limit', async () => {
    const file = makeImageFile(PNG_HEADER, 'a.png', 'image/png')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('accepts a real JPEG under the size limit', async () => {
    const file = makeImageFile(JPEG_HEADER, 'a.jpg', 'image/jpeg')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('accepts a real GIF under the size limit', async () => {
    const file = makeImageFile(GIF_HEADER, 'a.gif', 'image/gif')
    expect((await isValidImageFile(file)).valid).toBe(true)
  })

  it('rejects a PDF file', async () => {
    const result = await isValidImageFile(makeTextFile('%PDF-1.4', 'a.pdf', 'application/pdf'))
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects an exe file', async () => {
    const result = await isValidImageFile(makeTextFile('MZ', 'a.exe', 'application/octet-stream'))
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects content that only claims to be an image (spoofed MIME type)', async () => {
    const result = await isValidImageFile(
      makeTextFile('<html><script>alert(1)</script></html>', 'innocent.png', 'image/png'),
    )
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects an SVG declared as PNG', async () => {
    const result = await isValidImageFile(
      makeTextFile('<svg xmlns="http://www.w3.org/2000/svg"/>', 'a.png', 'image/png'),
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a real image whose declared type does not match its content', async () => {
    const result = await isValidImageFile(makeImageFile(PNG_HEADER, 'a.jpg', 'image/jpeg'))
    expect(result.valid).toBe(false)
    expect(result.error).toContain('does not match')
  })

  it('rejects a file over the 4MB limit', async () => {
    const result = await isValidImageFile(
      makeImageFile(PNG_HEADER, 'big.png', 'image/png', 4 * 1024 * 1024 + 1),
    )
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})
