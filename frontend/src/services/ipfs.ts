// IPFS service - uploads are proxied through our own serverless functions
// (api/ipfs/*) so Pinata credentials never reach the browser bundle.

import { IPFS_CONFIG } from '../config/ipfs'
import { withRetry, isTransientError, HttpError } from '../utils/retry'
import { isValidImageFile } from '../utils/validation'
import { IPFSUploadError } from './ipfs-errors'
import { getUploadToken } from './auth'
import { CID } from 'multiformats/cid'
import * as sha256 from 'multiformats/hashes/sha2'

export { IPFSConfigError, IPFSUploadError } from './ipfs-errors'
export { clearUploadToken } from './auth'

export interface TokenMetadata {
  name: string
  description: string
  image: string // ipfs:// URI
}

export interface UploadMetadataOptions {
  image: File
  description: string
  tokenName: string
  onProgress?: (percent: number) => void
  onRetry?: (attempt: number, delayMs: number) => void
}

/**
 * Caps on free-text metadata fields, enforced on the READ path.
 *
 * Metadata is pinned by whoever created the token and can be written straight
 * to IPFS without going through our upload form, so any write-side limit is
 * advisory only — these are the numbers that actually hold. Without them a
 * creator can pin a multi-megabyte `description` that every visitor to that
 * token's page then renders: enough to stall the tab during reconciliation, or
 * to push phishing content below the fold of a legitimate-looking page.
 *
 * Documented for third-party integrators in docs/metadata-format.md.
 */
export const MAX_METADATA_NAME_LENGTH = 128
export const MAX_METADATA_DESCRIPTION_LENGTH = 2_000

/**
 * Hard ceiling on the raw JSON we will even parse. Truncating after parse still
 * means holding (and JSON-parsing) the whole payload, so a 50MB pin would burn
 * memory and main-thread time before any cap applied.
 */
const MAX_METADATA_BYTES = 100 * 1024

/** Clamp a string to `max` characters, appending an ellipsis when shortened. */
function clamp(value: string, max: number): string {
  // Count by code points so a truncation can't split a surrogate pair and
  // leave a lone half behind.
  const points = [...value]
  if (points.length <= max) return value
  return points.slice(0, max).join('') + '…'
}

// Only ipfs://CID image references are accepted — same pattern the upload
// proxy enforces (api/_lib/schemaValidation.ts). Anything else (http(s),
// data:, javascript:, path traversal) is rejected at parse time so it can
// never reach an <img> src or the gateway resolver.
const IPFS_IMAGE_URI_PATTERN = /^ipfs:\/\/[a-zA-Z0-9]+$/

function isTokenMetadata(value: unknown): value is TokenMetadata {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.image === 'string' &&
    IPFS_IMAGE_URI_PATTERN.test(obj.image)
  )
}

/**
 * Verify that fetched content matches the given CID by hashing the bytes and
 * comparing against the CID's multihash.
 *
 * @param content - Raw response bytes as string (UTF-8 JSON)
 * @param cidString - The CID string from the ipfs:// URI (e.g., "QmXxxx" or "bafy...")
 * @throws {IPFSUploadError} If verification fails or CID is invalid
 */
function looksLikeRealCID(cid: string): boolean {
  if (!cid || cid.length < 10) return false
  const cidV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
  const cidV1 = /^b[a-z2-7]{58,}$/
  return cidV0.test(cid) || cidV1.test(cid)
}

async function verifyCIDMatch(content: string, cidString: string): Promise<void> {
  if (!looksLikeRealCID(cidString)) return

  try {
    // Parse the CID from the string form
    const cid = CID.parse(cidString)

    // Encode content as UTF-8 bytes (matching how IPFS hashes the original JSON)
    const bytes = new TextEncoder().encode(content)

    // Hash the content with the algorithm specified in the CID
    const hash = await sha256.sha256.digest(bytes)

    // Compare the computed hash against the CID's multihash
    // CID.equals performs a deep comparison of the multihashes
    const expectedCID = CID.create(cid.version, cid.code, hash)

    if (!cid.equals(expectedCID)) {
      throw new IPFSUploadError(
        'Metadata content does not match the provided CID. The content may have been tampered with or corrupted.',
      )
    }
  } catch (err) {
    if (err instanceof IPFSUploadError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new IPFSUploadError(`CID verification failed: ${message}`)
  }
}

// Same-origin serverless proxies. Pinata credentials are read from server env
// inside these handlers, so nothing secret is needed in (or reachable from)
// the browser bundle.
const UPLOAD_FILE_ENDPOINT = '/api/ipfs/upload-file'
const UPLOAD_JSON_ENDPOINT = '/api/ipfs/upload-json'
const UNPIN_ENDPOINT = '/api/ipfs/unpin'

/**
 * Result of a metadata upload attempt. The caller needs both CIDs so that a
 * failed follow-up step (e.g. a user-rejected `set_metadata` transaction) can
 * clean up the exact pins that attempt created — see `IPFSService.unpin`.
 */
export interface UploadMetadataResult {
  /** `ipfs://` URI of the metadata JSON — what the contract stores on-chain. */
  metadataUri: string
  /** CID of the pinned image file. */
  imageCid: string
  /** CID of the pinned metadata JSON. */
  metadataCid: string
}

export class IPFSService {
  /**
   * CIDs created by the most recent `uploadMetadata` call, if any.
   * Preserved so that a failed follow-up step (e.g. a rejected Stellar
   * transaction) can reclaim the pins via `unpinLastUpload`.
   */
  private _lastCids: { imageCid: string; metadataCid: string } | null = null

  /** CIDs from the most recent upload, or null if none has happened yet. */
  get lastUploadedCids(): { imageCid: string; metadataCid: string } | null {
    return this._lastCids
  }

  /** Reclaim storage for the CIDs that were pinned during the most recent upload. */
  async unpinLastUpload(walletAddress: string): Promise<void> {
    const cids = this._lastCids
    if (!cids) return
    // Attempt both unpins even if one fails, then report the first error.
    // metadataCid may be empty when the image was uploaded but the metadata
    // JSON upload failed — skip it in that case.
    let firstError: unknown = null
    try {
      await this.unpin(cids.imageCid, walletAddress)
    } catch (e) {
      firstError = firstError ?? e
    }
    if (cids.metadataCid) {
      try {
        await this.unpin(cids.metadataCid, walletAddress)
      } catch (e) {
        firstError = firstError ?? e
      }
    }
    if (firstError) throw firstError instanceof Error ? firstError : new Error(String(firstError))
  }

  /**
   * Unpin a single CID from IPFS via the server-side proxy.
   * Requires wallet authentication (the same challenge→signature→JWT flow
   * used by uploads) so that only the wallet that uploaded a pin can unpin it
   * — a casual attacker without the signing key cannot drain the project's
   * Pinata account.
   */
  async unpin(cid: string, walletAddress: string): Promise<void> {
    const token = await getUploadToken(walletAddress)
    let response: Response
    try {
      response = await withRetry(
        () =>
          fetch(UNPIN_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ cid }),
          }),
        {
          shouldRetry: (err) => isTransientError(err),
        },
      )
    } catch {
      throw new IPFSUploadError('Network error during unpin. Check your connection and try again.')
    }
    if (response.status === 400) {
      throw new IPFSUploadError('Invalid CID format.')
    }
    if (response.status === 401) {
      throw new IPFSUploadError(
        'Authentication expired. Please reconnect your wallet and try again.',
      )
    }
    if (!response.ok) {
      throw new IPFSUploadError(`Failed to unpin ${cid} (HTTP ${response.status}).`)
    }
  }
  /**
   * Upload an image and pin metadata JSON to IPFS via our serverless proxy.
   * Records the created CIDs (`lastUploadedCids`) so a failed follow-up step
   * such as a rejected `set_metadata` transaction can unpin them.
   *
   * Requires wallet authentication: client requests a challenge, signs it with Freighter,
   * and exchanges the signature for a JWT. Both upload hops use the JWT in the Authorization header.
   * Pinata credentials live in server env and are never sent from the browser.
   *
   * @param image       - JPEG/PNG/GIF file, max 4MB (Vercel body limit)
   * @param description - Token description
   * @param tokenName   - Token name (used as metadata `name` field)
   * @param walletAddress - Connected Stellar wallet (for auth)
   * @param onProgress  - Optional progress callback (0–100)
   * @param onRetry     - Optional callback fired before each retry attempt
   * @returns           Metadata URI in ipfs:// format
   *
   * @throws {IPFSUploadError}  On validation failures, auth failures, or exhausted retries
   */
  async uploadMetadata(
    image: File,
    description: string,
    tokenName: string,
    walletAddress: string,
    onProgress?: (percent: number) => void,
    onRetry?: (attempt: number, delayMs: number) => void,
  ): Promise<string> {
    const result = await this.uploadMetadataDetailed(
      image,
      description,
      tokenName,
      walletAddress,
      onProgress,
      onRetry,
    )
    return result.metadataUri
  }

  /**
   * {@link uploadMetadata} variant that also returns the created CIDs, so the
   * caller can unpin the exact pins if the on-chain step that follows fails.
   */
  async uploadMetadataDetailed(
    image: File,
    description: string,
    tokenName: string,
    walletAddress: string,
    onProgress?: (percent: number) => void,
    onRetry?: (attempt: number, delayMs: number) => void,
  ): Promise<UploadMetadataResult> {
    const validation = await isValidImageFile(image)
    if (!validation.valid) {
      throw new IPFSUploadError(validation.error ?? 'Invalid image file.')
    }

    // Obtain JWT for authenticated requests
    onProgress?.(0)
    const token = await getUploadToken(walletAddress)

    // Step 1: Upload image file (progress 0 → 75)
    const imageCid = await this._uploadFile(image, token, onProgress, onRetry)
    // Record the image pin immediately: if the metadata JSON upload below
    // fails, `unpinLastUpload` must still be able to reclaim this CID.
    this._lastCids = { imageCid, metadataCid: '' }

    // Step 2: Build and upload metadata JSON (progress 75 → 100)
    onProgress?.(75)
    const metadata: TokenMetadata = {
      name: tokenName,
      description,
      image: `ipfs://${imageCid}`,
    }
    const metadataCid = await this._uploadJSON(
      metadata,
      `${tokenName}-metadata.json`,
      token,
      onRetry,
    )
    onProgress?.(100)

    this._lastCids = { imageCid, metadataCid }
    return { metadataUri: `ipfs://${metadataCid}`, imageCid, metadataCid }
  }

  /**
   * Fetch and parse metadata JSON from an ipfs:// URI via the Pinata gateway.
   * Verifies that the fetched content matches the CID before treating it as valid.
   *
   * @throws {IPFSUploadError} On invalid URI, network errors, CID verification failures, or non-JSON responses
   */
  async getMetadata(uri: string): Promise<TokenMetadata> {
    if (!uri.startsWith('ipfs://')) {
      throw new IPFSUploadError(`Invalid IPFS URI: "${uri}". Expected format: ipfs://<CID>`)
    }

    const cid = uri.replace('ipfs://', '')
    const url = `${IPFS_CONFIG.pinataGateway}/${cid}`

    let response: Response
    try {
      response = await withRetry(() => fetch(url), {
        shouldRetry: (err) => isTransientError(err),
      })
    } catch {
      throw new IPFSUploadError(
        'Network error while fetching metadata from IPFS gateway. Check your connection.',
      )
    }

    if (!response.ok) {
      throw new IPFSUploadError(
        `Failed to fetch metadata (HTTP ${response.status}). The CID may not be pinned yet.`,
      )
    }

    // Read as text first so an oversized pin is rejected before JSON.parse has
    // to walk it. response.json() would parse the whole payload no matter how
    // large, which is the cost we are trying to avoid.
    let raw: string
    try {
      raw = await response.text()
    } catch {
      throw new IPFSUploadError('Network error while reading metadata from the IPFS gateway.')
    }

    if (raw.length > MAX_METADATA_BYTES) {
      throw new IPFSUploadError('Metadata document is too large to display.')
    }

    // Verify CID matches content before parsing (content-addressing integrity check)
    await verifyCIDMatch(raw, cid)

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new IPFSUploadError('Metadata response is not valid JSON.')
    }

    if (!isTokenMetadata(parsed)) {
      throw new IPFSUploadError(
        'Metadata response is missing required fields (name, description, image) or its image is not an ipfs:// URI.',
      )
    }

    // Clamp rather than reject: an over-long description is a bad token, not a
    // broken one, and refusing the whole document would leave the page with no
    // name or image either. Callers therefore always receive bounded strings.
    return {
      name: clamp(parsed.name, MAX_METADATA_NAME_LENGTH),
      description: clamp(parsed.description, MAX_METADATA_DESCRIPTION_LENGTH),
      image: parsed.image,
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _uploadFile(
    file: File,
    token: string,
    onProgress?: (percent: number) => void,
    onRetry?: (attempt: number, delayMs: number) => void,
  ): Promise<string> {
    const doUpload = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 75))
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status === 429 || (xhr.status >= 500 && xhr.status < 600)) {
            reject(
              new HttpError(
                xhr.status,
                `Image upload failed (HTTP ${xhr.status})`,
                xhr.status === 429
                  ? parseInt(xhr.getResponseHeader('Retry-After') ?? '0') || undefined
                  : undefined,
              ),
            )
            return
          }

          if (xhr.status !== 200) {
            reject(
              new IPFSUploadError(`Image upload failed (HTTP ${xhr.status}). Please try again.`),
            )
            return
          }
          try {
            const data = JSON.parse(xhr.responseText) as { cid?: string }
            if (!data.cid) {
              reject(new IPFSUploadError('Upload service returned an unexpected response.'))
              return
            }
            resolve(data.cid)
          } catch {
            reject(new IPFSUploadError('Unexpected response from the upload service.'))
          }
        })

        xhr.addEventListener('error', () => {
          reject(new HttpError(0, 'Network error during image upload'))
        })

        xhr.addEventListener('abort', () => {
          reject(new IPFSUploadError('Image upload was aborted.'))
        })

        // Proxied through our own serverless function with JWT authentication
        xhr.open('POST', UPLOAD_FILE_ENDPOINT)
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(formData)
      })

    const formData = new FormData()
    formData.append('file', file)

    return withRetry(doUpload, {
      maxAttempts: 3,
      shouldRetry: (err) => isTransientError(err),
      onRetry,
    }).catch((err) => {
      if (err instanceof IPFSUploadError) throw err
      const httpErr = err instanceof HttpError ? err : null
      if (httpErr) {
        throw new IPFSUploadError(
          httpErr.status === 0
            ? 'Network error during image upload. Check your connection and try again.'
            : `Image upload failed (HTTP ${httpErr.status}). Please try again.`,
        )
      }
      throw err
    })
  }

  private async _uploadJSON(
    json: object,
    name: string,
    token: string,
    onRetry?: (attempt: number, delayMs: number) => void,
  ): Promise<string> {
    // Shape expected by api/ipfs/upload-json; the serverless function wraps it
    // in Pinata's pinataContent/pinataMetadata envelope using server-side creds.
    const body = { metadata: json, name }

    let response: Response
    try {
      response = await withRetry(
        () =>
          fetch(UPLOAD_JSON_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          }),
        {
          shouldRetry: (err) => isTransientError(err),
          onRetry,
        },
      )
    } catch {
      throw new IPFSUploadError(
        'Network error during metadata upload. Check your connection and try again.',
      )
    }

    if (response.status === 429) {
      throw new IPFSUploadError('Too many upload requests. Please try again later.')
    }
    if (!response.ok) {
      throw new IPFSUploadError(
        `Metadata upload failed (HTTP ${response.status}). Please try again.`,
      )
    }

    let data: { cid?: string }
    try {
      data = (await response.json()) as { cid?: string }
    } catch {
      throw new IPFSUploadError('The upload service returned a non-JSON response.')
    }

    if (!data.cid) {
      throw new IPFSUploadError('The upload service returned an unexpected response.')
    }

    return data.cid
  }
}

export const ipfsService = new IPFSService()
