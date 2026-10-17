import type { VercelRequest, VercelResponse } from '@vercel/node'
import { PINATA_API_URL } from '../_lib/pinata'
import { validateTokenMetadata } from '../_lib/schemaValidation'
import { requireMethod, requirePinataHeaders, requireRateLimitedWallet } from '../_lib/http'
import { recordPinOwnerBestEffort } from '../_lib/pinOwnership'

interface UploadJsonBody {
  metadata: unknown
  name: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return

  const walletAddress = await requireRateLimitedWallet(
    req,
    res,
    'Too many upload requests. Please try again later.',
  )
  if (!walletAddress) return

  const body = req.body as UploadJsonBody | undefined
  if (
    !body ||
    typeof body.name !== 'string' ||
    typeof body.metadata !== 'object' ||
    body.metadata === null
  ) {
    res.status(400).json({
      error: 'Request body must include { metadata: object, name: string }.',
    })
    return
  }

  // Validate metadata against schema (name, description, image fields)
  // and enforce strict 8 KiB size limit
  const jsonString = JSON.stringify(body.metadata)
  const schemaValidation = validateTokenMetadata(body.metadata, jsonString)
  if (!schemaValidation.valid) {
    res.status(400).json({ error: schemaValidation.error })
    return
  }

  const headers = requirePinataHeaders(res, { 'Content-Type': 'application/json' })
  if (!headers) return

  try {
    const pinataRes = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pinataContent: body.metadata,
        pinataMetadata: { name: body.name },
        pinataOptions: { cidVersion: 1 },
      }),
    })

    if (!pinataRes.ok) {
      res.status(502).json({ error: `Pinata upload failed (HTTP ${pinataRes.status}).` })
      return
    }

    const data = (await pinataRes.json()) as { IpfsHash: string }
    await recordPinOwnerBestEffort(data.IpfsHash, walletAddress)
    res.status(200).json({ cid: data.IpfsHash })
  } catch {
    res.status(500).json({ error: 'Unexpected error while uploading metadata to IPFS.' })
  }
}
