import { describe, it, expect } from 'vitest'
import { validateFileMagicBytes, probeImageDimensions, MAX_IMAGE_DIMENSION } from './fileValidation'
import { pngFixture, gifFixture, jpegFixture } from './imageFixtures'

describe('validateFileMagicBytes', () => {
  it('accepts a real PNG declared as image/png', () => {
    const result = validateFileMagicBytes(pngFixture(), 'image/png')
    expect(result).toEqual({ valid: true, mimeType: 'image/png' })
  })

  it('accepts a real JPEG declared as image/jpeg', () => {
    const result = validateFileMagicBytes(jpegFixture(), 'image/jpeg')
    expect(result).toEqual({ valid: true, mimeType: 'image/jpeg' })
  })

  it('accepts GIF87a and GIF89a declared as image/gif', () => {
    expect(validateFileMagicBytes(gifFixture(64, 64, '87a'), 'image/gif').valid).toBe(true)
    expect(validateFileMagicBytes(gifFixture(64, 64, '89a'), 'image/gif').valid).toBe(true)
  })

  it('rejects content whose declared MIME type is spoofed (HTML as image/png)', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    const result = validateFileMagicBytes(html, 'image/png')
    expect(result.valid).toBe(false)
  })

  it('rejects an SVG regardless of declared type', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    expect(validateFileMagicBytes(svg, 'image/png').valid).toBe(false)
    expect(validateFileMagicBytes(svg, 'image/svg+xml').valid).toBe(false)
  })

  it('rejects a real image whose declared type does not match its content', () => {
    const result = validateFileMagicBytes(pngFixture(), 'image/jpeg')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('does not match')
  })

  it('rejects a polyglot with a truncated/partial PNG signature', () => {
    // First 4 signature bytes only, then script content — the old 4-byte
    // prefix check accepted this; the full 8-byte signature must not.
    const partial = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from('<script>alert(1)</script>'),
    ])
    expect(validateFileMagicBytes(partial, 'image/png').valid).toBe(false)
  })

  it('rejects files too small to identify', () => {
    expect(validateFileMagicBytes(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg').valid).toBe(false)
  })

  it('rejects a PNG whose signature is not followed by an IHDR chunk', () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const junk = Buffer.concat([signature, Buffer.alloc(24, 0x41)])
    expect(validateFileMagicBytes(junk, 'image/png').valid).toBe(false)
  })

  it('rejects a JPEG with no SOF marker before scan data', () => {
    const soi = Buffer.from([0xff, 0xd8])
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0])
    expect(
      validateFileMagicBytes(Buffer.concat([soi, sos, Buffer.alloc(8)]), 'image/jpeg').valid,
    ).toBe(false)
  })

  describe('decompression-bomb guard', () => {
    it('rejects a PNG with an oversized dimension', () => {
      const result = validateFileMagicBytes(pngFixture(MAX_IMAGE_DIMENSION + 1, 10), 'image/png')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error).toContain('exceed')
    })

    it('rejects a PNG that stays under per-side limits but exceeds the pixel budget', () => {
      const result = validateFileMagicBytes(pngFixture(8192, 8192), 'image/png')
      expect(result.valid).toBe(false)
    })

    it('rejects a GIF with maxed-out dimensions', () => {
      expect(validateFileMagicBytes(gifFixture(65535, 65535), 'image/gif').valid).toBe(false)
    })

    it('rejects a JPEG with oversized dimensions', () => {
      expect(validateFileMagicBytes(jpegFixture(30000, 30000), 'image/jpeg').valid).toBe(false)
    })

    it('rejects zero-dimension images', () => {
      expect(validateFileMagicBytes(pngFixture(0, 0), 'image/png').valid).toBe(false)
    })
  })
})

describe('probeImageDimensions', () => {
  it('reads PNG dimensions from IHDR without decoding', () => {
    expect(probeImageDimensions(pngFixture(320, 240), 'image/png')).toEqual({
      width: 320,
      height: 240,
    })
  })

  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(probeImageDimensions(gifFixture(320, 240), 'image/gif')).toEqual({
      width: 320,
      height: 240,
    })
  })

  it('reads JPEG dimensions from the SOF segment, skipping earlier segments', () => {
    expect(probeImageDimensions(jpegFixture(320, 240), 'image/jpeg')).toEqual({
      width: 320,
      height: 240,
    })
  })
})
