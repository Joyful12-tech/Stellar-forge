/**
 * Request guards and helpers shared by the API route handlers.
 *
 * Each `require*` guard either returns the value the handler needs or writes
 * the error response itself and returns `null`/`false`, so a handler reads:
 *
 *   if (!requireMethod(req, res, 'POST')) return
 *   const wallet = await requireRateLimitedWallet(req, res, '…')
 *   if (!wallet) return
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyToken } from './jwt'
import { pinataHeaders } from './pinata'
import { isActionRateLimited } from './rateLimit'

/** First query value only — Vercel surfaces repeated params as arrays. */
export function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Reject any method other than `method` with a 405. */
export function requireMethod(req: VercelRequest, res: VercelResponse, method: string): boolean {
  if (req.method === method) return true
  res.status(405).json({ error: 'Method not allowed' })
  return false
}

/**
 * Authenticate the caller from the `Bearer` JWT issued by the challenge →
 * signature flow. Returns the wallet address, or responds 401.
 */
export function requireWalletAuth(req: VercelRequest, res: VercelResponse): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization required. Request a challenge and sign with your wallet.',
    })
    return null
  }

  try {
    return verifyToken(authHeader.slice('Bearer '.length)).address
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired token.',
    })
    return null
  }
}

/**
 * {@link requireWalletAuth}, then enforce the per-wallet action rate limit
 * (durable across instances), responding 429 with `limitedMessage`.
 */
export async function requireRateLimitedWallet(
  req: VercelRequest,
  res: VercelResponse,
  limitedMessage: string,
): Promise<string | null> {
  const walletAddress = requireWalletAuth(req, res)
  if (!walletAddress) return null

  if (await isActionRateLimited(walletAddress)) {
    res.status(429).json({ error: limitedMessage })
    return null
  }
  return walletAddress
}

/**
 * Whether a cron invocation is authorized. Vercel signs cron invocations with
 * `Authorization: Bearer $CRON_SECRET`; the cron jobs cost RPC quota and can
 * unpin content, so they must never run unauthenticated.
 */
export function isCronAuthorized(req: VercelRequest): boolean {
  const secret = process.env['CRON_SECRET']
  // No secret configured: allow only outside production, so a misconfigured
  // deployment fails closed rather than exposing the endpoint.
  if (!secret) return process.env['VERCEL_ENV'] !== 'production'
  return req.headers.authorization === `Bearer ${secret}`
}

/** Respond 401 unless {@link isCronAuthorized}. */
export function requireCronAuth(req: VercelRequest, res: VercelResponse): boolean {
  if (isCronAuthorized(req)) return true
  res.status(401).json({ error: 'Unauthorized' })
  return false
}

/** Pinata request headers, or a 500 when the server lacks credentials. */
export function requirePinataHeaders(
  res: VercelResponse,
  extra?: Record<string, string>,
): Record<string, string> | null {
  try {
    return pinataHeaders(extra)
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Server misconfiguration.',
    })
    return null
  }
}

/** Respond 503 for an indexer read failure; clients fall back to direct RPC. */
export function indexerUnavailable(res: VercelResponse, err: unknown): void {
  res.status(503).json({
    error: 'Indexer unavailable',
    detail: err instanceof Error ? err.message : String(err),
  })
}
