import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './rate-limit'

function fakeReqRes(method = 'GET') {
  const req = { method, headers: {} } as unknown as VercelRequest

  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const setHeader = vi.fn()
  const res = { status, setHeader } as unknown as VercelResponse

  return { req, res, status, setHeader, json }
}

describe('GET /api/health/rate-limit', () => {
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
    vi.restoreAllMocks()
  })

  // ── durability flag reflects KV env vars ───────────────────────────────────

  it('reports durable:true and 200 when both KV env vars are set', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example.com'
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

  it('reports durable:false and 503 when KV env vars are absent', () => {
    const { req, res, status, json } = fakeReqRes()

    handler(req, res)

    // A deployment without KV is silently running without effective rate
    // limiting in production — this must surface as degraded (issue #14).
    expect(status).toHaveBeenCalledWith(503)
    expect(json.mock.calls[0]![0]).toMatchObject({
      healthy: false,
      durable: false,
      store: 'in-memory',
    })
  })

  it('reports durable:false when only the URL is set (both required)', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example.com'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    expect(json.mock.calls[0]![0]).toMatchObject({ durable: false })
  })

  it('reports durable:false when only the token is set (both required)', () => {
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    expect(json.mock.calls[0]![0]).toMatchObject({ durable: false })
  })

  // ── caching ───────────────────────────────────────────────────────────────

  it('sets Cache-Control: no-store on every response', () => {
    const { req, res, setHeader } = fakeReqRes()

    handler(req, res)

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  // ── security: no credential material in response body ─────────────────────

  it('never echoes KV credential material', () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv-secret-url.example.com'
    process.env.VERCEL_KV_REST_API_TOKEN = 'super-secret-kv-token'
    const { req, res, json } = fakeReqRes()

    handler(req, res)

    const body = JSON.stringify(json.mock.calls[0]![0])
    expect(body).not.toContain('super-secret-kv-token')
    expect(body).not.toContain('kv-secret-url.example.com')
  })

  // ── method guard ──────────────────────────────────────────────────────────

  it('rejects non-GET requests with 405', () => {
    const { req, res, status, json } = fakeReqRes('POST')

    handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
    expect(json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('rejects PUT with 405', () => {
    const { req, res, status } = fakeReqRes('PUT')

    handler(req, res)

    expect(status).toHaveBeenCalledWith(405)
  })
})
