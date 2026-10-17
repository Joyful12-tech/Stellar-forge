import { signMessage } from '@stellar/freighter-api'
import { IPFSUploadError } from './ipfs-errors'

const CHALLENGE_ENDPOINT = '/api/auth/challenge'
const UPLOAD_TOKEN_KEY = 'ipfs_upload_token'
const UPLOAD_TOKEN_EXPIRY_KEY = 'ipfs_upload_token_expiry'

interface TokenData {
  token: string
  expiresAt: number
}

/**
 * Obtain an authenticated JWT for upload requests.
 * Flow:
 * 1. Request a challenge from /api/auth/challenge?address=<wallet>
 * 2. Sign the challenge with Freighter's signMessage
 * 3. POST signature + address to /api/auth/challenge to get JWT
 *
 * @param walletAddress - The connected Stellar wallet address
 * @returns JWT token valid for 5 minutes
 * @throws IPFSUploadError if auth fails
 */
export async function getUploadToken(walletAddress: string): Promise<string> {
  // Check if we have a cached token that's still valid
  const cached = getCachedToken()
  if (cached) {
    return cached
  }

  try {
    // Step 1: Get challenge
    const challengeRes = await fetch(
      `${CHALLENGE_ENDPOINT}?address=${encodeURIComponent(walletAddress)}`,
    )
    if (!challengeRes.ok) {
      throw new Error(`Failed to request challenge (HTTP ${challengeRes.status})`)
    }
    const { challenge } = (await challengeRes.json()) as { challenge?: string }
    if (!challenge) {
      throw new Error('Challenge not provided by server')
    }

    // Step 2: Sign challenge with Freighter
    const signRes = await signMessage(challenge, { address: walletAddress })
    if (signRes.error) {
      throw new Error(signRes.error)
    }
    if (!signRes.signedMessage) {
      throw new Error('Failed to sign message with Freighter')
    }

    // Step 3: Exchange signature for JWT
    const tokenRes = await fetch(CHALLENGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: walletAddress,
        signature: signRes.signedMessage,
      }),
    })

    if (!tokenRes.ok) {
      const err = (await tokenRes.json()) as { error?: string }
      throw new Error(err.error || `Failed to get token (HTTP ${tokenRes.status})`)
    }

    const { token } = (await tokenRes.json()) as { token?: string }
    if (!token) {
      throw new Error('Token not provided by server')
    }

    // Cache token for 4.5 minutes (expires in 5, cache for 4.5 to be safe)
    cacheToken(token)

    return token
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during authentication'
    throw new IPFSUploadError(`Authentication failed: ${message}`)
  }
}

/**
 * Store token in localStorage with an expiry time.
 */
function cacheToken(token: string): void {
  try {
    const expiresAt = Date.now() + 4.5 * 60 * 1000 // 4.5 minutes
    localStorage.setItem(UPLOAD_TOKEN_KEY, JSON.stringify({ token, expiresAt } as TokenData))
  } catch {
    // localStorage unavailable, token won't be cached but auth will still work
  }
}

/**
 * Retrieve cached token if it's still valid.
 */
function getCachedToken(): string | null {
  try {
    const stored = localStorage.getItem(UPLOAD_TOKEN_KEY)
    if (!stored) return null

    const data: TokenData = JSON.parse(stored)
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(UPLOAD_TOKEN_KEY)
      return null
    }

    return data.token
  } catch {
    return null
  }
}

/**
 * Clear cached token (e.g., on logout).
 */
export function clearUploadToken(): void {
  try {
    localStorage.removeItem(UPLOAD_TOKEN_KEY)
    localStorage.removeItem(UPLOAD_TOKEN_EXPIRY_KEY)
  } catch {
    // localStorage unavailable, ignore
  }
}
