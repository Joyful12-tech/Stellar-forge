import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'crypto'
import { issueToken, verifyToken } from '../_lib/jwt'
import { deleteChallenge, getChallenge, putChallenge } from '../_lib/challengeStore'
import { clientIp, isChallengeRateLimited, isActionRateLimited } from '../_lib/rateLimit'

// Challenge storage — TTL, one-time use and the durable/dev-fallback split all
// live in `../_lib/challengeStore` (issue #1091). It used to be a Map in this
// module, which meant the GET that issued a challenge and the POST that
// verified it had to be served by the same instance to work at all.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // POST /api/auth/challenge { address: string, signature: string, publicKey: string }
  // Returns: { token: string } if valid, or { error: string }
  //
  // Flow:
  // 1. Frontend calls GET to get a challenge hex string
  // 2. Frontend signs it with Freighter's signMessage
  // 3. Frontend POSTs the signature + address
  // 4. We verify signature and return JWT

  if (req.method === 'GET') {
    return handleGetChallenge(req, res)
  } else if (req.method === 'POST') {
    return handleVerifyChallenge(req, res)
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}

async function handleGetChallenge(req: VercelRequest, res: VercelResponse) {
  const { address } = req.query

  if (typeof address !== 'string' || !address.startsWith('G')) {
    res.status(400).json({ error: 'Missing or invalid address query parameter.' })
    return
  }

  // Rate limit by requester IP — not by target address — so an attacker who
  // knows a victim's public Stellar address cannot exhaust the victim's login
  // budget by flooding this unauthenticated endpoint (issue #1162).
  const ip = clientIp(req)
  if (await isChallengeRateLimited(ip)) {
    res.status(429).json({ error: 'Too many challenge requests. Please try again later.' })
    return
  }

  // Generate a new challenge for this address
  const challengeValue = randomBytes(32).toString('hex')

  // The challenge is only handed to the client once it is durably stored. A
  // failed write would otherwise produce a challenge that no later request can
  // verify — the exact symptom issue #1091 exists to remove.
  try {
    await putChallenge(address, challengeValue)
  } catch (err) {
    console.error('Failed to store auth challenge:', err)
    res.status(500).json({ error: 'Could not issue a challenge. Try again.' })
    return
  }

  res.status(200).json({ challenge: challengeValue })
}

async function handleVerifyChallenge(req: VercelRequest, res: VercelResponse) {
  const { address, signature } = req.body

  if (typeof address !== 'string' || !address.startsWith('G')) {
    res.status(400).json({ error: 'Missing or invalid address.' })
    return
  }

  if (typeof signature !== 'string' || !signature) {
    res.status(400).json({ error: 'Missing signature.' })
    return
  }

  // Rate limit per address to prevent brute-force probing of the
  // signature-verification path. This is keyed on address (proof of
  // possession already required to reach here meaningfully) and uses the
  // authenticated-action bucket so it is independent of the challenge-issuance
  // IP bucket (issue #1162).
  if (await isActionRateLimited(address)) {
    res.status(429).json({ error: 'Too many verification attempts. Please try again later.' })
    return
  }

  // A store failure must not be reported as a missing challenge: that would
  // tell a correct client to request a new one, forever, while the real fault
  // is server-side.
  let storedChallenge: string | null
  try {
    storedChallenge = await getChallenge(address)
  } catch (err) {
    console.error('Failed to read auth challenge:', err)
    res.status(500).json({ error: 'Could not verify the challenge. Try again.' })
    return
  }

  if (!storedChallenge) {
    res.status(400).json({ error: 'Challenge not found or expired. Request a new challenge.' })
    return
  }

  // Verify the signature using Stellar's public key cryptography (SEP-53).
  // Freighter's signMessage returns a base64-encoded 64-byte Ed25519 signature.
  try {
    const verified = await verifyStellarSignature(address, storedChallenge, signature)

    if (!verified) {
      res.status(401).json({ error: 'Signature verification failed.' })
      await deleteChallenge(address)
      return
    }

    // Clean up used challenge
    await deleteChallenge(address)

    // Issue a JWT valid for 5 minutes
    const token = issueToken(address, 5 * 60 * 1000)
    res.status(200).json({ token })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Signature verification failed.',
    })
  }
}

/**
 * Verifies a Stellar message signature produced by Freighter's signMessage.
 *
 * Wire format (SEP-53, @stellar/freighter-api v6+):
 *   signedMessage = base64( Ed25519Sign( SHA256("Stellar Signed Message:\n" + challenge) ) )
 *
 * Verification algorithm:
 *   1. Reconstruct the SEP-53 payload: SHA256("Stellar Signed Message:\n" + message)
 *   2. Decode the base64 signature to 64 raw bytes.
 *   3. Use Keypair.verify() from stellar-sdk (ed25519) to check the signature.
 *
 * Only stellar-sdk is required — no tweetnacl, no StrKey decoding.
 */
async function verifyStellarSignature(
  address: string,
  message: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const { createHash } = await import('crypto')
    const { Keypair } = await import('stellar-sdk')

    // SEP-53: prefix + message, then SHA-256
    const payload = Buffer.from('Stellar Signed Message:\n' + message, 'utf-8')
    const hash = createHash('sha256').update(payload).digest()

    // Decode the raw 64-byte Ed25519 signature from base64
    const signatureBytes = Buffer.from(signatureBase64, 'base64')

    // Keypair.verify(data, signature) — returns true if valid, false otherwise
    const keypair = Keypair.fromPublicKey(address)
    return keypair.verify(hash, signatureBytes)
  } catch (err) {
    // Malformed address, malformed base64, or SDK error → reject
    console.error('Signature verification error:', err)
    return false
  }
}
