import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './ipfs'

function fakeReqRes(method = 'GET') {
  const req = { method, headers: {} } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const setHeader = vi.fn()
  const res = { status, setHeader } as unknown as VercelResponse

  return { req, res, status, setHeader, json }
}

describe('GET /api/health/ipfs', () => {
  const originalKey = process.env.PINATA_API_KEY
  const originalSecret = process.env.PINATA_API_SECRET

  beforeEach(() => {
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  afterEach(() => {
    process.env.PINATA_API_KEY = originalKey
    process.env.PINATA_API_SECRET = originalSecret
    vi.restoreAllMocks()
  })

  it('reports configured when both credentials are present', () => {
    process.env.PINATA_API_KEY = 'key'
    process.env.PINATA_API_SECRET = 'secret'
    const { req, res, status, json } = fakeReqRes()

    handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ configured: true })
  })

  it('reports unconfigured when a credential is missing', () => {
    process.env.PINATA_API_KEY = 'key'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    expect(json).toHaveBeenCalledWith({ configured: false })
  })

  // The entire point of this endpoint is to let the browser learn whether
  // uploads are possible *without* holding the credentials (issue #921), so it
  // must not leak the values it is reporting on.
  it('never echoes credential material', () => {
    process.env.PINATA_API_KEY = 'super-secret-key'
    process.env.PINATA_API_SECRET = 'super-secret-secret'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    const payload = JSON.stringify(json.mock.calls[0]?.[0])
    expect(payload).not.toContain('super-secret-key')
    expect(payload).not.toContain('super-secret-secret')
    expect(JSON.parse(payload)).toEqual({ configured: true })
  })

  it('rejects non-GET methods', () => {
    const { req, res, status, json } = fakeReqRes('POST')

    handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
    expect(json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })
})
