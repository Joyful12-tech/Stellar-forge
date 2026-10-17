/**
 * `GET /api/tokens` — keyset-paginated token listing served by the indexer
 * (issue #943, spec milestone M3).
 *
 * Read-only and public, mirroring but not replacing the on-chain view
 * functions: the indexer is a read-optimization layer, never a source of
 * truth, and the frontend must always be able to fall back to direct RPC.
 *
 * Pagination is keyset (`token_index < cursor`) rather than `OFFSET`, so page
 * cost does not grow with depth.
 *
 * Query parameters:
 *   creator  optional G… address filter
 *   cursor   optional keyset cursor from the previous page's `nextCursor`
 *   limit    optional 1..100, clamped server-side (default 20)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStore } from '../_lib/indexer/store'
import { clampLimit, indexedAtIso, parseCursor } from '../_lib/indexer/types'
import { firstQueryValue, indexerUnavailable, requireMethod } from '../_lib/http'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return

  try {
    const store = await getStore()
    const state = await store.getState()

    const result = await store.listTokens({
      creator: firstQueryValue(req.query['creator']),
      cursor: parseCursor(firstQueryValue(req.query['cursor'])),
      limit: clampLimit(firstQueryValue(req.query['limit'])),
    })

    // Short cache: the ingest cron runs every few minutes, so a stale response
    // is bounded and cheap, while `indexedAt` still lets the client judge
    // freshness for itself rather than being handed cached data as live.
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    res.status(200).json({
      tokens: result.tokens,
      nextCursor: result.nextCursor,
      indexedAt: indexedAtIso(state),
    })
  } catch (err) {
    indexerUnavailable(res, err)
  }
}
