/**
 * Vercel KV (Upstash REST) access, shared by every API module whose state has
 * to outlive a single serverless invocation.
 *
 * Vercel gives no routing affinity between requests: two calls belonging to
 * one logical flow can be served by different instances, so anything kept in a
 * module-level `Map` is visible to exactly one of them. `rateLimit.ts` was
 * already fixed for that (a per-instance limiter enforces a fraction of the
 * configured limit); issue #1091 is the same bug in the wallet-auth challenge
 * store, where a challenge issued by instance A could not be verified by
 * instance B. These helpers were extracted from `rateLimit.ts` so both callers
 * share one implementation rather than two drifting copies.
 *
 * ## Errors are thrown, never swallowed
 *
 * Every helper throws `KvError` on a transport failure or a non-2xx response.
 * A KV outage is not the same fact as "this key is absent", and only the
 * caller knows which way to fail — `rateLimit` denies the request, the
 * challenge store returns 500 rather than telling a legitimate client its
 * challenge expired. A missing key is still an ordinary `null` from `kvGet`.
 */

const KV_URL_ENV = 'VERCEL_KV_REST_API_URL'
const KV_TOKEN_ENV = 'VERCEL_KV_REST_API_TOKEN'

/** Raised for any KV failure that is not "the key does not exist". */
export class KvError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KvError'
  }
}

/**
 * Whether this deployment has a durable KV store wired up.
 *
 * Read by the health endpoints, and by every module that keeps a local-dev
 * fallback, so "am I durable?" is answered in exactly one place.
 */
export function isKvConfigured(): boolean {
  return Boolean(process.env[KV_URL_ENV] && process.env[KV_TOKEN_ENV])
}

/**
 * Read at call time rather than at module load: the API modules are imported
 * once per instance but `process.env` is populated per invocation, and tests
 * set and unset these around individual cases.
 */
function credentials(): { url: string; token: string } {
  const url = process.env[KV_URL_ENV]
  const token = process.env[KV_TOKEN_ENV]
  if (!url || !token) {
    throw new KvError(`Vercel KV is not configured (${KV_URL_ENV} / ${KV_TOKEN_ENV} unset).`)
  }
  return { url, token }
}

async function kvFetch(path: string, init?: RequestInit): Promise<unknown> {
  const { url, token } = credentials()

  let response: Response
  try {
    response = await fetch(`${url}/${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    throw new KvError(`KV request failed: ${path}`, { cause: err })
  }

  if (!response.ok) {
    throw new KvError(`KV request failed: ${path} returned HTTP ${response.status}`)
  }

  return response.json()
}

/** Returns the stored string, or `null` when the key is absent or expired. */
export async function kvGet(key: string): Promise<string | null> {
  const data = (await kvFetch(`get/${encodeURIComponent(key)}`)) as { result?: string | null }
  return data.result ?? null
}

/**
 * Writes `value`, replacing any prior value. With `exSeconds` the key has a
 * hard expiry; without it the key persists until deleted.
 */
export async function kvSet(key: string, value: string, exSeconds?: number): Promise<void> {
  await kvFetch(`set/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: JSON.stringify({ ex: exSeconds, value }),
  })
}

/** Deletes `key`. Deleting an absent key is not an error. */
export async function kvDel(key: string): Promise<void> {
  await kvFetch(`del/${encodeURIComponent(key)}`, { method: 'POST' })
}
