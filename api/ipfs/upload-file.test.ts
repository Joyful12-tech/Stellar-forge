import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './upload-file'
import { issueToken } from '../_lib/jwt'
import { pngFixture, gifFixture, jpegFixture } from '../_lib/imageFixtures'

function buildMultipartBody(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  boundary: string,
): Buffer {
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`)
  return Buffer.concat([preamble, fileBuffer, epilogue])
}

interface FakeReqOptions {
  token?: string
}

function fakeReqRes(bodyBuffer: Buffer, contentType: string, options: FakeReqOptions = {}) {
  const req = Readable.from([bodyBuffer]) as unknown as VercelRequest
  req.method = 'POST'
  req.headers = { 'content-type': contentType }
  if (options.token) {
    req.headers.authorization = `Bearer ${options.token}`
  }
  req.socket = { remoteAddress: '127.0.0.1' } as never

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
  return issueToken(`GTESTWALLET${walletCounter}`)
}

describe('POST /api/ipfs/upload-file', () => {
  const boundary = 'testboundary123'
  const multipartType = `multipart/form-data; boundary=${boundary}`

  beforeEach(() => {
    process.env.PINATA_API_KEY = 'test-key'
    process.env.PINATA_API_SECRET = 'test-secret'
    process.env.JWT_SECRET = 'test-jwt-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ IpfsHash: 'QmProxyTestCid' }),
      } as Response),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
    delete process.env.JWT_SECRET
  })

  it('forwards a valid PNG to Pinata using server-side credentials and returns its cid', async () => {
    const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
    const { req, res, status, json } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ cid: 'QmProxyTestCid' })

    const [, requestInit] = vi.mocked(fetch).mock.calls[0]
    const headers = (requestInit as RequestInit).headers as Record<string, string>
    expect(headers.pinata_api_key).toBe('test-key')
    expect(headers.pinata_secret_api_key).toBe('test-secret')
  })

  it('accepts each allowed format when content and declared type agree', async () => {
    const cases: Array<[Buffer, string, string]> = [
      [pngFixture(), 'a.png', 'image/png'],
      [jpegFixture(), 'a.jpg', 'image/jpeg'],
      [gifFixture(), 'a.gif', 'image/gif'],
    ]
    for (const [buffer, filename, mimeType] of cases) {
      const body = buildMultipartBody(buffer, filename, mimeType, boundary)
      const { req, res, status } = fakeReqRes(body, multipartType, {
        token: freshToken(),
      })
      await handler(req, res)
      expect(status).toHaveBeenCalledWith(200)
    }
  })

  it('rejects a payload whose declared MIME type is spoofed, before contacting Pinata', async () => {
    // HTML content declared as image/png — the pre-fix code pinned this.
    const body = buildMultipartBody(
      Buffer.from('<html><script>alert(1)</script></html>'),
      'innocent.png',
      'image/png',
      boundary,
    )
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a real image whose declared type does not match its content', async () => {
    const body = buildMultipartBody(pngFixture(), 'confused.jpg', 'image/jpeg', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a decompression bomb by header dimensions alone', async () => {
    const body = buildMultipartBody(pngFixture(60000, 60000), 'bomb.png', 'image/png', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a disallowed file type before ever contacting Pinata', async () => {
    const body = buildMultipartBody(
      Buffer.from('MZbinarycontent'),
      'payload.exe',
      'application/octet-stream',
      boundary,
    )
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects requests without an Authorization header', async () => {
    const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType)

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects requests with an invalid token', async () => {
    const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: 'not.a.token',
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 500 when server-side Pinata credentials are missing', async () => {
    delete process.env.PINATA_API_KEY
    const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType, {
      token: freshToken(),
    })

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects non-POST methods', async () => {
    const { req, res, status } = fakeReqRes(Buffer.from(''), 'application/json')
    req.method = 'GET'

    await handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
  })

  it('returns 429 once the per-wallet upload limit is exceeded', async () => {
    const token = freshToken()
    for (let i = 0; i < 10; i++) {
      const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
      const { req, res } = fakeReqRes(body, multipartType, { token })
      await handler(req, res)
    }

    const body = buildMultipartBody(pngFixture(), 'token.png', 'image/png', boundary)
    const { req, res, status } = fakeReqRes(body, multipartType, { token })
    await handler(req, res)

    expect(status).toHaveBeenCalledWith(429)
  })
})
