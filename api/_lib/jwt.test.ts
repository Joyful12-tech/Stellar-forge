import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueToken, verifyToken } from './jwt'

const TEST_SECRET = 'test-secret-at-least-32-bytes-long-for-safety'

describe('issueToken / verifyToken', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET
  })

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret
  })

  // ── happy path ────────────────────────────────────────────────────────────

  it('issues a token that verifyToken accepts and returns the correct address', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const payload = verifyToken(token)
    expect(payload.address).toBe(address)
  })

  it('returned payload contains iat and exp within expected range', () => {
    const before = Math.floor(Date.now() / 1000)
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const after = Math.floor(Date.now() / 1000)

    const payload = verifyToken(token)
    expect(payload.iat).toBeGreaterThanOrEqual(before)
    expect(payload.iat).toBeLessThanOrEqual(after)
    // default 5-minute expiry
    expect(payload.exp).toBeGreaterThanOrEqual(before + 5 * 60)
    expect(payload.exp).toBeLessThanOrEqual(after + 5 * 60 + 1)
  })

  // ── tampered payload ──────────────────────────────────────────────────────

  it('rejects a token whose payload has been tampered with', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const [header, , sig] = token.split('.')

    // Replace the payload with a different address
    const maliciousPayload = Buffer.from(
      JSON.stringify({
        address: 'GATTACKER000000000000000000000000000000',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString('base64url')

    const tampered = `${header}.${maliciousPayload}.${sig}`
    expect(() => verifyToken(tampered)).toThrow('Invalid token signature.')
  })

  // ── tampered signature ────────────────────────────────────────────────────

  it('rejects a token with a tampered signature', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const parts = token.split('.')

    // Tamper at the byte level, not the character level. A 32-byte HMAC encodes
    // to 43 base64url characters = 258 bits, so the final character carries two
    // padding bits that decoding discards. Editing that character therefore
    // produces a *different string that decodes to the same 32 bytes* roughly
    // 1 run in 16 — and verifyToken compares decoded buffers, so the token
    // stayed valid and the test failed at exactly that rate.
    const sigBytes = Buffer.from(parts[2]!, 'base64url')
    sigBytes[0] ^= 0xff
    const badSig = sigBytes.toString('base64url')
    expect(badSig).not.toBe(parts[2])

    const tampered = `${parts[0]}.${parts[1]}.${badSig}`
    expect(() => verifyToken(tampered)).toThrow('Invalid token signature.')
  })

  it('rejects a tampered signature no matter which byte was flipped', () => {
    // Guards the regression above from the other direction: every single-byte
    // change must be rejected, so no position in the digest is unchecked.
    const token = issueToken('GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    const parts = token.split('.')
    const original = Buffer.from(parts[2]!, 'base64url')

    for (let i = 0; i < original.length; i++) {
      const sigBytes = Buffer.from(original)
      sigBytes[i] ^= 0xff
      const tampered = `${parts[0]}.${parts[1]}.${sigBytes.toString('base64url')}`
      expect(() => verifyToken(tampered)).toThrow('Invalid token signature.')
    }
  })

  // ── expired token ─────────────────────────────────────────────────────────

  it('rejects an expired token', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    // Issue token that expired 1 second ago
    const token = issueToken(address, -1000)
    expect(() => verifyToken(token)).toThrow('Token has expired.')
  })

  // ── mismatched-length signature input (issue-4 acceptance criterion) ──────

  it('rejects a signature of wrong length without throwing a TypeError from timingSafeEqual', () => {
    // timingSafeEqual throws if its two Buffer arguments differ in byte length.
    // The guard in verifyToken must handle this case and return a clean
    // "Invalid token signature." error rather than letting the TypeError escape.
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const [header, payload] = token.split('.')

    // Craft a signature that is clearly the wrong byte length after base64url decode.
    // One base64url character decodes to 6 bits; "AAAA" decodes to 3 bytes,
    // far shorter than the expected 32-byte HMAC-SHA256 digest.
    const shortSig = 'AAAA'
    const tokenWithShortSig = `${header}.${payload}.${shortSig}`

    // Must not throw a TypeError — must throw the contract's own error.
    expect(() => verifyToken(tokenWithShortSig)).toThrow('Invalid token signature.')
  })

  it('rejects a signature that is longer than the expected 32 bytes', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)
    const [header, payload] = token.split('.')

    // 64 zero-bytes base64url-encoded is longer than 32 bytes
    const longSig = Buffer.alloc(64).toString('base64url')
    const tokenWithLongSig = `${header}.${payload}.${longSig}`

    expect(() => verifyToken(tokenWithLongSig)).toThrow('Invalid token signature.')
  })

  // ── invalid format ────────────────────────────────────────────────────────

  it('rejects a token with fewer than 3 dot-separated parts', () => {
    expect(() => verifyToken('onlyonepart')).toThrow('Invalid token format.')
    expect(() => verifyToken('two.parts')).toThrow('Invalid token format.')
  })

  it('rejects a token with more than 3 dot-separated parts', () => {
    expect(() => verifyToken('a.b.c.d')).toThrow('Invalid token format.')
  })

  // ── missing secret ────────────────────────────────────────────────────────

  it('throws when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET
    expect(() => issueToken('GABC')).toThrow('JWT_SECRET environment variable is not configured.')
  })

  it('verifyToken throws when JWT_SECRET is not configured', () => {
    const token = issueToken('GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    delete process.env.JWT_SECRET
    expect(() => verifyToken(token)).toThrow('JWT_SECRET environment variable is not configured.')
  })

  // ── signature produced with a different secret is rejected ────────────────

  it('rejects a token signed with a different secret', () => {
    const address = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const token = issueToken(address)

    // Switch to a different secret so verifyToken will recompute a different digest
    process.env.JWT_SECRET = 'a-completely-different-secret-value-here'
    expect(() => verifyToken(token)).toThrow('Invalid token signature.')
  })
})
