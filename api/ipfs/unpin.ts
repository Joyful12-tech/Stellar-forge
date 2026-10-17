import type { VercelRequest, VercelResponse } from '@vercel/node'
import { PINATA_API_URL } from '../_lib/pinata'
import { isValidCid } from '../_lib/schemaValidation'
import { requireMethod, requirePinataHeaders, requireRateLimitedWallet } from '../_lib/http'
import { getPinOwner, clearPinOwner } from '../_lib/pinOwnership'

interface UnpinBody {
  cid: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return

  const walletAddress = await requireRateLimitedWallet(
    req,
    res,
    'Too many requests. Please try again later.',
  )
  if (!walletAddress) return

  const body = req.body as UnpinBody | undefined
  const rawCid = typeof body?.cid === 'string' ? body.cid : null
  if (!rawCid || !isValidCid(rawCid)) {
    auditUnpin(walletAddress, rawCid ?? '(missing)', 'denied_invalid_cid')
    res.status(400).json({ error: 'Request body must include a valid { cid: string }.' })
    return
  }
  const cid = rawCid

  // Ownership check: a CID may only be unpinned by the wallet that pinned
  // it. An unindexed/unknown CID is denied by default — we never assume
  // the requester owns content we have no record of.
  const ownerAddress = await getPinOwner(cid)

  if (ownerAddress === null) {
    auditUnpin(walletAddress, cid, 'denied_unknown_cid')
    res.status(403).json({
      error:
        'This CID has no known owner on record. Unpin is denied by default for unindexed content.',
    })
    return
  }

  if (ownerAddress !== walletAddress) {
    auditUnpin(walletAddress, cid, 'denied_not_owner')
    res.status(403).json({ error: 'You are not authorized to unpin this content.' })
    return
  }

  const headers = requirePinataHeaders(res)
  if (!headers) return

  try {
    const pinataRes = await fetch(`${PINATA_API_URL}/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers,
    })

    // Pinata returns 200 for a successful unpin and 404 when the CID was
    // already gone — both are acceptable outcomes for "make sure it is not
    // pinned any more".
    if (pinataRes.ok || pinataRes.status === 404) {
      await clearPinOwner(cid)
      auditUnpin(walletAddress, cid, 'allowed')
      res.status(200).json({ cid, unpinned: true })
      return
    }

    if (pinataRes.status === 429) {
      auditUnpin(walletAddress, cid, 'pinata_rate_limited')
      res.status(502).json({ error: 'Pinata rate limit reached. Please try again later.' })
      return
    }

    auditUnpin(walletAddress, cid, 'pinata_error')
    res.status(502).json({ error: `Pinata unpin failed (HTTP ${pinataRes.status}).` })
  } catch {
    auditUnpin(walletAddress, cid, 'error')
    res.status(500).json({ error: 'Unexpected error while unpinning from IPFS.' })
  }
}

/** Structured audit log for every unpin attempt, allowed or rejected. */
function auditUnpin(address: string, cid: string, outcome: string): void {
  console.log(
    JSON.stringify({
      event: 'ipfs_unpin',
      address,
      cid,
      outcome,
      at: new Date().toISOString(),
    }),
  )
}
