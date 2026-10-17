// Validation utilities
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Uint8Array {
  const upper = input.toUpperCase().replace(/=+$/, '')
  const length = upper.length
  const count = Math.floor((length * 5) / 8)
  const result = new Uint8Array(count)

  let buffer = 0
  let bitsLeft = 0
  let next = 0

  for (let i = 0; i < length; i++) {
    const val = ALPHABET.indexOf(upper[i]!)
    if (val === -1) throw new Error('Invalid base32 character')
    buffer = (buffer << 5) | val
    bitsLeft += 5
    if (bitsLeft >= 8) {
      result[next++] = (buffer >> (bitsLeft - 8)) & 0xff
      bitsLeft -= 8
    }
  }
  return result
}

function crc16(data: Uint8Array): number {
  let crc = 0x0000
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!
    let code = (crc >>> 8) & 0xff
    code ^= byte
    code ^= code >>> 4
    crc = (crc << 8) ^ (code << 12) ^ (code << 5) ^ code
    crc &= 0xffff
  }
  return crc
}

export const isValidStellarAddress = (address: string): boolean => {
  try {
    if (address.length !== 56) return false
    if (address[0] !== 'G') return false
    const decoded = base32Decode(address)
    if (decoded.length !== 35) return false
    const versionByte = decoded[0]
    if (versionByte !== 0x30) return false // 6 << 3 = 48 (0x30) for Ed25519 Public Key

    const payload = decoded.slice(1, 33)
    const checksum = decoded.slice(33, 35)
    const calculatedCrc = crc16(new Uint8Array([versionByte, ...payload]))
    const expectedCrc = checksum[0]! | (checksum[1]! << 8)
    return calculatedCrc === expectedCrc
  } catch {
    return false
  }
}

export const isValidContractAddress = (address: string): boolean => {
  try {
    if (address.length !== 56) return false
    if (address[0] !== 'C') return false
    const decoded = base32Decode(address)
    if (decoded.length !== 35) return false
    const versionByte = decoded[0]
    if (versionByte !== 0x10) return false // 2 << 3 = 16 (0x10) for Contract

    const payload = decoded.slice(1, 33)
    const checksum = decoded.slice(33, 35)
    const calculatedCrc = crc16(new Uint8Array([versionByte, ...payload]))
    const expectedCrc = checksum[0]! | (checksum[1]! << 8)
    return calculatedCrc === expectedCrc
  } catch {
    return false
  }
}

// ── Character policy ──────────────────────────────────────────────────
//
// The contract (validate_token_params in lib.rs:749) places no
// restriction on which characters a name or symbol may contain.  It
// only enforces non-empty, name ≤ 32 UTF-8 bytes, symbol ≤ 12 UTF-8
// bytes (with UTF-8 length measured by String::len() on Soroban).
//
// For symbols the frontend additionally enforces ASCII alphanumeric +
// hyphens — a common convention for ticker symbols that avoids
// display/rendering surprises.  This is a UI convention, not a
// contract-boundary restriction; the contract will accept any symbol
// the UI allows.
//
// For names the frontend blocks only characters that are dangerous in
// display or input contexts (control characters, zero-width spaces,
// bidirectional overrides, BOM) and permits everything else, including
// non-Latin scripts.  The contract accepts the same set.
//
// These constants are the single source of truth for the frontend.
// Any change to the numeric bounds MUST also update the corresponding
// literals in contracts/token-factory/src/lib.rs's
// validate_token_params.  The CI check in scripts/check-validation-drift.sh
// verifies they stay in sync.
// ──────────────────────────────────────────────────────────────────────

const TOKEN_NAME_MIN_LENGTH = 1
const TOKEN_NAME_MAX_LENGTH = 32
const TOKEN_SYMBOL_MIN_LENGTH = 1
const TOKEN_SYMBOL_MAX_LENGTH = 12
const TOKEN_DECIMALS_MIN = 0
const TOKEN_DECIMALS_MAX = 18

// Matches control characters (Cc) and Unicode format characters (Cf)
// that should never appear in a token name: C0 controls excluding
// tab/newline/carriage-return, C1 controls, zero-width characters,
// bidirectional overrides, BOM, and other invisible formatting chars.
//
// `no-control-regex` fires here by design: matching control characters is the
// entire point of this pattern, and dropping them would silently reopen the
// invisible-character injection this rejects.
const DANGEROUS_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u2028-\u202F\u2060-\u2069\uFEFF]/

// Symbol pattern: ASCII alphanumeric + hyphens (ticker convention)
const TOKEN_SYMBOL_PATTERN = /^[A-Za-z0-9-]+$/

/** Count UTF-8 bytes as String::len() does on Soroban. */
const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length

/**
 * True when the string contains an unpaired (lone) UTF-16 surrogate.
 * TextEncoder silently replaces lone surrogates with U+FFFD, so bytes
 * counted by the client would not match the bytes the contract sees;
 * reject such input outright.
 */
const hasUnpairedSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++ // skip the low half of a valid pair
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const isTokenNameLengthValid = (trimmedName: string): boolean => {
  const bytes = utf8ByteLength(trimmedName)
  return bytes >= TOKEN_NAME_MIN_LENGTH && bytes <= TOKEN_NAME_MAX_LENGTH
}

const isTokenNameCharValid = (trimmedName: string): boolean =>
  !DANGEROUS_CHARS.test(trimmedName) && !hasUnpairedSurrogate(trimmedName)

const isValidTokenNameValue = (trimmedName: string): boolean =>
  isTokenNameLengthValid(trimmedName) && isTokenNameCharValid(trimmedName)

const isTokenSymbolLengthValid = (trimmedSymbol: string): boolean => {
  const bytes = utf8ByteLength(trimmedSymbol)
  return bytes >= TOKEN_SYMBOL_MIN_LENGTH && bytes <= TOKEN_SYMBOL_MAX_LENGTH
}

const isTokenSymbolPatternValid = (trimmedSymbol: string): boolean =>
  TOKEN_SYMBOL_PATTERN.test(trimmedSymbol)

const isValidTokenSymbolValue = (trimmedSymbol: string): boolean =>
  isTokenSymbolLengthValid(trimmedSymbol) && isTokenSymbolPatternValid(trimmedSymbol)

const isValidDecimalsValue = (decimals: number): boolean =>
  decimals >= TOKEN_DECIMALS_MIN && decimals <= TOKEN_DECIMALS_MAX

export const validateTokenParams = (params: {
  name?: string
  symbol?: string
  decimals?: number
  initialSupply?: string
  maxSupply?: string
}) => {
  const errors: Record<string, string> = {}

  const trimmedName = params.name?.trim() || ''
  const trimmedSymbol = params.symbol?.trim() || ''

  if (!isTokenNameLengthValid(trimmedName)) {
    errors.name = `Token name must be ${TOKEN_NAME_MIN_LENGTH}-${TOKEN_NAME_MAX_LENGTH} bytes`
  } else if (!isTokenNameCharValid(trimmedName)) {
    errors.name = 'Token name contains unsupported control characters'
  }

  if (!isTokenSymbolLengthValid(trimmedSymbol)) {
    errors.symbol = `Token symbol must be ${TOKEN_SYMBOL_MIN_LENGTH}-${TOKEN_SYMBOL_MAX_LENGTH} bytes`
  } else if (!isTokenSymbolPatternValid(trimmedSymbol)) {
    errors.symbol = 'Token symbol can only contain alphanumeric characters and hyphens'
  }

  if (
    params.decimals === undefined ||
    params.decimals === null ||
    !isValidDecimalsValue(params.decimals)
  ) {
    errors.decimals = `Decimals must be ${TOKEN_DECIMALS_MIN}-${TOKEN_DECIMALS_MAX}`
  }

  if (!params.initialSupply || parseFloat(params.initialSupply) <= 0) {
    errors.initialSupply = 'Initial supply must be greater than 0'
  }

  // `maxSupply` is optional — an empty value means "uncapped" and the contract
  // receives `None`. When supplied it must mirror the contract's own guards in
  // the shared `validate_token_params`: a positive cap that is not already
  // breached by the initial mint. Checking here turns a failed on-chain
  // transaction (for which the creator still pays a fee) into inline feedback.
  const maxSupply = params.maxSupply?.trim() || ''
  if (maxSupply) {
    const cap = parseFloat(maxSupply)
    if (!Number.isFinite(cap) || cap <= 0) {
      errors.maxSupply = 'Max supply must be greater than 0'
    } else if (params.initialSupply && parseFloat(params.initialSupply) > cap) {
      errors.maxSupply = 'Max supply must be greater than or equal to the initial supply'
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

// CIDv0: Qm + 44 base58 chars (total 46); CIDv1: bafy... base32
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
const CID_V1 = /^b[a-z2-7]{58,}$/

export const isValidIPFSUri = (uri: string): boolean => {
  if (!uri.startsWith('ipfs://')) return false
  const cid = uri.slice(7)
  return CID_V0.test(cid) || CID_V1.test(cid)
}

// Full magic-byte signatures for the allowed raster formats. SVG is
// deliberately excluded: it can carry scripts and would turn the IPFS gateway
// into an XSS host. The serverless proxy (api/_lib/fileValidation.ts) is the
// enforcement point; this client-side copy exists for fast feedback only.
const IMAGE_SIGNATURES: Array<{ mimeType: string; bytes: number[] }> = [
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
]

const SIGNATURE_SNIFF_BYTES = 12

// FileReader rather than Blob.arrayBuffer(): same browser support, and it
// also works under jsdom in tests, which never implemented arrayBuffer().
const readFileHeader = (file: File, length: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, length))
  })

/** Detect the real image type from leading file bytes; null if unrecognized. */
export const sniffImageMimeType = (bytes: Uint8Array): string | null => {
  for (const sig of IMAGE_SIGNATURES) {
    if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) {
      return sig.mimeType
    }
  }
  return null
}

export const isValidImageFile = async (file: File): Promise<{ valid: boolean; error?: string }> => {
  // Kept just under Vercel's 4.5MB serverless function request-body ceiling.
  const maxSize = 4 * 1024 * 1024 // 4MB
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif']

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, and GIF images are allowed' }
  }

  if (file.size > maxSize) {
    return { valid: false, error: 'Image size must be less than 4MB' }
  }

  // Check the file's actual content, not just the declared type. The server
  // re-checks this (plus dimension limits); rejecting here just fails faster.
  let header: Uint8Array
  try {
    header = await readFileHeader(file, SIGNATURE_SNIFF_BYTES)
  } catch {
    return { valid: false, error: 'Could not read the selected file' }
  }

  const sniffedType = sniffImageMimeType(header)
  if (!sniffedType) {
    return {
      valid: false,
      error: 'File content is not a recognized JPEG, PNG, or GIF image',
    }
  }
  if (sniffedType !== file.type) {
    return {
      valid: false,
      error: `File content (${sniffedType}) does not match its declared type (${file.type})`,
    }
  }

  return { valid: true }
}

export const validateTokenName = (name: string): boolean => isValidTokenNameValue(name.trim())

export const validateTokenSymbol = (symbol: string): boolean =>
  isValidTokenSymbolValue(symbol.trim())

export const sanitizeTokenInput = (input: string): string => {
  return input.trim()
}

export const validateDecimals = (decimals: number): boolean => isValidDecimalsValue(decimals)

// Exported for drift detection — scripts/check-validation-drift.sh parses
// these constants and compares them against validate_token_params in lib.rs.
export const TOKEN_NAME_MAX_BYTES = 32
export const TOKEN_SYMBOL_MAX_BYTES = 12
export const TOKEN_DECIMALS_MAX_VALUE = 18

/**
 * Maximum recommended batch size for `create_tokens_batch`.
 *
 * Mirrors `MAX_BATCH_SIZE` in `contracts/token-factory/src/lib.rs`, which is
 * the source of truth and rejects oversized batches on-chain with
 * `Error::BatchSizeExceeded`. This client-side copy exists only to give
 * users early feedback before they pay a simulation fee — keep the two
 * values in sync if the contract's limit ever changes.
 *
 * Split larger deployments into sequential calls of ≤ MAX_BATCH_SIZE each.
 */
export const MAX_BATCH_SIZE = 20

/**
 * Validate that a batch token deployment does not exceed the safe resource limit.
 *
 * Returns `{ valid: true }` when the batch is within the safe limit, or
 * `{ valid: false, error: string }` with a human-readable message when it is not.
 */
export function validateBatchSize(count: number): { valid: boolean; error?: string } {
  if (count <= 0) {
    return { valid: false, error: 'Batch must contain at least one token.' }
  }
  if (count > MAX_BATCH_SIZE) {
    return {
      valid: false,
      error:
        `Batch size of ${count} exceeds the maximum recommended batch size of ${MAX_BATCH_SIZE}. ` +
        `Please split your tokens into multiple batches of ≤ ${MAX_BATCH_SIZE} to avoid ` +
        `a failed on-chain transaction. Each failed submission still costs the simulation fee.`,
    }
  }
  return { valid: true }
}
