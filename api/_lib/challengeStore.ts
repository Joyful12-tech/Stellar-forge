/**
 * Storage for wallet-auth challenges (issue #1091).
 *
 * The login flow spans two HTTP requests: a GET issues a challenge, and a
 * later POST verifies the signature over it. On Vercel those are independent
 * invocations with no guaranteed routing affinity, so a challenge written to
 * one instance's memory is simply not there when the POST lands on another —
 * and the client, which did nothing wrong, is told "Challenge not found or
 * expired. Request a new challenge." How often that happens is decided by
 * Vercel's scaling, which is why it can look fine in testing and fail in
 * production.
 *
 * So challenges live in Vercel KV, with the same in-memory fallback
 * `rateLimit.ts` keeps: **local development only, never production-safe**.
 * `/api/health/auth` reports which path is live so a deployment cannot sit on
 * the fallback unnoticed.
 */

import { isKvConfigured, kvDel, kvGet, kvSet } from './kv'

/** Challenges expire after 5 minutes. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

const CHALLENGE_TTL_SECONDS = CHALLENGE_TTL_MS / 1000

/** Namespaced so challenges cannot collide with `ratelimit:` keys. */
function challengeKey(address: string): string {
  return `auth:challenge:${address}`
}

/**
 * Whether challenges survive past the instance that issued them.
 *
 * `false` means the deployment is running the dev fallback and the login flow
 * is only as reliable as request-to-instance luck.
 */
export function isChallengeStoreDurable(): boolean {
  return isKvConfigured()
}

/**
 * Stores `value` as the pending challenge for `address`, replacing any
 * previous one, and expiring after {@link CHALLENGE_TTL_MS}.
 *
 * Throws `KvError` if a configured KV rejects the write. Callers must not
 * hand a challenge to the client after that: it could never be verified.
 */
export async function putChallenge(address: string, value: string): Promise<void> {
  if (!isKvConfigured()) {
    putInMemory(address, value)
    return
  }
  await kvSet(challengeKey(address), value, CHALLENGE_TTL_SECONDS)
}

/**
 * Returns the pending challenge for `address`, or `null` if none was issued or
 * it has expired. Throws `KvError` if a configured KV cannot be read — an
 * outage must not be reported to the client as an expired challenge.
 */
export async function getChallenge(address: string): Promise<string | null> {
  if (!isKvConfigured()) {
    return getFromMemory(address)
  }
  return kvGet(challengeKey(address))
}

/**
 * Consumes the challenge for `address`, enforcing one-time use.
 *
 * Read-then-delete is deliberately not atomic here, matching the behaviour
 * this replaced: two POSTs racing with the same signature can both observe the
 * challenge. Closing that would need `GETDEL`, which also consumes the
 * challenge on the 500 path where the current contract keeps it — a separate
 * change from making the store durable.
 */
export async function deleteChallenge(address: string): Promise<void> {
  if (!isKvConfigured()) {
    memory.delete(address)
    return
  }
  await kvDel(challengeKey(address))
}

// ── In-memory fallback (per-instance, not durable, local dev only) ────────────
//
// Expiry is evaluated on read rather than by a background `setInterval`. The
// observable TTL is identical, and it drops a timer that a serverless instance
// frozen between invocations would never fire on schedule anyway — while
// keeping the process (and the test runner) awake for as long as it lived.

interface StoredChallenge {
  value: string
  createdAt: number
}

const memory = new Map<string, StoredChallenge>()

function putInMemory(address: string, value: string): void {
  sweepExpired()
  memory.set(address, { value, createdAt: Date.now() })
}

function getFromMemory(address: string): string | null {
  const stored = memory.get(address)
  if (!stored) return null
  if (Date.now() - stored.createdAt > CHALLENGE_TTL_MS) {
    memory.delete(address)
    return null
  }
  return stored.value
}

/**
 * Reclaims expired entries on write, so a long-lived dev server cannot grow
 * the map without bound from challenges that were issued and never used.
 */
function sweepExpired(): void {
  const now = Date.now()
  for (const [address, stored] of memory.entries()) {
    if (now - stored.createdAt > CHALLENGE_TTL_MS) {
      memory.delete(address)
    }
  }
}

/** Test-only: drops all in-memory state so cases cannot leak into each other. */
export function __resetInMemoryChallenges(): void {
  memory.clear()
}
