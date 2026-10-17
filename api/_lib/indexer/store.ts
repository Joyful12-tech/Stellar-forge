/**
 * Store selection for the contract-event indexer (issue #943).
 *
 * Mirrors the pattern already used by `api/_lib/rateLimit.ts`: use the durable
 * backend when it is configured, otherwise fall back to an in-memory one that
 * keeps local development working but is explicitly not production-safe.
 *
 * The fallback is deliberately *not* sticky when a durable backend is
 * configured (issue #1156). A single cold-start connect blip used to be cached
 * for the rest of the instance's lifetime, so every later caller — including
 * destructive ones like pin reconciliation — silently read an empty store and
 * believed it. Now a degraded instance retries on a backoff and reports itself
 * through `getStoreHealth()`, which destructive callers must consult.
 */

import { MemoryTokenStore } from './memoryStore'
import { createPostgresStore, type SqlExecutor } from './postgresStore'
import type { TokenStore } from './types'

/** Minimum gap between durable-connect attempts after a failure. */
export const DURABLE_RETRY_BACKOFF_MS = 30_000

let cached: TokenStore | null = null
/** Whether `cached` is the durable backend rather than the in-memory fallback. */
let cachedIsDurable = false
/** Last durable-connect failure, for the health signal. `null` when healthy. */
let lastDurableError: string | null = null
/** Timestamp of the last durable-connect attempt, for the retry backoff. */
let lastDurableAttemptAt = 0

/** True when a durable Postgres backend is configured for this deployment. */
export function isDurableStoreConfigured(): boolean {
  return Boolean(process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL'])
}

/** Health signal for callers that must not act on a degraded store. */
export interface StoreHealth {
  /** A durable backend is configured via `POSTGRES_URL` / `DATABASE_URL`. */
  durableConfigured: boolean
  /** The resolved store actually is that durable backend. */
  usingDurableStore: boolean
  /** Last durable-connect failure message, or `null` when there was none. */
  lastDurableError: string | null
}

/**
 * Report whether the process-wide store is the durable backend it is supposed
 * to be.
 *
 * `durableConfigured && !usingDurableStore` means this instance degraded to an
 * empty in-memory store: reads succeed but return nothing, which is
 * indistinguishable from "no data exists" to any caller that does not check.
 * Destructive callers must refuse to run in that state.
 */
export function getStoreHealth(): StoreHealth {
  return {
    durableConfigured: isDurableStoreConfigured(),
    usingDurableStore: cachedIsDurable,
    lastDurableError,
  }
}

/**
 * Resolve the process-wide `TokenStore`.
 *
 * The Postgres driver is imported dynamically so that deployments without a
 * database — and the unit tests — never need it installed. Any failure to load
 * or connect degrades to the in-memory store rather than taking the read API
 * down: the indexer is a cache, and the frontend falls back to direct RPC.
 *
 * The degrade is transient, not cached: the next call after
 * `DURABLE_RETRY_BACKOFF_MS` retries the real connection, and
 * `getStoreHealth()` reports the degrade in the meantime.
 */
export async function getStore(now: number = Date.now()): Promise<TokenStore> {
  // A healthy durable store is cached for the instance's lifetime.
  if (cached && cachedIsDurable) return cached

  const connectionString = process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) {
    // No database configured at all — the in-memory store is the intended
    // backend here (local development, tests), so keep its state across calls.
    if (!cached) cached = new MemoryTokenStore()
    cachedIsDurable = false
    lastDurableError = null
    return cached
  }

  // Durable backend configured but not connected. Retry, rate-limited so a
  // hard-down database does not turn every request into a connect attempt.
  if (cached && now - lastDurableAttemptAt < DURABLE_RETRY_BACKOFF_MS) return cached
  lastDurableAttemptAt = now

  try {
    // Optional peer dependency: resolved through a variable specifier so the
    // driver only needs to be installed in deployments that actually configure
    // a database. Everything else runs on the in-memory store.
    const driver = process.env['INDEXER_PG_DRIVER'] ?? '@neondatabase/serverless'
    const { neon } = (await import(/* @vite-ignore */ driver)) as {
      neon: (
        url: string,
      ) => (strings: TemplateStringsArray | string, ...values: unknown[]) => Promise<unknown>
    }
    const client = neon(connectionString)

    // `neon()` supports both a tagged-template form and a
    // `(text, params)` form; the latter is what the store needs so that
    // parameters stay out-of-band and can never alter the statement.
    const sql: SqlExecutor = async <T>(text: string, params: unknown[]) =>
      (await (client as unknown as (t: string, p: unknown[]) => Promise<unknown>)(
        text,
        params,
      )) as T[]

    cached = createPostgresStore(sql)
    cachedIsDurable = true
    lastDurableError = null
  } catch (err) {
    // Driver missing or unreachable — degrade rather than fail closed, but
    // record it so destructive callers can refuse to act on the empty store.
    lastDurableError = err instanceof Error ? err.message : String(err)
    cachedIsDurable = false
    console.error(
      '[indexer-store] durable store unavailable, degraded to memory:',
      lastDurableError,
    )
    if (!cached) cached = new MemoryTokenStore()
  }

  return cached
}

/**
 * Test seam: replace the process-wide store.
 *
 * `durable` mirrors what `getStoreHealth()` should report; it defaults to true
 * so that an injected store behaves like the production backend.
 */
export function setStoreForTesting(store: TokenStore | null, durable = true): void {
  cached = store
  cachedIsDurable = store !== null && durable
  lastDurableError = null
  lastDurableAttemptAt = 0
}
