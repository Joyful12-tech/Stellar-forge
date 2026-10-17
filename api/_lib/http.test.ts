import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  firstQueryValue,
  isCronAuthorized,
  requireMethod,
  requirePinataHeaders,
  requireWalletAuth,
} from './http'
import { issueToken } from './jwt'

function fakeReqRes(init: { method?: string; authorization?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.authorization) headers.authorization = init.authorization
  const req = { method: init.method ?? 'GET', headers } as unknown as VercelRequest
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status } as unknown as VercelResponse
  return { req, res, status, json }
}

describe('firstQueryValue', () => {
  it('takes the first of repeated params', () => {
    expect(firstQueryValue(['a', 'b'])).toBe('a')
    expect(firstQueryValue('a')).toBe('a')
    expect(firstQueryValue(undefined)).toBeUndefined()
  })
})

describe('requireMethod', () => {
  it('passes the matching method and 405s anything else', () => {
    const ok = fakeReqRes({ method: 'POST' })
    expect(requireMethod(ok.req, ok.res, 'POST')).toBe(true)
    expect(ok.status).not.toHaveBeenCalled()

    const bad = fakeReqRes({ method: 'GET' })
    expect(requireMethod(bad.req, bad.res, 'POST')).toBe(false)
    expect(bad.status).toHaveBeenCalledWith(405)
  })
})

describe('requireWalletAuth', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret'
  })
  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('returns the wallet address for a valid Bearer token', () => {
    const { req, res, status } = fakeReqRes({ authorization: `Bearer ${issueToken('GWALLET')}` })
    expect(requireWalletAuth(req, res)).toBe('GWALLET')
    expect(status).not.toHaveBeenCalled()
  })

  it('401s a missing or non-Bearer header', () => {
    for (const authorization of [undefined, 'Basic abc']) {
      const { req, res, status } = fakeReqRes({ authorization })
      expect(requireWalletAuth(req, res)).toBeNull()
      expect(status).toHaveBeenCalledWith(401)
    }
  })

  it('401s an invalid token', () => {
    const { req, res, status } = fakeReqRes({ authorization: 'Bearer not-a-jwt' })
    expect(requireWalletAuth(req, res)).toBeNull()
    expect(status).toHaveBeenCalledWith(401)
  })
})

describe('isCronAuthorized', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET
    delete process.env.VERCEL_ENV
  })

  it('requires the exact Bearer secret when one is configured', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(isCronAuthorized(fakeReqRes({ authorization: 'Bearer s3cret' }).req)).toBe(true)
    expect(isCronAuthorized(fakeReqRes({ authorization: 'Bearer wrong' }).req)).toBe(false)
    expect(isCronAuthorized(fakeReqRes().req)).toBe(false)
  })

  it('fails closed in production when no secret is configured', () => {
    process.env.VERCEL_ENV = 'production'
    expect(isCronAuthorized(fakeReqRes().req)).toBe(false)
    process.env.VERCEL_ENV = 'preview'
    expect(isCronAuthorized(fakeReqRes().req)).toBe(true)
  })
})

describe('requirePinataHeaders', () => {
  afterEach(() => {
    delete process.env.PINATA_API_KEY
    delete process.env.PINATA_API_SECRET
  })

  it('500s when credentials are missing', () => {
    const { res, status } = fakeReqRes()
    expect(requirePinataHeaders(res)).toBeNull()
    expect(status).toHaveBeenCalledWith(500)
  })

  it('returns headers merged with extras', () => {
    process.env.PINATA_API_KEY = 'k'
    process.env.PINATA_API_SECRET = 's'
    const { res } = fakeReqRes()
    expect(requirePinataHeaders(res, { 'Content-Type': 'application/json' })).toEqual({
      pinata_api_key: 'k',
      pinata_secret_api_key: 's',
      'Content-Type': 'application/json',
    })
  })
})
