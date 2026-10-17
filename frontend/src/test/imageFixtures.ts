// Test-only File fixtures whose leading bytes are real image signatures, so
// they pass (or deliberately fail) content-based validation.

export const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0]
export const GIF_HEADER = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a

export function makeImageFile(header: number[], name: string, type: string, size = 1024): File {
  const bytes = new Uint8Array(Math.max(size, header.length))
  bytes.set(header)
  return new File([bytes], name, { type })
}

/** A file whose content is arbitrary text, with any declared type. */
export function makeTextFile(content: string, name: string, type: string): File {
  return new File([content], name, { type })
}
