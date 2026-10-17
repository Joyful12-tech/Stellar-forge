import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Network } from '../config/stellar'
import { NetworkGuardAlert } from './NetworkGuardAlert'
import type { NetworkGuard } from '../hooks/useNetworkGuard'

let currentNetwork: Network = 'testnet'
vi.mock('../context/NetworkContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNetwork: () => ({ network: currentNetwork, mismatch: { isMismatch: false } }),
}))

function guard(overrides: Partial<NetworkGuard> = {}): NetworkGuard {
  return {
    blocked: true,
    reason: 'Switch Freighter to Testnet to continue.',
    networkChangedSinceMount: false,
    acknowledgeNetworkChange: vi.fn(),
    ...overrides,
  }
}

describe('NetworkGuardAlert', () => {
  beforeEach(() => {
    currentNetwork = 'testnet'
  })

  it('renders nothing when the form is not blocked', () => {
    const { container } = render(<NetworkGuardAlert guard={guard({ blocked: false })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the reason without an acknowledgement on a Freighter mismatch', () => {
    render(<NetworkGuardAlert guard={guard()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Switch Freighter to Testnet')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers the acknowledgement after a network change and calls it', () => {
    const g = guard({ networkChangedSinceMount: true })
    render(<NetworkGuardAlert guard={g} />)
    fireEvent.click(screen.getByRole('button', { name: /continue on Testnet/ }))
    expect(g.acknowledgeNetworkChange).toHaveBeenCalledOnce()
  })

  it('names standalone correctly rather than calling it Testnet', () => {
    currentNetwork = 'standalone'
    render(<NetworkGuardAlert guard={guard({ networkChangedSinceMount: true })} />)
    expect(screen.getByRole('button')).toHaveTextContent('continue on Standalone')
  })
})
