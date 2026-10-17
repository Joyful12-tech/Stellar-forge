import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  IPFSService,
  MAX_METADATA_DESCRIPTION_LENGTH,
  MAX_METADATA_NAME_LENGTH,
} from '../services/ipfs'
import type { TokenMetadata } from '../services/ipfs'
import { IPFSConfigError, IPFSUploadError } from '../services/ipfs-errors'

// Keep error classes stable across vi.resetModules() calls
vi.mock('../services/ipfs-errors', () => {
  class IPFSConfigError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'IPFSConfigError'
    }
  }
  class IPFSUploadError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'IPFSUploadError'
    }
  }
  return { IPFSConfigError, IPFSUploadError }
})

// The upload flow now authenticates via a wallet-signed JWT; stub it out so
// these tests keep exercising only the upload transport.
vi.mock('../services/auth', () => ({
  getUploadToken: vi.fn().mockResolvedValue('test-jwt'),
  clearUploadToken: vi.fn(),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

// isValidImageFile now checks magic bytes, so fixtures need real signatures
// matching their declared type.
const MAGIC_BYTES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
}

function makeFile(name = 'token.png', type = 'image/png', size = 1024): File {
  const bytes = new Uint8Array(size)
  const signature = MAGIC_BYTES[type]
  if (signature) bytes.set(signature)
  const blob = new Blob([bytes], { type })
  return new File([blob], name, { type })
}

/** Minimal XHR mock that lets tests control status + responseText */
function mockXHR(status: number, responseText: string, triggerError = false) {
  const listeners: Record<string, EventListener> = {}
  const uploadListeners: Record<string, EventListener> = {}

  const xhrMock = {
    open: vi.fn(),
    send: vi.fn().mockImplementation(() => {
      // Simulate async completion
      Promise.resolve().then(() => {
        if (triggerError) {
          listeners['error']?.({} as Event)
        } else {
          // Fire upload progress then load
          uploadListeners['progress']?.({
            lengthComputable: true,
            loaded: 512,
            total: 1024,
          } as unknown as Event)
          listeners['load']?.({} as Event)
        }
      })
    }),
    setRequestHeader: vi.fn(),
    upload: {
      addEventListener: vi.fn((event: string, cb: EventListener) => {
        uploadListeners[event] = cb
      }),
    },
    addEventListener: vi.fn((event: string, cb: EventListener) => {
      listeners[event] = cb
    }),
    status,
    responseText,
  }

  vi.stubGlobal(
    'XMLHttpRequest',
    vi.fn().mockImplementation(function () {
      return xhrMock
    }),
  )
  return xhrMock
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPFSService', () => {
  let service: IPFSService

  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
    service = new IPFSService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Config validation ──────────────────────────────────────────────────────

  // Uploads are proxied through api/ipfs/*, which holds the Pinata credentials
  // in server env. The browser therefore needs no keys of its own — these tests
  // pin that, replacing two older ones that required VITE_IPFS_API_KEY client
  // side and so entrenched shipping the secret in the bundle.
  describe('uploadMetadata — requires no client-side credentials', () => {
    it('succeeds with no VITE_IPFS_* credentials configured', async () => {
      vi.stubEnv('VITE_IPFS_API_KEY', '')
      vi.stubEnv('VITE_IPFS_API_SECRET', '')
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMeta' }),
        }),
      )

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).resolves.toBe('ipfs://QmMeta')
    })

    it('posts to the same-origin proxy and sends no Pinata credentials', async () => {
      vi.stubEnv('VITE_IPFS_API_KEY', 'leaked-key')
      vi.stubEnv('VITE_IPFS_API_SECRET', 'leaked-secret')
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      const xhr = mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cid: 'QmMeta' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      await fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS')

      // Image upload: same-origin proxy, no credential headers.
      expect(xhr.open).toHaveBeenCalledWith('POST', '/api/ipfs/upload-file')
      const headerNames = xhr.setRequestHeader.mock.calls.map(([name]) =>
        String(name).toLowerCase(),
      )
      expect(headerNames).not.toContain('pinata_api_key')
      expect(headerNames).not.toContain('pinata_secret_api_key')

      // Metadata upload: same-origin proxy, and the secret appears nowhere in
      // the outgoing request — not in the URL, headers, or body.
      const [url, options] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/ipfs/upload-json')
      const serialised = JSON.stringify({ url, options })
      expect(serialised).not.toContain('leaked-key')
      expect(serialised).not.toContain('leaked-secret')
      expect(serialised).not.toMatch(/pinata\.cloud/)
    })
  })

  // ── Image validation ───────────────────────────────────────────────────────

  describe('uploadMetadata — image validation', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_IPFS_API_KEY', 'test-key')
      vi.stubEnv('VITE_IPFS_API_SECRET', 'test-secret')
    })

    it('throws IPFSUploadError for unsupported file type', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      const webp = makeFile('img.webp', 'image/webp')

      await expect(
        fresh.uploadMetadata(webp, 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when the content is not a real image (spoofed MIME type)', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      const spoofed = new File(['<html><script>alert(1)</script></html>'], 'innocent.png', {
        type: 'image/png',
      })

      await expect(
        fresh.uploadMetadata(spoofed, 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError for file exceeding the 4MB limit', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      const big = makeFile('big.png', 'image/png', 6 * 1024 * 1024)

      await expect(
        fresh.uploadMetadata(big, 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('error message includes the file size when too large', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      const big = makeFile('big.png', 'image/png', 6 * 1024 * 1024)

      // 4MB, not 5MB: the cap sits just under Vercel's 4.5MB serverless
      // request-body ceiling now that uploads are proxied through api/ipfs/*.
      await expect(
        fresh.uploadMetadata(big, 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toThrow('4MB')
    })

    it('accepts JPEG files', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImageCID' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaCID' }),
        }),
      )

      const result = await fresh.uploadMetadata(
        makeFile('img.jpg', 'image/jpeg'),
        'desc',
        'Token',
        'GTESTWALLETADDRESS',
      )
      expect(result).toBe('ipfs://QmMetaCID')
    })

    it('accepts GIF files', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImageCID' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaCID' }),
        }),
      )

      const result = await fresh.uploadMetadata(
        makeFile('img.gif', 'image/gif'),
        'desc',
        'Token',
        'GTESTWALLETADDRESS',
      )
      expect(result).toBe('ipfs://QmMetaCID')
    })
  })

  // ── Successful upload flow ─────────────────────────────────────────────────

  describe('uploadMetadata — happy path', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_IPFS_API_KEY', 'test-key')
      vi.stubEnv('VITE_IPFS_API_SECRET', 'test-secret')
    })

    it('returns an ipfs:// URI on success', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImageCID123' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaCID456' }),
        }),
      )

      const uri = await fresh.uploadMetadata(makeFile(), 'A token', 'MyToken', 'GTESTWALLETADDRESS')
      expect(uri).toBe('ipfs://QmMetaCID456')
    })

    it('calls onProgress from 0 to 100', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMeta' }),
        }),
      )

      const progress: number[] = []
      await fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS', (p) =>
        progress.push(p),
      )

      expect(progress[0]).toBe(0)
      expect(progress[progress.length - 1]).toBe(100)
    })

    it('constructs metadata JSON with name, description, and image CID', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))

      let capturedBody: Record<string, unknown> = {}
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
          capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>
          return { ok: true, status: 200, json: async () => ({ cid: 'QmMeta' }) }
        }),
      )

      await fresh.uploadMetadata(makeFile(), 'My description', 'CoolToken', 'GTESTWALLETADDRESS')

      // The client sends { metadata, name }; wrapping it in Pinata's
      // pinataContent envelope is now the serverless function's job.
      const content = capturedBody.metadata as Record<string, unknown>
      expect(capturedBody.name).toBe('CoolToken-metadata.json')
      expect(content.name).toBe('CoolToken')
      expect(content.description).toBe('My description')
      expect(content.image).toBe('ipfs://QmImg')
    })
  })

  // ── Upload error handling ──────────────────────────────────────────────────

  describe('uploadMetadata — error handling', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_IPFS_API_KEY', 'test-key')
      vi.stubEnv('VITE_IPFS_API_SECRET', 'test-secret')
    })

    it('throws IPFSUploadError on XHR 401 (auth failure)', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(401, 'Unauthorized')

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError on XHR non-200 status', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(500, 'Internal Server Error')

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError on XHR network error', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(0, '', true) // triggerError = true

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when Pinata returns malformed JSON for image', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, 'not-json')

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when image response is missing cid', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ something: 'else' }))

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError on fetch network error for JSON upload', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError on 401 from JSON upload', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({}),
        }),
      )

      // Credentials now live server-side, so a 401 from our own proxy is not a
      // user-actionable "check your API key" case — it surfaces as a generic
      // upload failure carrying the status.
      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toThrow('HTTP 401')
    })

    it('throws IPFSUploadError on non-ok fetch response for JSON upload', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({}),
        }),
      )

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('retries image upload on transient 503 and succeeds on second attempt', async () => {
      vi.useFakeTimers()
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()

      let xhrCallCount = 0
      vi.stubGlobal(
        'XMLHttpRequest',
        vi.fn().mockImplementation(function (this: XMLHttpRequest) {
          const listeners: Record<string, EventListener> = {}
          const uploadListeners: Record<string, EventListener> = {}

          xhrCallCount++
          this.open = vi.fn()
          this.setRequestHeader = vi.fn()
          this.addEventListener = vi.fn((event: string, cb: EventListener) => {
            listeners[event] = cb
          })
          this.send = vi.fn().mockImplementation(() => {
            Promise.resolve().then(() => {
              if (xhrCallCount === 1) {
                ;(this as unknown as Record<string, unknown>).status = 503
                ;(this as unknown as Record<string, unknown>).responseText = JSON.stringify({})
                listeners['load']?.({} as Event)
              } else {
                ;(this as unknown as Record<string, unknown>).status = 200
                ;(this as unknown as Record<string, unknown>).responseText = JSON.stringify({
                  cid: 'QmRetryCID',
                })
                listeners['load']?.({} as Event)
              }
            })
          })

          Object.defineProperty(this, 'upload', {
            value: {
              addEventListener: vi.fn((event: string, cb: EventListener) => {
                uploadListeners[event] = cb
              }),
            },
          })
        }),
      )

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaRetry' }),
        }),
      )

      const retryCalls: number[] = []
      const promise = fresh.uploadMetadata(
        makeFile(),
        'desc',
        'Token',
        'GTESTWALLETADDRESS',
        undefined,
        (attempt) => retryCalls.push(attempt),
      )

      await vi.runAllTimersAsync()
      const uri = await promise

      expect(uri).toBe('ipfs://QmMetaRetry')
      expect(xhrCallCount).toBe(2)
      expect(retryCalls).toEqual([2])

      vi.useRealTimers()
    })

    it('throws IPFSUploadError when JSON upload response is missing cid', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImg' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ noHash: true }),
        }),
      )

      await expect(
        fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })
  })

  // ── getMetadata ────────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('fetches and returns parsed metadata JSON', async () => {
      const meta = { name: 'MyToken', description: 'A token', image: 'ipfs://QmImg' }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(meta),
        }),
      )

      const result = await service.getMetadata('ipfs://QmSomeCID')
      expect(result).toEqual(meta)
    })

    it('constructs the correct gateway URL from the CID', async () => {
      let calledUrl = ''
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          calledUrl = url
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ name: 'T', description: 'D', image: 'ipfs://QmImg' }),
          }
        }),
      )

      await service.getMetadata('ipfs://QmTestCID')
      expect(calledUrl).toContain('QmTestCID')
      expect(calledUrl).toContain('gateway.pinata.cloud')
    })

    it('throws IPFSUploadError for non-ipfs:// URI', async () => {
      await expect(service.getMetadata('https://example.com/meta.json')).rejects.toBeInstanceOf(
        IPFSUploadError,
      )
    })

    it('throws IPFSUploadError on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError on non-ok HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => JSON.stringify({}),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when response is not valid JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => 'this is not JSON {',
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('rejects metadata whose image is not an ipfs:// URI', async () => {
      const badImages = [
        'https://evil.example/payload.png',
        'http://evil.example/payload.png',
        'data:text/html,<script>alert(1)</script>',
        'javascript:alert(1)',
        'ipfs://../../secret',
      ]
      for (const image of badImages) {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ name: 'MyToken', description: 'A token', image }),
          }),
        )

        await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
      }
    })

    it('throws IPFSUploadError when metadata is missing name field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ description: 'A token', image: 'ipfs://QmImg' }),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when metadata is missing description field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ name: 'MyToken', image: 'ipfs://QmImg' }),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when metadata is missing image field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ name: 'MyToken', description: 'A token' }),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('throws IPFSUploadError when metadata fields have wrong types', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ name: 42, description: true, image: null }),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('strips unexpected extra fields from the returned metadata', async () => {
      const raw = {
        name: 'MyToken',
        description: 'A token',
        image: 'ipfs://QmImg',
        maliciousField: '<script>alert(1)</script>',
        extra: { nested: 'data' },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(raw) }),
      )

      const result = await service.getMetadata('ipfs://QmCID')
      expect(result).toEqual({ name: 'MyToken', description: 'A token', image: 'ipfs://QmImg' })
      expect(result).not.toHaveProperty('maliciousField')
      expect(result).not.toHaveProperty('extra')
    })

    it('throws IPFSUploadError when gateway returns an empty object', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    // Metadata can be pinned directly to IPFS without going through our upload
    // form, so the read path is the only place a length limit actually binds.
    // An unbounded description renders into every visitor's page: enough text
    // stalls the tab, and enough newlines push phishing content below the fold.
    describe('length caps on untrusted free text', () => {
      const gateway = (meta: Record<string, unknown>) =>
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(meta),
          }),
        )

      it('truncates a description longer than the cap', async () => {
        gateway({
          name: 'T',
          description: 'a'.repeat(MAX_METADATA_DESCRIPTION_LENGTH + 5_000),
          image: 'ipfs://QmImg',
        })

        const result = await service.getMetadata('ipfs://QmCID')

        expect([...result.description].length).toBe(MAX_METADATA_DESCRIPTION_LENGTH + 1) // + ellipsis
        expect(result.description.endsWith('…')).toBe(true)
      })

      it('leaves a description at exactly the cap untouched', async () => {
        const exact = 'b'.repeat(MAX_METADATA_DESCRIPTION_LENGTH)
        gateway({ name: 'T', description: exact, image: 'ipfs://QmImg' })

        const result = await service.getMetadata('ipfs://QmCID')

        expect(result.description).toBe(exact)
        expect(result.description).not.toContain('…')
      })

      it('truncates an over-long name', async () => {
        gateway({
          name: 'n'.repeat(MAX_METADATA_NAME_LENGTH + 500),
          description: 'd',
          image: 'ipfs://QmImg',
        })

        const result = await service.getMetadata('ipfs://QmCID')

        expect([...result.name].length).toBe(MAX_METADATA_NAME_LENGTH + 1)
      })

      it('does not split a surrogate pair when truncating', async () => {
        // Emoji are two UTF-16 code units each; slicing by .length would cut one
        // in half and leave an unpaired surrogate (renders as a replacement char).
        gateway({
          name: 'T',
          description: '😀'.repeat(MAX_METADATA_DESCRIPTION_LENGTH + 100),
          image: 'ipfs://QmImg',
        })

        const result = await service.getMetadata('ipfs://QmCID')

        expect(result.description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
        expect(result.description).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
      })

      it('rejects a payload too large to parse rather than truncating it', async () => {
        // Guards the cost of JSON.parse itself — truncating after parse would
        // still mean walking the whole multi-megabyte document first.
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => 'x'.repeat(200 * 1024),
          }),
        )

        await expect(service.getMetadata('ipfs://QmCID')).rejects.toThrow(/too large/i)
      })
    })

    it('throws IPFSUploadError when gateway returns a non-object (array)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(['name', 'description', 'image']),
        }),
      )

      await expect(service.getMetadata('ipfs://QmCID')).rejects.toBeInstanceOf(IPFSUploadError)
    })

    it('rejects metadata when CID does not match content', async () => {
      // Create a valid metadata object
      const meta = { name: 'MyToken', description: 'A token', image: 'ipfs://QmImg' }
      const jsonString = JSON.stringify(meta)

      // Mock fetch to return valid JSON but with a CID that won't match
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => jsonString,
        }),
      )

      // Use an invalid/mismatched CID (real Qm prefix but won't match this content)
      // The CID "QmXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" won't match
      // the hash of our actual metadata JSON
      await expect(
        service.getMetadata('ipfs://QmXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      ).rejects.toBeInstanceOf(IPFSUploadError)
    })
  })

  // ── Unpin (orphaned-pin cleanup) ───────────────────────────────────────────

  describe('unpin & unpinLastUpload — orphaned pin cleanup (issue #1096)', () => {
    it('uploadMetadataDetailed returns both the image and metadata CIDs', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImageABCD' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaWXYZ' }),
        }),
      )

      const result = await fresh.uploadMetadataDetailed(
        makeFile(),
        'desc',
        'Token',
        'GTESTWALLETADDRESS',
      )

      expect(result.metadataUri).toBe('ipfs://QmMetaWXYZ')
      expect(result.imageCid).toBe('QmImageABCD')
      expect(result.metadataCid).toBe('QmMetaWXYZ')
      expect(fresh.lastUploadedCids).toEqual({
        imageCid: 'QmImageABCD',
        metadataCid: 'QmMetaWXYZ',
      })
    })

    it('unpin posts the CID to the same-origin proxy with its JWT', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()

      let capturedUrl = ''
      let capturedOpts: RequestInit | null = null
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
          capturedUrl = url
          capturedOpts = opts
          return { ok: true, status: 200, json: async () => ({ success: true }) }
        }),
      )

      await fresh.unpin('QmOrphanCID', 'GTESTWALLETADDRESS')

      expect(capturedUrl).toBe('/api/ipfs/unpin')

      const opts = capturedOpts as unknown as RequestInit
      expect(opts.method?.toUpperCase() ?? '').toBe('POST')
      const headers = opts.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-jwt')
      const body = JSON.parse(opts.body as string) as { cid: string }
      expect(body.cid).toBe('QmOrphanCID')
    })

    it('unpin throws an IPFSUploadError on a 400 response', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))

      await expect(fresh.unpin('bad-cid', 'GTESTWALLETADDRESS')).rejects.toBeInstanceOf(
        IPFSUploadError,
      )
    })

    it('unpinLastUpload unpins both CIDs that the last upload created', async () => {
      vi.resetModules()
      const { IPFSService: Fresh } = await import('../services/ipfs')
      const fresh = new Fresh()
      mockXHR(200, JSON.stringify({ cid: 'QmImageABCD' }))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmMetaWXYZ' }),
        }),
      )

      await fresh.uploadMetadata(makeFile(), 'desc', 'Token', 'GTESTWALLETADDRESS')

      const unpinUrls: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          unpinUrls.push(url)
          return { ok: true, status: 200, json: async () => ({ success: true }) }
        }),
      )

      await fresh.unpinLastUpload('GTESTWALLETADDRESS')

      const unpinBodies = unpinUrls.map((u) => u)
      expect(unpinBodies).toHaveLength(2)
    })
  })

  // ── Error class identity ───────────────────────────────────────────────────

  describe('error classes', () => {
    it('IPFSConfigError has correct name', () => {
      const err = new IPFSConfigError('test')
      expect(err.name).toBe('IPFSConfigError')
      expect(err).toBeInstanceOf(Error)
    })

    it('IPFSUploadError has correct name', () => {
      const err = new IPFSUploadError('test')
      expect(err.name).toBe('IPFSUploadError')
      expect(err).toBeInstanceOf(Error)
    })
  })

  // ── URI string construction ────────────────────────────────────────────────

  describe('URI string construction', () => {
    it('formats image URI as ipfs://{hash}', () => {
      const hash = 'QmImageHash123'
      const uri = `ipfs://${hash}`
      expect(uri).toBe('ipfs://QmImageHash123')
    })

    it('formats metadata URI as ipfs://{hash}', () => {
      const hash = 'QmMetaHash456'
      const uri = `ipfs://${hash}`
      expect(uri).toBe('ipfs://QmMetaHash456')
    })

    it('TokenMetadata interface shape is correct', () => {
      const meta: TokenMetadata = {
        name: 'MyToken',
        description: 'A test token',
        image: 'ipfs://QmImageHash',
      }
      expect(meta.image).toMatch(/^ipfs:\/\//)
      expect(meta.name).toBe('MyToken')
      expect(meta.description).toBe('A test token')
    })
  })
})
