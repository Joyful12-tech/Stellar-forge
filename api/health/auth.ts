/**
 * `GET /api/health/auth` — is the wallet-auth challenge store durable?
 *
 * The login flow spans two independent invocations (GET issues a challenge,
 * POST verifies the signature over it), so a per-instance store makes it fail
 * for legitimate clients at whatever rate Vercel happens to scale at — issue
 * #1091. That failure is invisible from the outside: it looks exactly like a
 * user taking too long to sign. This endpoint makes the distinction checkable,
 * the same way `/api/health/indexer` reports `durable` for the indexer's store.
 *
 * Presence only — no URL, no token, no key material.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isChallengeStoreDurable } from '../_lib/challengeStore'
import { requireMethod } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return

  const durable = isChallengeStoreDurable()

  // 503 when it is not: a deployment running the dev fallback is degraded, and
  // saying so is the whole point of the check. Never cached — unlike the IPFS
  // check this gates a correctness property, and a stale "healthy" is worse
  // than an extra request.
  res.setHeader('Cache-Control', 'no-store')
  res.status(durable ? 200 : 503).json({
    healthy: durable,
    durable,
    store: durable ? 'vercel-kv' : 'in-memory',
    detail: durable
      ? 'Challenges are stored in Vercel KV and survive across instances.'
      : 'Challenges are stored per-instance in memory (local-dev fallback). A challenge issued by one instance cannot be verified by another; set VERCEL_KV_REST_API_URL and VERCEL_KV_REST_API_TOKEN.',
  })
}
