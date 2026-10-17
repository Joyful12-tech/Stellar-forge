/**
 * Stand-in for `@neondatabase/serverless`, so `getStore()`'s durable path can
 * be exercised without a database (issue #1156).
 *
 * `INDEXER_PG_DRIVER` points at this module in tests; `getStore` only needs
 * `neon(url)` to return a callable `(text, params)` executor.
 */

export function neon(_url: string) {
  return async (_text: string, _params: unknown[] = []) => [] as unknown[]
}
