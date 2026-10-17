import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './unpin'
import { issueToken } from '../_lib/jwt'
import { recordPinOwner } from '../_lib/pinOwnership'

function fakeReqRes(body: unknown, token: string | undefined, ip = '127.0.0.1') {
  const headers: Record<string, string> = { 'x-forwarded-for': ip }
  if (token) headers.authorization = `Bearer ${token}`

  const req = {
    method: 'POST',
    headers,
    socket: { remoteAddress: ip },
    body,
  } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status } as unknown as VercelResponse

  return { req, res, status, json }
}

/** A syntactically valid CIDv0, unique per test via `seed`. */
function makeCid(seed: string): string {
  return `Qm${seed.padEnd(44, 'a')}`
}

let ipCounter = 0
/** A fresh loopback-range IP per call, so rate limiting doesn't leak across tests. */
function freshIp(): string {
  ipCounter += 1
  return `203.0.113.${ipCounter}`
}

describe('POST /api/ipfs/unpin', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret'
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.JWT_SECRET
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  it('rejects non-POST methods', async () => {
    const { req, res, status } = fakeReqRes({}, undefined, freshIp())
    req.method = 'GET'

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
  })

  it('rejects requests without a valid JWT', async () => {
    const cid = makeCid('noauth')
    const { req, res, status } = fakeReqRes({ cid }, undefined, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a missing cid', async () => {
    const token = issueToken('GNOCIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const { req, res, status } = fakeReqRes({}, token, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a malformed cid before checking ownership', async () => {
    const token = issueToken('GREQUESTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const { req, res, status } = fakeReqRes({ cid: 'not-a-real-cid' }, token, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('denies unpinning a CID with no ownership record on file (deny by default)', async () => {
    const cid = makeCid('unknown1')
    const token = issueToken('GREQUESTERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
    const { req, res, status, json } = fakeReqRes({ cid }, token, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('denied by default'),
      }),
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('denies a wallet that does not own the CID (IDOR check)', async () => {
    const cid = makeCid('ownedbyA')
    await recordPinOwner(cid, 'GOWNERWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')

    const attackerToken = issueToken('GATTACKERWALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
    const { req, res, status, json } = fakeReqRes({ cid }, attackerToken, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('not authorized'),
      }),
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows the legitimate owner to unpin their own CID', async () => {
    const cid = makeCid('ownedbyB')
    const ownerAddress = 'GOWNERWALLETCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
    await recordPinOwner(cid, ownerAddress)

    const ownerToken = issueToken(ownerAddress)
    const { req, res, status, json } = fakeReqRes({ cid }, ownerToken, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ cid, unpinned: true })

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`https://api.pinata.cloud/pinning/unpin/${cid}`)
    expect((options as RequestInit).method).toBe('DELETE')
    const headers = (options as RequestInit).headers as Record<string, string>
    expect(headers.pinata_api_key).toBe('test-key')
  })

  it('treats a 404 from Pinata (CID already gone) as success for the owner', async () => {
    const cid = makeCid('ownedbyD')
    const ownerAddress = 'GOWNERWALLETDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
    await recordPinOwner(cid, ownerAddress)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response)

    const ownerToken = issueToken(ownerAddress)
    const { req, res, status, json } = fakeReqRes({ cid }, ownerToken, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ cid, unpinned: true })
  })

  it('surfaces Pinata rate limiting distinctly from other failures', async () => {
    const cid = makeCid('ownedbyE')
    const ownerAddress = 'GOWNERWALLETEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'
    await recordPinOwner(cid, ownerAddress)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response)

    const ownerToken = issueToken(ownerAddress)
    const { req, res, status } = fakeReqRes({ cid }, ownerToken, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(502)
  })

  it('surfaces other Pinata HTTP failures', async () => {
    const cid = makeCid('ownedbyF')
    const ownerAddress = 'GOWNERWALLETFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
    await recordPinOwner(cid, ownerAddress)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const ownerToken = issueToken(ownerAddress)
    const { req, res, status } = fakeReqRes({ cid }, ownerToken, freshIp())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(502)
  })
})
