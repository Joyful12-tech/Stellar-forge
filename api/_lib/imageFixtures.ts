/**
 * Test-only builders for minimal image byte fixtures with real, parseable
 * headers. No pixel data — just enough structure for signature sniffing and
 * header-based dimension probing.
 */

export function pngFixture(width = 64, height = 64): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25) // length(4) + "IHDR"(4) + data(13) + crc(4)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8 // bit depth
  ihdr[17] = 6 // color type RGBA
  return Buffer.concat([signature, ihdr])
}

export function gifFixture(width = 64, height = 64, version = '89a'): Buffer {
  const buf = Buffer.alloc(13)
  buf.write(`GIF${version}`, 0, 'ascii')
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return buf
}

export function jpegFixture(width = 64, height = 64): Buffer {
  const soi = Buffer.from([0xff, 0xd8])
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14).fill(0x4a)])
  const sof0 = Buffer.alloc(13)
  sof0[0] = 0xff
  sof0[1] = 0xc0
  sof0.writeUInt16BE(11, 2) // segment length
  sof0[4] = 8 // precision
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  sof0[9] = 3 // components
  const eoi = Buffer.from([0xff, 0xd9])
  return Buffer.concat([soi, app0, sof0, eoi])
}
