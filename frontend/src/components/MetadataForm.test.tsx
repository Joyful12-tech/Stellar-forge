import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TosProvider } from '../context/TosContext'
import { MetadataForm } from './MetadataForm'
import { makeImageFile, PNG_HEADER } from '../test/imageFixtures'

vi.mock('../context/StellarContext', () => ({
  useStellarContext: () => ({
    ipfsService: { uploadMetadata: vi.fn() },
    stellarService: { setMetadata: vi.fn() },
  }),
}))

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('../context/NetworkContext', () => ({
  useNetwork: () => ({ network: 'testnet', mismatch: { isMismatch: false } }),
}))

vi.mock('../hooks/useFactoryState', () => ({
  useFactoryState: () => ({ state: { metadataFee: '100000' } }),
}))

vi.mock('../hooks/useBalanceCheck', () => ({
  useBalanceCheck: () => ({ hasSufficientBalance: true, shortfall: 0, isTestnet: true }),
}))

// MetadataForm now reads the connected wallet for upload auth; supply one.
vi.mock('../context/WalletContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../context/WalletContext')>()),
  useWalletContext: () => ({
    wallet: { address: 'GTESTWALLETADDRESS', isConnected: true, balance: undefined },
    isConnecting: false,
    error: null,
    isInstalled: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refreshBalance: vi.fn(),
  }),
}))

// Upload availability is server state now, not build config: the form asks
// GET /api/health/ipfs via useIpfsReady().
vi.mock('../hooks/useIpfsReady', () => ({
  useIpfsReady: () => 'ready',
}))

const renderMetadataForm = () =>
  render(
    <TosProvider>
      <MetadataForm />
    </TosProvider>,
  )

describe('MetadataForm ToS gate', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('requires accepting the terms before showing the on-chain metadata confirmation', async () => {
    const { container } = renderMetadataForm()

    fireEvent.change(screen.getByLabelText(/token address/i), {
      target: { value: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    })

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput!, {
      target: {
        // Content-based validation now runs on selection, so the fixture
        // needs a real PNG signature.
        files: [makeImageFile(PNG_HEADER, 'token.png', 'image/png')],
      },
    })

    // Selection is validated asynchronously; wait for the accepted preview.
    await waitFor(() => expect(screen.getByAltText(/token preview/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /set metadata/i }))

    expect(screen.getByRole('dialog', { name: /terms of service/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /confirm set metadata/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/accept the terms/i))
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(screen.getByRole('dialog', { name: /confirm set metadata/i })).toBeInTheDocument()
  })
})
