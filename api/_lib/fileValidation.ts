/**
 * Validates image file content against magic bytes (file signatures) and
 * structural header limits. Trusts the actual file bytes, never the
 * client-supplied MIME type.
 *
 * Allow-list policy:
 * - Only raster formats the app renders in <img> sinks: JPEG, PNG, GIF.
 * - SVG is deliberately excluded. SVG is an active document format — it can
 *   embed <script>, event handlers, and foreignObject HTML. Served from the
 *   IPFS gateway it would execute in the gateway's origin for anyone opening
 *   the URL directly, turning our Pinata account into an XSS/phishing host.
 * - EXIF/metadata is NOT stripped here. Re-encoding untrusted images requires
 *   a full decode (native codec dependencies, high memory) that exceeds what
 *   we can safely do in this serverless function; decoding attacker-supplied
 *   input is itself an attack surface. Instead we document that uploads are
 *   pinned byte-for-byte: users should strip EXIF (GPS etc.) locally before
 *   uploading anything sensitive.
 */

interface FileSignature {
  mimeType: AllowedImageMimeType
  bytes: Buffer
}

export type AllowedImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif'

// Full, unambiguous signatures — not truncated prefixes.
const FILE_SIGNATURES: FileSignature[] = [
  // \x89PNG\r\n\x1a\n
  {
    mimeType: 'image/png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
  { mimeType: 'image/gif', bytes: Buffer.from('GIF87a', 'ascii') },
  { mimeType: 'image/gif', bytes: Buffer.from('GIF89a', 'ascii') },
]

// Decompression-bomb guard. A 4MB PNG can decode to gigabytes; cap what a
// well-behaved token image could plausibly need. Checked from header fields
// only — the image is never decoded here.
export const MAX_IMAGE_DIMENSION = 8192
export const MAX_IMAGE_PIXELS = 16_777_216 // 16 MP ≈ 64MB decoded RGBA

// Smallest parseable header we accept (PNG signature + IHDR needs 24 bytes).
const MIN_HEADER_BYTES = 12

export interface ImageDimensions {
  width: number
  height: number
}

/** Detect the real image type from file content. Returns null if unrecognized. */
export function sniffImageMimeType(buffer: Buffer): AllowedImageMimeType | null {
  for (const sig of FILE_SIGNATURES) {
    if (
      buffer.length >= sig.bytes.length &&
      buffer.subarray(0, sig.bytes.length).equals(sig.bytes)
    ) {
      return sig.mimeType
    }
  }
  return null
}

/**
 * Read image dimensions from format headers only — no pixel data is decoded.
 * Returns null when the header is malformed for the detected type.
 */
export function probeImageDimensions(
  buffer: Buffer,
  mimeType: AllowedImageMimeType,
): ImageDimensions | null {
  switch (mimeType) {
    case 'image/png':
      return probePng(buffer)
    case 'image/gif':
      return probeGif(buffer)
    case 'image/jpeg':
      return probeJpeg(buffer)
  }
}

function probePng(buffer: Buffer): ImageDimensions | null {
  // Signature (8) + IHDR chunk length (4) + "IHDR" (4) + width (4) + height (4)
  if (buffer.length < 24) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function probeGif(buffer: Buffer): ImageDimensions | null {
  // Logical Screen Descriptor immediately follows the 6-byte signature.
  if (buffer.length < 10) return null
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function probeJpeg(buffer: Buffer): ImageDimensions | null {
  // Walk the segment list until a Start-Of-Frame marker carries the size.
  let offset = 2 // skip SOI (FF D8)
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null // lost sync — malformed stream
    let marker = buffer[offset + 1]
    // Fill bytes: FF can be padded with additional FFs before the marker.
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset++
      marker = buffer[offset + 1]
    }
    // Standalone markers without a length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // EOI/SOS before any SOF
    if (offset + 4 > buffer.length) return null
    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (segmentLength < 2) return null
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG (reserved)
      marker !== 0xcc // DAC
    if (isSof) {
      // Segment layout: length (2) + precision (1) + height (2) + width (2)
      if (offset + 9 > buffer.length) return null
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += 2 + segmentLength
  }
  return null
}

/**
 * Validate file content: magic bytes must identify an allowed format, the
 * detected format must match what the client declared, and header dimensions
 * must be sane (decompression-bomb guard).
 *
 * @param buffer - File buffer to validate
 * @param clientMimeType - MIME type declared by the client; a mismatch with
 *   the sniffed type is rejected rather than silently corrected.
 * @returns { valid: true, mimeType } with the content-verified type, or
 *   { valid: false, error }
 */
export function validateFileMagicBytes(
  buffer: Buffer,
  clientMimeType: string,
): { valid: true; mimeType: AllowedImageMimeType } | { valid: false; error: string } {
  if (buffer.length < MIN_HEADER_BYTES) {
    return { valid: false, error: 'File is too small to determine type.' }
  }

  const sniffedType = sniffImageMimeType(buffer)
  if (!sniffedType) {
    return {
      valid: false,
      error: 'File format not recognized. Only JPEG, PNG, and GIF are allowed.',
    }
  }

  if (sniffedType !== clientMimeType.toLowerCase()) {
    return {
      valid: false,
      error: `Declared type "${clientMimeType}" does not match the file's actual content (${sniffedType}).`,
    }
  }

  const dimensions = probeImageDimensions(buffer, sniffedType)
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    return {
      valid: false,
      error: 'Image header is malformed or missing dimensions.',
    }
  }
  if (
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    return {
      valid: false,
      error: `Image dimensions ${dimensions.width}x${dimensions.height} exceed the allowed limits (max ${MAX_IMAGE_DIMENSION}px per side, ${MAX_IMAGE_PIXELS} total pixels).`,
    }
  }

  return { valid: true, mimeType: sniffedType }
}
