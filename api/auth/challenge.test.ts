import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './challenge'
import { getChallenge, putChallenge, __resetInMemoryChallenges } from '../_lib/challengeStore'
import { isChallengeRateLimited, isActionRateLimited } from '../_lib/rateLimit'

// Issue #1162 split the single `isRateLimited` bucket into an IP-keyed
// challenge-issuance limiter and an address-keyed authenticated-action limiter.
// Both must be stubbed: the handler calls the split functions directly, so a
// stub on the deprecated `isRateLimited` shim would never be consulted and the
// real in-memory limiter would leak counts across tests in this file.
vi.mock('../_lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/rateLimit')>()
  return {
    ...actual,
    isChallengeRateLimited: vi.fn(),
    isActionRateLimited: vi.fn(),
  }
})

const mockIsChallengeRateLimited = vi.mocked(isChallengeRateLimited)
const mockIsActionRateLimited = vi.mocked(isActionRateLimited)

const ADDRESS = 'GBUKOFF6QUZ4YDTVAJ7NNQZ4LMHFXWNQMPQZ2VDLTMMFVDBLMEXWMXOU'
const CLIENT_IP = '203.0.113.5'

function fakeReqRes(req: Partial<VercelRequest>) {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const setHeader = vi.fn()
  const res = { status, setHeader } as unknown as VercelResponse
  return {
    req: {
      headers: { 'x-forwarded-for': CLIENT_IP },
      ...req,
    } as unknown as VercelRequest,
    res,
    status,
    json,
  }
}

const get = (address?: string) =>
  fakeReqRes({ method: 'GET', query: address === undefined ? {} : { address } })

const post = (body: unknown) => fakeReqRes({ method: 'POST', body })

beforeEach(() => {
  __resetInMemoryChallenges()
  delete process.env.VERCEL_KV_REST_API_URL
  delete process.env.VERCEL_KV_REST_API_TOKEN
  process.env.JWT_SECRET = 'test-jwt-secret'
  mockIsChallengeRateLimited.mockResolvedValue(false)
  mockIsActionRateLimited.mockResolvedValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.VERCEL_KV_REST_API_URL
  delete process.env.VERCEL_KV_REST_API_TOKEN
  delete process.env.JWT_SECRET
  mockIsChallengeRateLimited.mockReset()
  mockIsActionRateLimited.mockReset()
})

describe('GET /api/auth/challenge', () => {
  it('issues a challenge and persists it in the store', async () => {
    const { req, res, status, json } = get(ADDRESS)

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    const { challenge } = json.mock.calls[0]![0] as { challenge: string }
    expect(challenge).toMatch(/^[0-9a-f]{64}$/)
    // The value handed to the client is the value a later request will verify.
    expect(await getChallenge(ADDRESS)).toBe(challenge)
  })

  it('issues a fresh challenge on every call', async () => {
    const first = get(ADDRESS)
    await handler(first.req, first.res)
    const second = get(ADDRESS)
    await handler(second.req, second.res)

    const a = (first.json.mock.calls[0]![0] as { challenge: string }).challenge
    const b = (second.json.mock.calls[0]![0] as { challenge: string }).challenge
    expect(a).not.toBe(b)
    expect(await getChallenge(ADDRESS)).toBe(b)
  })

  it('rejects a missing or non-Stellar address with 400', async () => {
    for (const address of [undefined, '', 'CNOTAWALLET']) {
      const { req, res, status } = get(address)
      await handler(req, res)
      expect(status).toHaveBeenCalledWith(400)
    }
  })

  it('returns 500 without handing out a challenge the store never accepted', async () => {
    // Issue #1091: a challenge the client cannot later verify is worse than an
    // error, because it presents as the client's fault.
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { req, res, status, json } = get(ADDRESS)
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(500)
    expect(json.mock.calls[0]![0]).not.toHaveProperty('challenge')
  })
})

describe('POST /api/auth/challenge', () => {
  it('rejects a missing or non-Stellar address with 400', async () => {
    for (const address of [undefined, 42, 'CNOTAWALLET']) {
      const { req, res, status } = post({ address, signature: 'sig' })
      await handler(req, res)
      expect(status).toHaveBeenCalledWith(400)
    }
  })

  it('rejects a missing signature with 400', async () => {
    const { req, res, status, json } = post({ address: ADDRESS })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: 'Missing signature.' })
  })

  it('rejects an address with no outstanding challenge with 400', async () => {
    const { req, res, status, json } = post({ address: ADDRESS, signature: 'sig' })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({
      error: 'Challenge not found or expired. Request a new challenge.',
    })
  })

  it('rejects a bad signature with 401 and burns the challenge', async () => {
    await putChallenge(ADDRESS, 'deadbeef')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { req, res, status, json } = post({ address: ADDRESS, signature: 'bm90LWEtc2ln' })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Signature verification failed.' })
    // One-time use: a rejected attempt must not leave the challenge replayable.
    expect(await getChallenge(ADDRESS)).toBeNull()
  })

  it('reports a store outage as 500, never as an expired challenge', async () => {
    // The distinction matters: 400 tells a correct client to retry forever
    // against a fault it cannot fix.
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { req, res, status } = post({ address: ADDRESS, signature: 'sig' })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(500)
  })
})

describe('/api/auth/challenge method handling', () => {
  it('rejects anything other than GET or POST with 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const { req, res, status } = fakeReqRes({ method })
      await handler(req, res)
      expect(status).toHaveBeenCalledWith(405)
    }
  })
})

describe('rate limiting (issue #1162)', () => {
  it('rejects GET with 429 when the challenge-issuance limit is hit', async () => {
    mockIsChallengeRateLimited.mockResolvedValue(true)

    const { req, res, status, json } = get(ADDRESS)
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(429)
    expect(json).toHaveBeenCalledWith({
      error: 'Too many challenge requests. Please try again later.',
    })
  })

  it('rejects POST with 429 when the authenticated-action limit is hit', async () => {
    // First issue a challenge so the verification path is reached
    await putChallenge(ADDRESS, 'deadbeef')
    mockIsActionRateLimited.mockResolvedValue(true)

    const { req, res, status, json } = post({ address: ADDRESS, signature: 'aGVsbG8=' })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(429)
    expect(json).toHaveBeenCalledWith({
      error: 'Too many verification attempts. Please try again later.',
    })
  })

  it('keys GET on the requester IP, never on the target address', async () => {
    // The whole point of the split: an attacker who knows a victim's public
    // address must not be able to spend the victim's login budget.
    const { req, res } = get(ADDRESS)
    await handler(req, res)

    expect(mockIsChallengeRateLimited).toHaveBeenCalledWith(CLIENT_IP)
    expect(mockIsChallengeRateLimited).not.toHaveBeenCalledWith(ADDRESS)
  })

  it('keys POST on the address, using the action bucket', async () => {
    await putChallenge(ADDRESS, 'deadbeef')
    const { req, res } = post({ address: ADDRESS, signature: 'c2lnbmF0dXJl' })
    await handler(req, res)

    expect(mockIsActionRateLimited).toHaveBeenCalledWith(ADDRESS)
  })

  it('does not consume the challenge bucket on POST, nor the action bucket on GET', async () => {
    const g = get(ADDRESS)
    await handler(g.req, g.res)
    expect(mockIsActionRateLimited).not.toHaveBeenCalled()

    mockIsChallengeRateLimited.mockClear()

    await putChallenge(ADDRESS, 'deadbeef')
    const p = post({ address: ADDRESS, signature: 'c2lnbmF0dXJl' })
    await handler(p.req, p.res)
    expect(mockIsChallengeRateLimited).not.toHaveBeenCalled()
  })
})

/**
 * Cryptographic round-trip tests for verifyStellarSignature.
 *
 * Fixtures are generated in-process using Keypair.random() from stellar-sdk and
 * Node's crypto module — identical to what Freighter does internally for SEP-53.
 * No live wallet or network is required.
 *
 * SEP-53 signing:  signature = Ed25519Sign(SHA256("Stellar Signed Message:\n" + challenge))
 * Backend verifies the same payload; these tests confirm both sides agree.
 */
describe('verifyStellarSignature — cryptographic paths', () => {
  /** Build a real SEP-53 base64 signature for `message` using `keypair`. */
  async function signSEP53(
    keypair: import('stellar-sdk').Keypair,
    message: string,
  ): Promise<string> {
    const { createHash } = await import('crypto')
    const payload = Buffer.from('Stellar Signed Message:\n' + message, 'utf-8')
    const hash = createHash('sha256').update(payload).digest()
    const sigBytes = keypair.sign(hash)
    return Buffer.from(sigBytes).toString('base64')
  }

  it('accepts a valid signature and returns 200 with a JWT', async () => {
    const { Keypair } = await import('stellar-sdk')
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const challenge = 'a'.repeat(64) // simulated 64-hex challenge

    const signature = await signSEP53(keypair, challenge)

    await putChallenge(address, challenge)
    const { req, res, status, json } = post({ address, signature })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    const body = json.mock.calls[0]![0] as { token?: string }
    expect(typeof body.token).toBe('string')
    expect(body.token!.length).toBeGreaterThan(10)
    // Challenge must be consumed (one-time use)
    expect(await getChallenge(address)).toBeNull()
  })

  it('rejects a tampered signature with 401', async () => {
    const { Keypair } = await import('stellar-sdk')
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const challenge = 'b'.repeat(64)

    const sig = await signSEP53(keypair, challenge)
    // Flip one bit in the first byte of the raw signature
    const sigBytes = Buffer.from(sig, 'base64')
    sigBytes[0] ^= 0x01
    const tamperedSig = sigBytes.toString('base64')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    await putChallenge(address, challenge)
    const { req, res, status, json } = post({ address, signature: tamperedSig })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Signature verification failed.' })
    expect(await getChallenge(address)).toBeNull()
  })

  it('rejects a signature for the wrong challenge with 401', async () => {
    const { Keypair } = await import('stellar-sdk')
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const realChallenge = 'c'.repeat(64)
    const differentChallenge = 'd'.repeat(64)

    // Signature is valid for `differentChallenge`, but server stored `realChallenge`
    const signature = await signSEP53(keypair, differentChallenge)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    await putChallenge(address, realChallenge)
    const { req, res, status, json } = post({ address, signature })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Signature verification failed.' })
  })

  it('rejects malformed base64 with 401 and does not throw an unhandled exception', async () => {
    const { Keypair } = await import('stellar-sdk')
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const challenge = 'e'.repeat(64)

    // Non-base64 garbage; Buffer.from(..., 'base64') degrades silently — the
    // resulting bytes will be too short / wrong, so verify must return false.
    const malformed = '!!!not-base64!!!'

    vi.spyOn(console, 'error').mockImplementation(() => {})
    await putChallenge(address, challenge)
    const { req, res, status } = post({ address, signature: malformed })
    await handler(req, res)

    // Must be a graceful 401, never a 500
    expect(status).toHaveBeenCalledWith(401)
  })
})
