import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearPinOwner, getPinOwner, recordPinOwner } from './pinOwnership'

describe('pinOwnership', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.VERCEL_KV_REST_API_URL
    delete process.env.VERCEL_KV_REST_API_TOKEN
  })

  it('round-trips through the in-memory registry without KV', async () => {
    await recordPinOwner('cid-mem', 'GOWNER')
    expect(await getPinOwner('cid-mem')).toBe('GOWNER')
    await clearPinOwner('cid-mem')
    expect(await getPinOwner('cid-mem')).toBeNull()
  })

  it('writes ownership to KV without an expiry', async () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 't'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await recordPinOwner('cid-kv', 'GOWNER')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://kv.example/set/pinowner%3Acid-kv')
    const body = JSON.parse(init.body as string) as { ex?: number; value: string }
    expect(body.ex).toBeUndefined()
    expect(JSON.parse(body.value).ownerAddress).toBe('GOWNER')
  })

  it('falls back to memory when the KV write returns an HTTP error', async () => {
    // Regression: the old private kvSet ignored `response.ok`, so a KV 5xx was
    // treated as success and the owner was recorded nowhere — permanently
    // locking the uploader out of unpinning their own content.
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 't'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response),
    )

    await recordPinOwner('cid-kv-down', 'GOWNER')

    vi.unstubAllGlobals()
    delete process.env.VERCEL_KV_REST_API_URL
    delete process.env.VERCEL_KV_REST_API_TOKEN
    expect(await getPinOwner('cid-kv-down')).toBe('GOWNER')
  })

  it('treats an unreadable KV entry as unknown owner (fail closed)', async () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 't'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response),
    )

    expect(await getPinOwner('cid-any')).toBeNull()
  })
})
