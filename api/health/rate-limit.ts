/**
 * `GET /api/health/rate-limit` — is rate limiting backed by a durable store?
 *
 * `isRateLimited` falls back to an in-memory per-instance limiter whenever
 * VERCEL_KV_REST_API_URL / VERCEL_KV_REST_API_TOKEN are unset. On Vercel,
 * requests have no routing affinity between invocations, so per-instance
 * counters enforce only a fraction of the configured limit — effectively no
 * working abuse protection (issue #14).
 *
 * This endpoint mirrors the pattern of `/api/health/auth` (challenge store
 * durability) and `/api/health/indexer` (indexer durability): it surfaces the
 * durable/degraded distinction so operators can catch a mis-provisioned
 * deployment before it ships without rate limiting on the upload endpoints.
 *
 * Presence only — no key material, no URLs, no counters.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isRateLimitDurable } from '../_lib/rateLimit'
import { requireMethod } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return

  const durable = isRateLimitDurable()

  // 503 when not durable: a deployment missing the KV vars has no working
  // abuse protection on upload endpoints, which is a degraded state that
  // should page an operator just like a missing challenge store does.
  // Never cached — the answer only changes on a redeploy or env-var edit,
  // but a stale "healthy" here has direct security consequences.
  res.setHeader('Cache-Control', 'no-store')
  res.status(durable ? 200 : 503).json({
    healthy: durable,
    durable,
    store: durable ? 'vercel-kv' : 'in-memory',
    detail: durable
      ? 'Rate limiting is backed by Vercel KV and is consistent across all instances.'
      : 'Rate limiting is using a per-instance in-memory fallback (local-dev mode). ' +
        'Each serverless instance enforces limits independently, providing no meaningful ' +
        'protection in a multi-instance production deployment. ' +
        'Set VERCEL_KV_REST_API_URL and VERCEL_KV_REST_API_TOKEN to enable durable rate limiting.',
  })
}
