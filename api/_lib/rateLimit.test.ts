import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  isRateLimited,
  isChallengeRateLimited,
  isActionRateLimited,
  isRateLimitDurable,
  clientIp,
} from './rateLimit'

// ---------------------------------------------------------------------------
// Shared helper — all three exported limit functions use the same in-memory
// fallback when KV is not configured, so the core bucket behaviour is covered
// once for the legacy shim and verified for both new functions.
// ---------------------------------------------------------------------------

describe('isRateLimited (legacy shim — delegates to isActionRateLimited)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests under the limit', async () => {
    const key = `test-key-${Math.random()}`
    for (let i = 0; i < 10; i++) {
      expect(await isRateLimited(key)).toBe(false)
    }
  })

  it('blocks requests once the per-window limit is exceeded', async () => {
    const key = `test-key-${Math.random()}`
    for (let i = 0; i < 10; i++) {
      await isRateLimited(key)
    }
    expect(await isRateLimited(key)).toBe(true)
  })

  it('tracks separate keys independently', async () => {
    const keyA = `key-a-${Math.random()}`
    const keyB = `key-b-${Math.random()}`
    for (let i = 0; i < 10; i++) await isRateLimited(keyA)
    expect(await isRateLimited(keyA)).toBe(true)
    expect(await isRateLimited(keyB)).toBe(false)
  })

  it('resets the count after the window elapses', async () => {
    vi.useFakeTimers()
    const key = `test-key-${Math.random()}`
    for (let i = 0; i < 11; i++) await isRateLimited(key)
    expect(await isRateLimited(key)).toBe(true)

    vi.advanceTimersByTime(15 * 60 * 1000 + 1)

    expect(await isRateLimited(key)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Issue #1162 — split rate-limit buckets
// ---------------------------------------------------------------------------

describe('split rate-limit buckets (issue #1162)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('isChallengeRateLimited and isActionRateLimited use independent buckets for the same identifier', async () => {
    // Use the same string as both an "IP" (challenge) and an "address" (action)
    // so we can confirm the two counters are separate KV namespaces.
    const shared = `addr-${Math.random()}`

    // Exhaust the challenge-issuance bucket for `shared`
    // CHALLENGE_MAX_PER_WINDOW defaults to 20; we drive it to the limit.
    for (let i = 0; i < 20; i++) {
      await isChallengeRateLimited(shared)
    }
    expect(await isChallengeRateLimited(shared)).toBe(true)

    // The action bucket for the same string is untouched — 10 requests must
    // all be allowed (ACTION_MAX_PER_WINDOW defaults to 10).
    for (let i = 0; i < 10; i++) {
      expect(await isActionRateLimited(shared)).toBe(false)
    }
  })

  it("exhausting the action bucket for address A does not affect address A's challenge bucket", async () => {
    const addr = `addr-${Math.random()}`

    // Exhaust the action bucket
    for (let i = 0; i < 10; i++) {
      await isActionRateLimited(addr)
    }
    expect(await isActionRateLimited(addr)).toBe(true)

    // The challenge bucket for the same string (treated as an IP here) is
    // fully independent — first request must still be allowed.
    expect(await isChallengeRateLimited(addr)).toBe(false)
  })

  it('exhausting the action bucket for address A does not block address A from obtaining a challenge (griefing scenario)', async () => {
    // Simulate the griefing scenario from issue #1162 in reverse:
    // an attacker floods the action bucket for address A.  The victim (address
    // A) must still be able to obtain a challenge because challenge issuance is
    // limited by IP, not by address.
    const victimAddress = `GVICTIM${Math.random()}`
    const victimIp = `10.0.0.${Math.floor(Math.random() * 255)}`

    // Exhaust the action bucket for the victim's address
    for (let i = 0; i < 11; i++) {
      await isActionRateLimited(victimAddress)
    }
    expect(await isActionRateLimited(victimAddress)).toBe(true)

    // The victim's own IP can still get a challenge
    expect(await isChallengeRateLimited(victimIp)).toBe(false)
  })

  it('attacker flooding challenge endpoint with victim address does NOT exhaust victim action bucket', async () => {
    // The core griefing scenario from issue #1162:
    // An attacker calls GET /api/auth/challenge?address=<victim> many times.
    // With the old shared bucket this exhausted the victim's action quota too.
    // After the fix the challenge bucket is keyed on IP; the victim's action
    // bucket (keyed on address) must remain untouched.
    const attackerIp = `203.0.113.${Math.floor(Math.random() * 255)}`
    const victimAddress = `GVICTIM${Math.random()}`

    // Attacker exhausts challenge-issuance limit from their IP
    for (let i = 0; i < 20; i++) {
      await isChallengeRateLimited(attackerIp)
    }
    expect(await isChallengeRateLimited(attackerIp)).toBe(true)

    // Victim's authenticated-action quota is completely unaffected
    for (let i = 0; i < 10; i++) {
      expect(await isActionRateLimited(victimAddress)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// clientIp
// ---------------------------------------------------------------------------

describe('clientIp (issue #1114)', () => {
  it('returns the header verbatim when Vercel supplies a single bare IP', () => {
    // This is the only shape that occurs on Vercel: the platform overwrites
    // x-forwarded-for with the client's public IP and discards inbound values.
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5' },
      socket: { remoteAddress: '10.0.0.1' },
    } as never
    expect(clientIp(req)).toBe('203.0.113.5')
  })

  it('reads the leftmost (client) address from a multi-hop x-forwarded-for', () => {
    // Off-Vercel path. The leftmost entry is the originating client; later
    // entries are proxies appended in order. Reading the rightmost entry
    // returned a proxy address and collapsed every client behind that proxy
    // into one rate-limit bucket.
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      socket: {},
    } as never
    expect(clientIp(req)).toBe('203.0.113.5')
  })

  it('does not collapse two clients behind the same proxy into one bucket', () => {
    const a = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, socket: {} } as never
    const b = { headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }, socket: {} } as never
    expect(clientIp(a)).not.toBe(clientIp(b))
  })

  it('handles a header delivered as an array', () => {
    const req = {
      headers: { 'x-forwarded-for': ['203.0.113.5, 10.0.0.1'] },
      socket: {},
    } as never
    expect(clientIp(req)).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = {
      headers: { 'x-real-ip': '198.51.100.7' },
      socket: { remoteAddress: '10.0.0.1' },
    } as never
    expect(clientIp(req)).toBe('198.51.100.7')
  })

  it('ignores an empty x-forwarded-for and falls through', () => {
    const req = {
      headers: { 'x-forwarded-for': '   ' },
      socket: { remoteAddress: '198.51.100.7' },
    } as never
    expect(clientIp(req)).toBe('198.51.100.7')
  })

  it('falls back to the socket remote address', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '198.51.100.7' },
    } as never
    expect(clientIp(req)).toBe('198.51.100.7')
  })

  it('falls back to "unknown" when nothing is available', () => {
    const req = { headers: {}, socket: {} } as never
    expect(clientIp(req)).toBe('unknown')
  })
})

describe('isRateLimitDurable', () => {
  const originalUrl = process.env.VERCEL_KV_REST_API_URL
  const originalToken = process.env.VERCEL_KV_REST_API_TOKEN

  beforeEach(() => {
    delete process.env.VERCEL_KV_REST_API_URL
    delete process.env.VERCEL_KV_REST_API_TOKEN
  })

  afterEach(() => {
    if (originalUrl !== undefined) process.env.VERCEL_KV_REST_API_URL = originalUrl
    else delete process.env.VERCEL_KV_REST_API_URL
    if (originalToken !== undefined) process.env.VERCEL_KV_REST_API_TOKEN = originalToken
    else delete process.env.VERCEL_KV_REST_API_TOKEN
  })

  it('returns true when both KV env vars are set', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example.com'
    process.env.VERCEL_KV_REST_API_TOKEN = 'token'
    expect(isRateLimitDurable()).toBe(true)
  })

  it('returns false when both KV env vars are absent', () => {
    expect(isRateLimitDurable()).toBe(false)
  })

  it('returns false when only VERCEL_KV_REST_API_URL is set', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example.com'
    expect(isRateLimitDurable()).toBe(false)
  })

  it('returns false when only VERCEL_KV_REST_API_TOKEN is set', () => {
    process.env.VERCEL_KV_REST_API_TOKEN = 'token'
    expect(isRateLimitDurable()).toBe(false)
  })
})
