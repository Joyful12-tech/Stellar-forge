import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenDetail } from '../components/TokenDetail'
import { StellarContext } from '../context/StellarContext'
import { IPFSService, MAX_METADATA_DESCRIPTION_LENGTH } from '../services/ipfs'
import type { StellarService } from '../services/stellar'
import type { TokenInfo } from '../types'

const VALID_CID = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco'
const ATTACKER_URL = 'https://evil.example.com/pixel.png'

// Ambient context TokenDetail needs but which is irrelevant to what these
// tests assert; stubbed so the component can mount without a full app tree.
vi.mock('../context/ToastContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('../context/NetworkContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNetwork: () => ({ network: 'testnet', mismatch: { isMismatch: false } }),
}))

vi.mock('../hooks/useWallet', () => ({
  useWallet: () => ({ wallet: { isConnected: false, address: null } }),
}))

const resolveTokenInfoByAddress = vi.fn()

// Must be a real, checksum-valid contract address — TokenDetail short-circuits
// to NotFound before fetching anything if isValidContractAddress fails.
const TOKEN_ADDRESS = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE'

// TokenDetail resolves its services from StellarContext, not from a module
// import — mocking '../services/stellar' would never bind. Supply the context
// directly with a stub service plus a real IPFSService, whose gateway fetch is
// stubbed through global fetch below.
function renderTokenDetail(address = TOKEN_ADDRESS) {
  const value = {
    stellarService: { resolveTokenInfoByAddress } as unknown as StellarService,
    ipfsService: new IPFSService(),
  }

  return render(
    <StellarContext.Provider value={value}>
      <MemoryRouter initialEntries={[`/tokens/${address}`]}>
        <Routes>
          <Route path="/tokens/:address" element={<TokenDetail />} />
        </Routes>
      </MemoryRouter>
    </StellarContext.Provider>,
  )
}

const tokenInfo = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  name: 'TestToken',
  symbol: 'TST',
  decimals: 7,
  creator: 'GCREATOR000000000000000000000000000000000000000000000',
  createdAt: 1_700_000_000,
  metadataUri: `ipfs://${VALID_CID}`,
  ...overrides,
})

/** Stub the IPFS gateway response that TokenDetail fetches metadata from. */
const mockPinnedMetadata = (metadata: Record<string, unknown>) => {
  const raw = JSON.stringify(metadata)
  resolveTokenInfoByAddress.mockResolvedValue({
    status: 'resolved',
    ...tokenInfo({ metadataUri: 'ipfs://QmTestCID' }),
  })

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // getMetadata reads text() so it can size-check before parsing.
      text: async () => raw,
    } as unknown as Response),
  )
}

describe('TokenDetail — untrusted metadata rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveTokenInfoByAddress.mockResolvedValue({ status: 'resolved', ...tokenInfo() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discards pinned metadata with a non-IPFS image entirely, never rendering the attacker URL', async () => {
    mockPinnedMetadata({
      name: 'EvilToken',
      description: 'desc',
      image: ATTACKER_URL,
    })

    renderTokenDetail()

    // The document is rejected at parse time (getMetadata), so no metadata
    // card — and therefore no <img> — renders at all.
    await screen.findByText('TestToken')
    await waitFor(() => {
      expect(screen.queryByRole('img')).toBeNull()
    })
    expect(screen.queryByText('EvilToken')).toBeNull()
    expect(document.querySelector(`img[src="${ATTACKER_URL}"]`)).toBeNull()
  })

  it('renders the real image when metadata has a well-formed ipfs:// image', async () => {
    mockPinnedMetadata({
      name: 'GoodToken',
      description: 'desc',
      image: `ipfs://${VALID_CID}`,
    })

    renderTokenDetail()

    const img = await screen.findByRole('img', { name: 'GoodToken' })
    await waitFor(() => {
      expect(img.getAttribute('src')).toBe(`https://gateway.pinata.cloud/ipfs/${VALID_CID}`)
    })
  })

  it('bounds a huge description instead of rendering it in full', async () => {
    // Layout-DoS shape from #926: a wall of text engineered to freeze the tab
    // or push content below the fold. Two independent bounds should apply —
    // the data-layer clamp in getMetadata, and the CSS line-clamp on render.
    // Sized under the 100KB whole-document cap so this exercises the
    // truncation path, not the outright-rejection path.
    const pinnedLength = 40_000
    mockPinnedMetadata({
      name: 'SpamToken',
      description: 'A'.repeat(pinnedLength),
      image: `ipfs://${VALID_CID}`,
    })

    renderTokenDetail()

    const para = await screen.findByText(/^A+…$/)

    // Data layer: clamped well below what was pinned.
    expect(para.textContent!.length).toBeLessThanOrEqual(MAX_METADATA_DESCRIPTION_LENGTH + 1)
    expect(para.textContent!.length).toBeLessThan(pinnedLength)

    // Render layer: bounded box regardless of character count.
    expect(para.className).toMatch(/line-clamp-\d/)
  })

  it('renders a <script>-containing description as inert text, not executed markup', async () => {
    mockPinnedMetadata({
      name: 'Token',
      description: '<script>window.__pwned = true</script>',
      image: `ipfs://${VALID_CID}`,
    })

    renderTokenDetail()

    await waitFor(() => {
      expect(screen.getByText('<script>window.__pwned = true</script>')).toBeInTheDocument()
    })
    expect(document.body.querySelectorAll('script').length).toBe(0)
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
