import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './upload-json'
import { issueToken } from '../_lib/jwt'

function fakeReqRes(body: unknown, token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`

  const req = {
    method: 'POST',
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    body,
  } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status } as unknown as VercelResponse

  return { req, res, status, json }
}

// Each test authenticates as its own wallet so the per-wallet in-memory rate
// limiter never bleeds state between tests.
let walletCounter = 0
function freshToken(): string {
  walletCounter += 1
  return issueToken(`GJSONTESTWALLET${walletCounter}`)
}

const VALID_IMAGE = 'ipfs://QmValidImageCid123'

describe('POST /api/ipfs/upload-json', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
    process.env.JWT_SECRET = 'test-jwt-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ IpfsHash: 'QmMetadataTestCid' }),
      } as Response),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
    delete process.env.JWT_SECRET
  })

  it('pins metadata to Pinata using server-side credentials and returns its cid', async () => {
    const metadata = {
      name: 'MyToken',
      description: 'desc',
      image: VALID_IMAGE,
    }
    const { req, res, status, json } = fakeReqRes(
      { metadata, name: 'MyToken-metadata.json' },
      freshToken(),
    )

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ cid: 'QmMetadataTestCid' })

    const [, options] = vi.mocked(fetch).mock.calls[0]
    const headers = (options as RequestInit).headers as Record<string, string>
    expect(headers.pinata_api_key).toBe('test-key')
    const sentBody = JSON.parse((options as RequestInit).body as string)
    expect(sentBody.pinataContent).toEqual(metadata)
  })

  it('rejects a malformed request body before contacting Pinata', async () => {
    const { req, res, status } = fakeReqRes({ name: 'MyToken-metadata.json' }, freshToken())

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects metadata whose image is not an ipfs:// URI', async () => {
    const cases = [
      'https://evil.example/payload.png',
      'http://evil.example/payload.png',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'ipfs://../../etc/passwd',
    ]
    for (const image of cases) {
      const { req, res, status } = fakeReqRes(
        { metadata: { name: 'T', description: 'D', image }, name: 'meta.json' },
        freshToken(),
      )
      await handler(req, res)
      expect(status).toHaveBeenCalledWith(400)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects requests without an Authorization header', async () => {
    const { req, res, status } = fakeReqRes({
      metadata: { name: 'T', description: 'D', image: VALID_IMAGE },
      name: 'meta.json',
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 500 when server-side Pinata credentials are missing', async () => {
    delete process.env.PINATA_API_SECRET
    const { req, res, status } = fakeReqRes(
      {
        metadata: { name: 'MyToken', description: 'desc', image: VALID_IMAGE },
        name: 'meta.json',
      },
      freshToken(),
    )

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects non-POST methods', async () => {
    const { req, res, status } = fakeReqRes({})
    req.method = 'GET'

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
  })
})
