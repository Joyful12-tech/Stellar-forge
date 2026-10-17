/**
 * `GET /api/health/ipfs` — can this deployment pin to IPFS?
 *
 * The upload proxies (`api/ipfs/*`) read `PINATA_API_KEY` / `PINATA_API_SECRET`
 * from server env, which the browser cannot see. Before this endpoint existed
 * the UI answered "are uploads configured?" by reading `VITE_`-prefixed copies
 * of those same credentials — and Vite inlines `VITE_` vars at build time, so
 * the Pinata key and secret shipped inside the JS bundle (issue #921).
 *
 * The response is a single boolean derived from presence alone: no key
 * material, no lengths, no prefixes.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isPinataConfigured } from '../_lib/pinata'
import { requireMethod } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return

  // The answer only changes on redeploy or an env-var edit, so a short cache
  // keeps this off the critical path of every form mount.
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.status(200).json({ configured: isPinataConfigured() })
}
