import type { VercelRequest } from '@vercel/node'
import { isKvConfigured, kvGet, kvSet } from './kv'

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Whether the rate limiter is backed by a durable, cross-instance store.
 *
 * Returns `true` when Vercel KV env vars are configured. Returns `false` when
 * the in-memory per-instance fallback is active, which means each instance
 * enforces limits independently — not production-safe (issue #14).
 *
 * Read by `GET /api/health/rate-limit` so operators can detect a deployment
 * that forgot to provision Vercel KV before it silently ships without abuse
 * protection on the upload endpoints.
 */
export function isRateLimitDurable(): boolean {
  return isKvConfigured()
}

/**
 * Check if a wallet address has exceeded rate limits (window or daily).
 * Uses Vercel KV for durable, cross-instance limits.
 * Falls back to in-memory tracking if KV is unavailable.
 * Challenge-issuance limits (unauthenticated — GET /api/auth/challenge).
 *
 * These are intentionally tighter than authenticated-action limits and are
 * keyed on the *requester IP*, not the target address, so an attacker who
 * knows a victim's public address cannot exhaust the victim's login budget by
 * flooding the challenge endpoint (issue #1162).
 *
 * The per-IP window limit is kept low to prevent one host from spamming
 * challenges at a high rate. The daily limit is generous enough that
 * legitimate multi-device users are never affected.
 */
const CHALLENGE_MAX_PER_WINDOW = parseInt(process.env.CHALLENGE_RATE_LIMIT_WINDOW ?? '20', 10)
const CHALLENGE_MAX_PER_DAY = parseInt(process.env.CHALLENGE_RATE_LIMIT_DAY ?? '200', 10)

/**
 * Authenticated-action limits (upload-file, upload-json, unpin).
 *
 * These are keyed on the wallet address, which is safe because the caller
 * has already proved possession of the corresponding private key via the
 * challenge→signature flow before reaching these endpoints.
 */
const ACTION_MAX_PER_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW ?? '10', 10)
const ACTION_MAX_PER_DAY = parseInt(process.env.RATE_LIMIT_DAY ?? '100', 10)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rate-limit check for **challenge issuance** (GET /api/auth/challenge).
 *
 * Keyed on the requester's IP address so that an attacker who knows a
 * victim's Stellar address (a public value) cannot lock the victim out of
 * the system by flooding the unauthenticated challenge endpoint (issue #1162).
 *
 * @param ip   Trusted client IP, e.g. from `clientIp(req)`.
 */
export async function isChallengeRateLimited(ip: string): Promise<boolean> {
  return _isRateLimited(
    `ratelimit:challenge:${ip}`,
    CHALLENGE_MAX_PER_WINDOW,
    CHALLENGE_MAX_PER_DAY,
  )
}

/**
 * Rate-limit check for **authenticated actions** (upload-file, upload-json,
 * unpin). Keyed on the wallet address, which is safe because possession of
 * the corresponding private key has already been proved via the
 * challenge→signature flow (issue #1162).
 *
 * @param address  The verified wallet address extracted from the JWT.
 */
export async function isActionRateLimited(address: string): Promise<boolean> {
  return _isRateLimited(`ratelimit:action:${address}`, ACTION_MAX_PER_WINDOW, ACTION_MAX_PER_DAY)
}

/**
 * @deprecated Use `isChallengeRateLimited` or `isActionRateLimited` instead.
 *
 * Left in place so any external callers that were importing `isRateLimited`
 * directly keep compiling. All internal call sites have been migrated to the
 * split functions above (issue #1162).
 */
export async function isRateLimited(address: string): Promise<boolean> {
  return isActionRateLimited(address)
}

// ---------------------------------------------------------------------------
// Shared implementation
// ---------------------------------------------------------------------------

async function _isRateLimited(
  bucketPrefix: string,
  maxPerWindow: number,
  maxPerDay: number,
): Promise<boolean> {
  if (!isKvConfigured()) {
    // In production, fail closed: deny all requests rather than silently
    // shipping without working abuse protection (issue #14). This matches the
    // fail-closed precedent in api/cron/index-tokens.ts (CRON_SECRET check).
    // In non-production environments the in-memory fallback is fine for local
    // development where cross-instance durability is not required.
    if (process.env.VERCEL_ENV === 'production') {
      console.error(
        '[rate-limit] KV store is not configured in production. ' +
          'Set VERCEL_KV_REST_API_URL and VERCEL_KV_REST_API_TOKEN. ' +
          'Failing closed to prevent unprotected upload endpoints.',
      )
      return true
    }
    // Fallback: use in-memory (not production-safe, but fine for local dev)
    return _isRateLimitedInMemory(bucketPrefix, maxPerWindow)
  }

  try {
    const now = Date.now()
    const windowKey = `${bucketPrefix}:window`
    const dayKey = `${bucketPrefix}:day`

    // Window bucket (15 min rolling)
    const windowData = await kvGet(windowKey)
    if (windowData) {
      const { count, windowStart } = JSON.parse(windowData)
      if (now - windowStart > WINDOW_MS) {
        // Window expired, reset
        await kvSet(windowKey, JSON.stringify({ count: 1, windowStart: now }), 900)
      } else {
        // Window still active
        if (count >= maxPerWindow) return true
        await kvSet(windowKey, JSON.stringify({ count: count + 1, windowStart }), 900)
      }
    } else {
      // First request in this window
      await kvSet(windowKey, JSON.stringify({ count: 1, windowStart: now }), 900)
    }

    // Day bucket (24 hr)
    const dayData = await kvGet(dayKey)
    if (dayData) {
      const { count } = JSON.parse(dayData)
      if (count >= maxPerDay) return true
      await kvSet(dayKey, JSON.stringify({ count: count + 1 }), 86400)
    } else {
      // First request in this day
      await kvSet(dayKey, JSON.stringify({ count: 1 }), 86400)
    }

    return false
  } catch (err) {
    console.error('Rate limit check failed:', err)
    // On error, deny the request (fail closed)
    return true
  }
}

// In-memory fallback (per-instance, not durable)
interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

function _isRateLimitedInMemory(key: string, maxPerWindow: number): Promise<boolean> {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return Promise.resolve(false)
  }

  bucket.count += 1
  return Promise.resolve(bucket.count > maxPerWindow)
}

/**
 * Resolve the client IP used to key challenge-issuance rate limits (issue #1162).
 *
 * On Vercel, `x-forwarded-for` is **overwritten** by the platform with the single
 * public IP of the client that made the request — inbound values are discarded, so
 * the header cannot be spoofed and there is no proxy chain to walk. That makes the
 * header itself the answer in the deployment target this code runs on.
 *
 * The comma case is only reachable off-Vercel (local dev, a self-hosted proxy). There
 * the leftmost entry is the client per standard XFF semantics — earlier entries are the
 * originator, later ones are proxies appended in order. The previous implementation took
 * the *rightmost* entry and called it "most trusted", which is backwards on both counts:
 * it yields a proxy address, and it collapses every client behind one proxy into a single
 * rate-limit bucket (issue #1114).
 *
 * Do not add multi-hop trust logic here unless deploying behind a proxy whose hop count is
 * known and fixed; a leftmost read is spoofable off-Vercel, which is why the socket address
 * is the last resort rather than the header.
 */
export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof first === 'string' && first.trim()) {
    // On Vercel this is already a bare single IP; split() is the off-Vercel path.
    const client = first.split(',')[0]?.trim()
    if (client) return client
  }

  const realIp = req.headers['x-real-ip']
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp
  if (typeof realIpValue === 'string' && realIpValue.trim()) return realIpValue.trim()

  return req.socket?.remoteAddress ?? 'unknown'
}
