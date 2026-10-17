import { IPFS_CONFIG } from '../config/ipfs'
import i18n from '../i18n'

/**
 * Convert a raw integer amount (in atomic units / stroops) to a decimal display string.
 * Uses BigInt arithmetic throughout to avoid floating-point precision loss.
 *
 * @param amount - Raw integer amount as a string or BigInt
 * @param decimals - Number of decimal places (e.g. 7 for XLM/Soroban tokens)
 * @returns Formatted decimal string, e.g. ('1000000000', 7) → '100.0000000'
 */
export const formatTokenAmount = (amount: string | bigint, decimals: number): string => {
  if (decimals === 0) return amount.toString()

  const raw = BigInt(amount.toString())
  const isNeg = raw < 0n
  const abs = isNeg ? -raw : raw
  const factor = BigInt(10 ** decimals)
  const whole = abs / factor
  const frac = abs % factor

  const fracStr = frac.toString().padStart(decimals, '0')
  const result = `${whole.toString()}.${fracStr}`
  return isNeg ? `-${result}` : result
}

/**
 * Truncate a Stellar public key to 'GABC...XYZ' format.
 *
 * @param address - Full Stellar address (e.g. 56-char G... key)
 * @param chars - Number of characters to show at each end (default: 4)
 * @returns Truncated address string, e.g. 'GABC...WXYZ'
 */
export const truncateAddress = (address: string, chars: number = 4): string => {
  if (address.length <= chars * 2) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

/**
 * Format a Unix timestamp (seconds) into a human-readable date string.
 * Output format: 'MMM DD, YYYY' (e.g. 'Mar 19, 2026').
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted date string
 */
export const formatDate = (timestamp: number): string => {
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp * 1000))
}

/**
 * Format a raw XLM amount in stroops to a display string with ' XLM' suffix.
 * Wrapper around formatTokenAmount with 7 decimals.
 *
 * @param stroops - Raw stroop amount as string, number, or BigInt
 * @returns Formatted string, e.g. '100.0000000 XLM'
 */
export const formatXLM = (stroops: string | number | bigint): string => {
  return `${formatTokenAmount(BigInt(stroops.toString()), 7)} XLM`
}

// ── Existing utilities (preserved) ───────────────────────────────────────────

/**
 * Format a full Stellar address with configurable prefix/suffix lengths.
 * Prefer truncateAddress for the standard 4-char format.
 */
export const formatAddress = (
  address: string,
  prefixLen: number = 6,
  suffixLen: number = 4,
): string => {
  if (!address) return ''
  if (address.length <= prefixLen + suffixLen) return address
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`
}

/** Convert stroops (integer) to XLM (float). */
export const stroopsToXLM = (stroops: number | string): number => {
  return parseFloat(stroops.toString()) / 10_000_000
}

/** Convert XLM (float) to stroops (integer, floored). */
export const xlmToStroops = (xlm: number | string): number => {
  return Math.floor(parseFloat(xlm.toString()) * 10_000_000)
}

/**
 * Inline placeholder rendered in place of token art we refuse to load.
 * A self-contained data: URI so displaying it never issues a network request.
 */
export const TOKEN_IMAGE_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" fill="#e5e7eb"/>' +
      '<path d="M28 62l14-18 10 12 6-7 10 13z" fill="#9ca3af"/>' +
      '<circle cx="36" cy="34" r="6" fill="#9ca3af"/>' +
      '</svg>',
  )

/**
 * Convert an ipfs:// URI to a Pinata gateway URL.
 *
 * Anything that is not a well-formed `ipfs://` URI resolves to
 * TOKEN_IMAGE_PLACEHOLDER rather than being returned unchanged. Token metadata
 * is attacker-controlled — it is pinned by whoever created the token — so
 * passing an arbitrary URL through here would let a token embed a
 * `https://evil.example/pixel.png` that every viewer's browser then fetches,
 * leaking IP and user-agent and giving the creator a view-tracking beacon.
 * Returning a placeholder keeps rendering total (callers always get a usable
 * src) while guaranteeing the only origin we ever hit is the IPFS gateway.
 */
export const ipfsToGatewayUrl = (uri: string): string => {
  if (typeof uri !== 'string') return TOKEN_IMAGE_PLACEHOLDER
  if (!uri.startsWith('ipfs://')) return TOKEN_IMAGE_PLACEHOLDER

  const path = uri.slice('ipfs://'.length).replace(/^\/+/, '')
  // Reject traversal, embedded credentials/hosts, or an empty CID — all of
  // which could steer the request away from the gateway path we intend.
  if (!path || !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*$/.test(path)) {
    return TOKEN_IMAGE_PLACEHOLDER
  }
  // A `..` segment would still normalise out of the /ipfs/ prefix in the
  // browser, so reject it even though the origin itself stays correct.
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return TOKEN_IMAGE_PLACEHOLDER
  }

  const gatewayBase = IPFS_CONFIG.pinataGateway.replace(/\/+$/, '')
  return `${gatewayBase}/${path}`
}

type ExplorerLinkType = 'tx' | 'contract' | 'account'
type Network = 'testnet' | 'mainnet' | 'standalone'

const EXPLORER_BASES: Record<Network, string> = {
  mainnet: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  // A local `standalone` network has no public explorer; fall back to testnet
  // as a best-effort so links don't break in dev/E2E.
  standalone: 'https://stellar.expert/explorer/testnet',
}

/** Build a stellar.expert explorer URL for a tx, contract, or account. */
export const stellarExplorerUrl = (
  type: ExplorerLinkType,
  value: string,
  network: Network = 'testnet',
): string => `${EXPLORER_BASES[network]}/${type}/${value}`

/**
 * Format a Unix timestamp (seconds) into a full date-time string with time and timezone.
 * For date-only display use formatDate instead.
 */
export const formatTimestamp = (timestamp: number): string => {
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(timestamp * 1000))
}

/**
 * Parse a decimal display string back to a raw integer string.
 *
 * @param display - Decimal string, e.g. '100.0000000'
 * @param decimals - Number of decimal places
 * @returns Raw integer string, e.g. '1000000000'
 */
export const parseTokenAmount = (display: string, decimals: number): string => {
  const parts = display.split('.')
  const whole = parts[0] ?? '0'
  const frac = (parts[1] ?? '').padEnd(decimals, '0').slice(0, decimals)
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac || '0')).toString()
}

/** Return a relative time string (e.g. '2 minutes ago') for a Unix timestamp. */
export const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor(Date.now() / 1000) - timestamp
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second')
  const minutes = Math.floor(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.floor(hours / 24), 'day')
}
