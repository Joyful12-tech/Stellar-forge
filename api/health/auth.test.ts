import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './auth'

function fakeReqRes(method = 'GET') {
  const req = { method, headers: {} } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const setHeader = vi.fn()
  const res = { status, setHeader } as unknown as VercelResponse

  return { req, res, status, setHeader, json }
}

describe('GET /api/health/auth', () => {
  beforeEach(() => {
    delete process.env.VERCEL_KV_REST_API_URL
    delete process.env.VERCEL_KV_REST_API_TOKEN
  })

  afterEach(() => {
    delete process.env.VERCEL_KV_REST_API_URL
    delete process.env.VERCEL_KV_REST_API_TOKEN
    vi.restoreAllMocks()
  })

  it('reports a durable store when KV is configured', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    const { req, res, status, json } = fakeReqRes()

    handler(req, res)

    expect(status).toHaveBeenCalledWith(200)
    expect(json.mock.calls[0]![0]).toMatchObject({
      healthy: true,
      durable: true,
      store: 'vercel-kv',
    })
  })

  it('reports 503 on the per-instance fallback', () => {
    const { req, res, status, json } = fakeReqRes()

    handler(req, res)

    // A deployment silently running the dev fallback is the failure mode from
    // issue #1091 — it must not read as healthy.
    expect(status).toHaveBeenCalledWith(503)
    expect(json.mock.calls[0]![0]).toMatchObject({
      healthy: false,
      durable: false,
      store: 'in-memory',
    })
  })

  it('needs both credentials before it claims durability', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    expect(json.mock.calls[0]![0]).toMatchObject({ durable: false })
  })

  it('never caches the answer', () => {
    const { req, res, setHeader } = fakeReqRes()

    handler(req, res)

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it('leaks no credential material', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'super-secret-token'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    const body = JSON.stringify(json.mock.calls[0]![0])
    expect(body).not.toContain('super-secret-token')
    expect(body).not.toContain('kv.example')
  })

  it('rejects non-GET with 405', () => {
    const { req, res, status } = fakeReqRes('POST')

    handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
  })
})
