import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TokenExplorer } from './TokenExplorer'
import { StellarContext } from '../context/StellarContext'
import type { StellarService } from '../services/stellar'
import type { IPFSService } from '../services/ipfs'
import type { ContractEvent, TokenInfo } from '../types'

// ── Ambient context stubs (irrelevant to what these tests assert) ──────────────

vi.mock('../context/ToastContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('../context/NetworkContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNetwork: () => ({ network: 'testnet', mismatch: { isMismatch: false } }),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

vi.mock('../config/stellar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/stellar')>()
  return {
    ...actual,
    STELLAR_CONFIG: { ...actual.STELLAR_CONFIG, factoryContractId: 'CFACTORY', network: 'testnet' },
  }
})

// Hoisted so the vi.mock factories (themselves hoisted) can reference them.
const { getMetadata, fetchAllContractEvents } = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  fetchAllContractEvents: vi.fn(),
}))

vi.mock('../services/ipfs', () => ({ ipfsService: { getMetadata } }))

// The event-derived enrichment path (index → address) is mocked so we control
// exactly which addresses the index-range listing correlates to.
vi.mock('../utils/fetchAllContractEvents', () => ({ fetchAllContractEvents }))

// ── Fixtures ───────────────────────────────────────────────────────────────────

const getAllTokens = vi.fn()
const getTokenInfoByAddress = vi.fn()
// Read once on mount to pin every page window to one `tokenCount` baseline
// (#1126). It runs before the first `getAllTokens` call, so leaving it
// unmocked fails the fetch outright and every assertion below with it.
const getFactoryState = vi.fn()

const tokenAt = (index: number): TokenInfo => ({
  name: `Token ${index}`,
  symbol: `TK${index}`,
  decimals: 7,
  creator: `GCREATOR${index}`,
  createdAt: 1_700_000_000 + index,
  index,
})

const created = (ledger: number, address: string): ContractEvent => ({
  id: `created-${ledger}`,
  type: 'created',
  ledger,
  timestamp: 1_700_000_000 + ledger,
  txHash: `tx-${ledger}`,
  data: { tokenAddress: address, creator: `GCREATOR${ledger}` },
})

/** Sets the session snapshot the explorer reads on mount, and returns it. */
function snapshotTokenCount(tokenCount: number): number {
  getFactoryState.mockResolvedValue({ tokenCount })
  return tokenCount
}

function renderExplorer() {
  const value = {
    stellarService: {
      getAllTokens,
      getTokenInfoByAddress,
      getFactoryState,
    } as unknown as StellarService,
    ipfsService: { getMetadata } as unknown as IPFSService,
  }
  return render(
    <StellarContext.Provider value={value}>
      <MemoryRouter>
        <TokenExplorer />
      </MemoryRouter>
    </StellarContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getMetadata.mockResolvedValue(null)
  fetchAllContractEvents.mockResolvedValue([])
  snapshotTokenCount(0)
})

describe('TokenExplorer', () => {
  it('lists real tokens from a populated factory, newest-first, with resolved addresses', async () => {
    const snapshot = snapshotTokenCount(3)
    getAllTokens.mockResolvedValue({ tokens: [tokenAt(3), tokenAt(2), tokenAt(1)], total: 3 })
    // Creation order (ascending ledger) maps position k → 1-based index k+1.
    fetchAllContractEvents.mockResolvedValue([
      created(1, 'CADDR1'),
      created(2, 'CADDR2'),
      created(3, 'CADDR3'),
    ])

    renderExplorer()

    await waitFor(() => expect(screen.getByText('Token 3')).toBeInTheDocument())
    // First page requested from the authoritative index-range view, pinned to
    // the session snapshot rather than a fresh live count.
    expect(getAllTokens).toHaveBeenCalledWith(0, 10, snapshot)
    expect(getFactoryState).toHaveBeenCalledTimes(1)

    // Newest-first ordering and the true 1-based contract index label.
    const cards = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(cards).toEqual(['Token 3', 'Token 2', 'Token 1'])
    expect(screen.getByText('#3')).toBeInTheDocument()

    // Address enrichment via events → working detail links, newest-first.
    const links = screen.getAllByRole('link', { name: /view full details/i })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/tokens/CADDR3',
      '/tokens/CADDR2',
      '/tokens/CADDR1',
    ])
    expect(screen.getByText('All Tokens (3)')).toBeInTheDocument()
  })

  it('server-paginates: clicking Next fetches the next page by offset', async () => {
    const snapshot = snapshotTokenCount(25)
    getAllTokens.mockImplementation(async (offset = 0, limit = 10) => ({
      tokens: Array.from({ length: Math.min(limit, 25 - offset) }, (_, i) =>
        tokenAt(25 - offset - i),
      ),
      total: 25,
    }))

    renderExplorer()

    await waitFor(() => expect(screen.getByText('Token 25')).toBeInTheDocument())
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    })

    await waitFor(() => expect(getAllTokens).toHaveBeenCalledWith(10, 10, snapshot))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument())
    // The snapshot is taken once per session, not re-read per page — that is
    // the whole point of #1126.
    expect(getFactoryState).toHaveBeenCalledTimes(1)
  })

  it('renders an error state — never a fake-empty list — when the page fetch fails', async () => {
    getAllTokens.mockRejectedValue(new Error('RPC unavailable'))

    renderExplorer()

    await waitFor(() => expect(screen.getByText('Could not load tokens')).toBeInTheDocument())
    expect(screen.getByText('RPC unavailable')).toBeInTheDocument()
    // Crucially, it must NOT claim the factory is empty.
    expect(screen.queryByText('No tokens have been deployed yet')).not.toBeInTheDocument()
  })

  it('retry re-fetches after a failure and can then succeed', async () => {
    snapshotTokenCount(1)
    getAllTokens
      .mockRejectedValueOnce(new Error('RPC unavailable'))
      .mockResolvedValue({ tokens: [tokenAt(1)], total: 1 })

    renderExplorer()

    await waitFor(() => expect(screen.getByText('Could not load tokens')).toBeInTheDocument())

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    })

    await waitFor(() => expect(screen.getByText('Token 1')).toBeInTheDocument())
    expect(screen.queryByText('Could not load tokens')).not.toBeInTheDocument()
  })

  it('distinguishes an empty factory from a failure', async () => {
    getAllTokens.mockResolvedValue({ tokens: [], total: 0 })

    renderExplorer()

    await waitFor(() =>
      expect(screen.getByText('No tokens have been deployed yet')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Could not load tokens')).not.toBeInTheDocument()
    expect(screen.getByText('All Tokens (0)')).toBeInTheDocument()
  })

  it('still lists tokens when address enrichment is unavailable (no detail link)', async () => {
    snapshotTokenCount(1)
    getAllTokens.mockResolvedValue({ tokens: [tokenAt(1)], total: 1 })
    fetchAllContractEvents.mockRejectedValue(new Error('events down'))

    renderExplorer()

    await waitFor(() => expect(screen.getByText('Token 1')).toBeInTheDocument())
    // Graceful degradation: the row renders without a broken /tokens/ link.
    const cards = screen.getAllByRole('heading', { level: 4 })
    const card = cards[0]!.closest('div')!
    expect(within(card).queryByRole('link', { name: /view full details/i })).toBeNull()
  })

  it('searches by 1-based index using the already-loaded event history', async () => {
    snapshotTokenCount(2)
    getAllTokens.mockResolvedValue({ tokens: [tokenAt(2), tokenAt(1)], total: 2 })
    fetchAllContractEvents.mockResolvedValue([created(1, 'CADDR1'), created(2, 'CADDR2')])
    getTokenInfoByAddress.mockResolvedValue({ ...tokenAt(1), name: 'Found Token' })

    renderExplorer()
    await waitFor(() => expect(screen.getByText('Token 2')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Token Address or Index'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('Found Token')).toBeInTheDocument())
    expect(getTokenInfoByAddress).toHaveBeenCalledWith('CADDR1')
    // The index → address correlation comes from the history the list already
    // fetched; searching does not page through every event again.
    expect(fetchAllContractEvents).toHaveBeenCalledTimes(1)
  })

  it('reports an index with no known address as not found', async () => {
    snapshotTokenCount(2)
    getAllTokens.mockResolvedValue({ tokens: [tokenAt(2), tokenAt(1)], total: 2 })
    fetchAllContractEvents.mockResolvedValue([created(1, 'CADDR1')])

    renderExplorer()
    await waitFor(() => expect(screen.getByText('Token 2')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Token Address or Index'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(screen.getByText('Token not found at this index')).toBeInTheDocument(),
    )
    expect(getTokenInfoByAddress).not.toHaveBeenCalled()
  })
})
