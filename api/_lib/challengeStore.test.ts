import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CHALLENGE_TTL_MS,
  deleteChallenge,
  getChallenge,
  isChallengeStoreDurable,
  putChallenge,
  __resetInMemoryChallenges,
} from './challengeStore'

const ADDRESS = 'GBUKOFF6QUZ4YDTVAJ7NNQZ4LMHFXWNQMPQZ2VDLTMMFVDBLMEXWMXOU'

/**
 * A stand-in for Vercel KV: a plain map behind the REST shape the helpers
 * speak. It is deliberately *outside* any module under test, so two separately
 * loaded copies of the store can share it and nothing else — which is what
 * makes the cross-invocation test below meaningful.
 */
function fakeKv() {
  const data = new Map<string, { value: string; expiresAt: number }>()

  const handler = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const [, command, rawKey] = /\/(get|set|del)\/([^/?]+)$/.exec(url) ?? []
    if (!command || !rawKey) throw new Error(`fake KV: unroutable request ${url}`)
    const key = decodeURIComponent(rawKey)

    if (command === 'set') {
      const { value, ex } = JSON.parse(String(init?.body)) as { value: string; ex: number }
      data.set(key, { value, expiresAt: Date.now() + ex * 1000 })
      return json({ result: 'OK' })
    }

    if (command === 'del') {
      data.delete(key)
      return json({ result: 1 })
    }

    const stored = data.get(key)
    // KV expires keys itself; a lapsed key reads back as absent, not stale.
    if (stored && stored.expiresAt <= Date.now()) data.delete(key)
    return json({ result: data.get(key)?.value ?? null })
  })

  return { data, handler }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  __resetInMemoryChallenges()
  delete process.env.VERCEL_KV_REST_API_URL
  delete process.env.VERCEL_KV_REST_API_TOKEN
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete process.env.VERCEL_KV_REST_API_URL
  delete process.env.VERCEL_KV_REST_API_TOKEN
})

function useKv(handler: ReturnType<typeof fakeKv>['handler']) {
  process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
  process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
  vi.stubGlobal('fetch', handler)
}

// ── The bug this module exists to fix ────────────────────────────────────────

describe('challenge store across independent invocations (issue #1091)', () => {
  it('verifies a challenge issued by one module instance from another', async () => {
    const kv = fakeKv()
    useKv(kv.handler)

    // Two separate imports of the module: no shared module-level state between
    // them, exactly like two serverless instances. Only the fake KV is common.
    vi.resetModules()
    const instanceA = await import('./challengeStore')
    vi.resetModules()
    const instanceB = await import('./challengeStore')
    expect(instanceA).not.toBe(instanceB)

    // Instance A serves the GET.
    await instanceA.putChallenge(ADDRESS, 'challenge-from-a')

    // Instance B serves the POST and must see it.
    expect(await instanceB.getChallenge(ADDRESS)).toBe('challenge-from-a')

    // One-time use holds across instances too.
    await instanceB.deleteChallenge(ADDRESS)
    expect(await instanceA.getChallenge(ADDRESS)).toBeNull()
  })

  it('does NOT round-trip across instances on the in-memory fallback', async () => {
    // The regression guard: this asserts the old behaviour is genuinely
    // per-instance, so the test above proves KV is doing the work rather than
    // a shared module-level Map quietly making both paths look identical.
    vi.resetModules()
    const instanceA = await import('./challengeStore')
    vi.resetModules()
    const instanceB = await import('./challengeStore')

    await instanceA.putChallenge(ADDRESS, 'challenge-from-a')

    expect(await instanceA.getChallenge(ADDRESS)).toBe('challenge-from-a')
    expect(await instanceB.getChallenge(ADDRESS)).toBeNull()
  })
})

// ── KV path ──────────────────────────────────────────────────────────────────

describe('challenge store on Vercel KV', () => {
  it('reports itself durable only when KV is configured', async () => {
    expect(isChallengeStoreDurable()).toBe(false)
    useKv(fakeKv().handler)
    expect(isChallengeStoreDurable()).toBe(true)
  })

  it('round-trips a challenge and namespaces the key', async () => {
    const kv = fakeKv()
    useKv(kv.handler)

    await putChallenge(ADDRESS, 'abc123')

    expect([...kv.data.keys()]).toEqual([`auth:challenge:${ADDRESS}`])
    expect(await getChallenge(ADDRESS)).toBe('abc123')
  })

  it('writes with the 5-minute TTL', async () => {
    const kv = fakeKv()
    useKv(kv.handler)

    await putChallenge(ADDRESS, 'abc123')

    const body = JSON.parse(String(kv.handler.mock.calls[0]![1]!.body))
    expect(body.ex).toBe(CHALLENGE_TTL_MS / 1000)
  })

  it('returns null once KV has expired the key', async () => {
    vi.useFakeTimers()
    const kv = fakeKv()
    useKv(kv.handler)

    await putChallenge(ADDRESS, 'abc123')
    vi.advanceTimersByTime(CHALLENGE_TTL_MS + 1)

    expect(await getChallenge(ADDRESS)).toBeNull()
  })

  it('deletes on consumption', async () => {
    const kv = fakeKv()
    useKv(kv.handler)

    await putChallenge(ADDRESS, 'abc123')
    await deleteChallenge(ADDRESS)

    expect(await getChallenge(ADDRESS)).toBeNull()
  })

  it('replaces a previous challenge for the same address', async () => {
    const kv = fakeKv()
    useKv(kv.handler)

    await putChallenge(ADDRESS, 'first')
    await putChallenge(ADDRESS, 'second')

    expect(await getChallenge(ADDRESS)).toBe('second')
  })

  it('throws rather than reporting a KV outage as a missing challenge', async () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'boom' }, 500)),
    )

    // A `null` here would send a correct client away with "request a new
    // challenge" on a fault that is entirely server-side.
    await expect(getChallenge(ADDRESS)).rejects.toThrow(/HTTP 500/)
    await expect(putChallenge(ADDRESS, 'abc')).rejects.toThrow(/HTTP 500/)
  })

  it('throws when the KV request cannot be made at all', async () => {
    process.env.VERCEL_KV_REST_API_URL = 'https://kv.example'
    process.env.VERCEL_KV_REST_API_TOKEN = 'test-token'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    await expect(getChallenge(ADDRESS)).rejects.toThrow(/KV request failed/)
  })
})

// ── In-memory fallback (local dev only) ──────────────────────────────────────

describe('challenge store in-memory fallback', () => {
  it('round-trips within one instance', async () => {
    await putChallenge(ADDRESS, 'abc123')
    expect(await getChallenge(ADDRESS)).toBe('abc123')
  })

  it('expires after the 5-minute TTL', async () => {
    vi.useFakeTimers()
    await putChallenge(ADDRESS, 'abc123')

    vi.advanceTimersByTime(CHALLENGE_TTL_MS - 1)
    expect(await getChallenge(ADDRESS)).toBe('abc123')

    vi.advanceTimersByTime(2)
    expect(await getChallenge(ADDRESS)).toBeNull()
  })

  it('enforces one-time use', async () => {
    await putChallenge(ADDRESS, 'abc123')
    await deleteChallenge(ADDRESS)
    expect(await getChallenge(ADDRESS)).toBeNull()
  })

  it('keeps addresses independent', async () => {
    const other = 'GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH'
    await putChallenge(ADDRESS, 'mine')
    await putChallenge(other, 'theirs')

    await deleteChallenge(ADDRESS)

    expect(await getChallenge(ADDRESS)).toBeNull()
    expect(await getChallenge(other)).toBe('theirs')
  })

  it('does not touch the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await putChallenge(ADDRESS, 'abc123')
    await getChallenge(ADDRESS)
    await deleteChallenge(ADDRESS)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reclaims expired entries instead of growing without bound', async () => {
    vi.useFakeTimers()
    for (let i = 0; i < 50; i++) await putChallenge(`G${i}`, `challenge-${i}`)

    vi.advanceTimersByTime(CHALLENGE_TTL_MS + 1)
    // A write sweeps; the 50 stale entries must not survive it.
    await putChallenge(ADDRESS, 'fresh')

    for (let i = 0; i < 50; i++) expect(await getChallenge(`G${i}`)).toBeNull()
    expect(await getChallenge(ADDRESS)).toBe('fresh')
  })
})
