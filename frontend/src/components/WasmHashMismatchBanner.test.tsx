import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WasmHashMismatchBanner } from './WasmHashMismatchBanner'
import { useFactoryState } from '../hooks/useFactoryState'
import type { FactoryState } from '../types'

vi.mock('../hooks/useFactoryState', () => ({
  useFactoryState: vi.fn(),
}))

// The banner reads the expected hash from ENV, which snapshots
// import.meta.env at module load — stub it before importing config/env.
const EXPECTED_HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)

vi.mock('../config/env', () => ({
  ENV: {
    network: 'testnet',
    factoryContractId: 'CFACTORY',
    tokenWasmHash: 'a'.repeat(64),
  },
  isFactoryConfigured: () => true,
}))

const mockRefetch = vi.fn()
const mockUseFactoryState = vi.mocked(useFactoryState)

const baseState: FactoryState = {
  admin: 'GADMIN123456789',
  treasury: 'GTREASURY123456789',
  baseFee: '10000000',
  metadataFee: '5000000',
  tokenCount: 3,
  paused: false,
  whitelistEnabled: false,
}

const mockState = (state: FactoryState | null, overrides = {}) => {
  mockUseFactoryState.mockReturnValue({
    state,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
    ...overrides,
  })
}

describe('WasmHashMismatchBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a warning when the on-chain hash differs from the configured hash', () => {
    mockState({ ...baseState, tokenWasmHash: OTHER_HASH })

    render(<WasmHashMismatchBanner />)

    const banner = screen.getByTestId('wasm-hash-mismatch-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'alert')
    expect(screen.getByText(/Token contract mismatch/i)).toBeInTheDocument()
  })

  it('shows both the expected and on-chain hashes so the drift is diagnosable', () => {
    mockState({ ...baseState, tokenWasmHash: OTHER_HASH })

    render(<WasmHashMismatchBanner />)

    // Hashes are truncated for display; assert on the visible prefixes.
    const banner = screen.getByTestId('wasm-hash-mismatch-banner')
    expect(banner).toHaveTextContent(EXPECTED_HASH.slice(0, 10))
    expect(banner).toHaveTextContent(OTHER_HASH.slice(0, 10))
  })

  it('renders nothing when the hashes match', () => {
    mockState({ ...baseState, tokenWasmHash: EXPECTED_HASH })

    render(<WasmHashMismatchBanner />)

    expect(screen.queryByTestId('wasm-hash-mismatch-banner')).not.toBeInTheDocument()
  })

  it('treats casing and a 0x prefix as equivalent rather than as drift', () => {
    mockState({ ...baseState, tokenWasmHash: `0x${EXPECTED_HASH.toUpperCase()}` })

    render(<WasmHashMismatchBanner />)

    expect(screen.queryByTestId('wasm-hash-mismatch-banner')).not.toBeInTheDocument()
  })

  it('stays silent while the factory state is still loading', () => {
    mockState(null, { isLoading: true })

    render(<WasmHashMismatchBanner />)

    expect(screen.queryByTestId('wasm-hash-mismatch-banner')).not.toBeInTheDocument()
  })

  it('stays silent when the factory read failed — an inconclusive check is not a mismatch', () => {
    mockState(null, { error: new Error('RPC unreachable') })

    render(<WasmHashMismatchBanner />)

    expect(screen.queryByTestId('wasm-hash-mismatch-banner')).not.toBeInTheDocument()
  })

  it('stays silent when the contract state has no token_wasm_hash field', () => {
    mockState({ ...baseState, tokenWasmHash: undefined })

    render(<WasmHashMismatchBanner />)

    expect(screen.queryByTestId('wasm-hash-mismatch-banner')).not.toBeInTheDocument()
  })

  it('re-checks the factory state when the Re-check button is pressed', async () => {
    const user = userEvent.setup()
    mockState({ ...baseState, tokenWasmHash: OTHER_HASH })

    render(<WasmHashMismatchBanner />)
    await user.click(screen.getByRole('button', { name: /re-check token wasm hash/i }))

    expect(mockRefetch).toHaveBeenCalled()
  })
})
