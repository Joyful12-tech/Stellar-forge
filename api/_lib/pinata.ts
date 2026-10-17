export const PINATA_API_URL = 'https://api.pinata.cloud'

/**
 * Whether the server holds both Pinata credentials.
 *
 * Exposed so `/api/health/ipfs` can answer "are uploads possible?" without the
 * browser needing a copy of the credentials to inspect. Returns a boolean and
 * nothing derived from the secret values themselves.
 */
export function isPinataConfigured(): boolean {
  return Boolean(process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET)
}

/**
 * Reads Pinata credentials from server-only env vars (never VITE_-prefixed,
 * so they're never inlined into the client bundle) and returns the headers
 * Pinata expects. Throws if the server isn't configured yet.
 */
export function pinataHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const apiKey = process.env.PINATA_API_KEY
  const apiSecret = process.env.PINATA_API_SECRET
  if (!apiKey || !apiSecret) {
    throw new Error(
      'Pinata API credentials are not configured on the server (PINATA_API_KEY / PINATA_API_SECRET).',
    )
  }
  return {
    pinata_api_key: apiKey,
    pinata_secret_api_key: apiSecret,
    ...extra,
  }
}
