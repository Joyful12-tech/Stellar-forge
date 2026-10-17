import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { TransactionStatus } from './TransactionStatus'
import { stellarService } from '../services/stellar'
import { trappedTransactionResult } from '../test/xdrFixtures'

vi.mock('../services/stellar', () => ({
  stellarService: { getTransaction: vi.fn() },
}))

vi.mock('../context/NetworkContext', () => ({
  useNetwork: vi.fn(() => ({ network: 'testnet' })),
}))

import { useNetwork } from '../context/NetworkContext'

describe('TransactionStatus Component', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    ;(useNetwork as Mock).mockReturnValue({ network: 'testnet' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('renders pending state initially', async () => {
    ;(stellarService.getTransaction as Mock).mockResolvedValue({ status: 'pending' })
    render(<TransactionStatus txHash="test-hash" />)
    expect(screen.getByText('Transaction pending...')).toBeInTheDocument()
  })

  test('polls and handles successful transaction', async () => {
    const onSuccess = vi.fn()
    ;(stellarService.getTransaction as Mock)
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'success' })

    render(<TransactionStatus txHash="test-hash" onSuccess={onSuccess} />)

    await act(async () => {
      await Promise.resolve()
    })

    // `onSuccess` fires from a passive effect, which React flushes *after* the
    // commit that paints "Transaction Successful". Waiting on the text alone
    // (with a non-act-wrapped waiter) can therefore return in the window where
    // the DOM has updated but the effect has not run yet — the flake that
    // turned CI red on fb3ee73. Testing Library's `waitFor` wraps each poll in
    // `act`, and asserting the callback inside the same waiter means the
    // condition is retried until the effect has actually flushed.
    await waitFor(() => {
      expect(screen.getByText('Transaction Successful')).toBeInTheDocument()
      expect(onSuccess).toHaveBeenCalled()
    })

    const link = screen.getByRole('link', { name: /view on stellar expert/i })
    expect(link).toHaveAttribute('href', 'https://stellar.expert/explorer/testnet/tx/test-hash')
  })

  test('polls and handles failed transaction', async () => {
    const onError = vi.fn()
    ;(stellarService.getTransaction as Mock).mockResolvedValue({
      status: 'error',
      error: 'Insufficient funds',
    })

    render(<TransactionStatus txHash="test-hash" onError={onError} />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Insufficient funds')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /view on stellar expert/i })
    expect(link).toHaveAttribute('href', 'https://stellar.expert/explorer/testnet/tx/test-hash')
    expect(onError).toHaveBeenCalledWith('Insufficient funds')
  })

  test('handles 60s timeout properly', async () => {
    const onError = vi.fn()
    ;(stellarService.getTransaction as Mock).mockResolvedValue({ status: 'pending' })

    render(<TransactionStatus txHash="test-hash" onError={onError} />)

    await act(async () => {
      vi.advanceTimersByTime(60000)
    })

    const link = screen.getByRole('link', { name: /view on stellar expert/i })
    expect(link).toHaveAttribute('href', 'https://stellar.expert/explorer/testnet/tx/test-hash')
  })

  /**
   * A transaction that has not landed within the polling window was still
   * accepted by the network and may yet be included. Reporting it as "failed"
   * (the old behaviour) invited the user to re-sign a transaction that could
   * execute a second time — the double-spend hazard for mint/create.
   */
  test('reports an unconfirmed transaction distinctly from a failure', async () => {
    const onError = vi.fn()
    const onUnconfirmed = vi.fn()
    ;(stellarService.getTransaction as Mock).mockResolvedValue({ status: 'pending' })

    render(
      <TransactionStatus
        txHash="test-hash"
        onError={onError}
        onUnconfirmed={onUnconfirmed}
        onRetry={vi.fn()}
      />,
    )

    // Same passive-effect ordering hazard as the success case, so the callback
    // is asserted inside the waiter rather than after it. This one drives the
    // clock by hand, so it keeps `vi.waitFor` — Testing Library's act-wrapped
    // waiter runs its own timer advancement and never lets the 60s deadline
    // land.
    await vi.waitFor(
      () => {
        vi.advanceTimersByTime(60000)
        expect(screen.getByText('Not Confirmed Yet')).toBeInTheDocument()
        expect(onUnconfirmed).toHaveBeenCalledWith(expect.stringMatching(/not been included/i))
      },
      { timeout: 5000 },
    )

    expect(screen.queryByText('Transaction Failed')).not.toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
    // No retry affordance: resubmitting could execute the call twice.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  test('offers "try again" only for a definitively failed transaction', async () => {
    const onRetry = vi.fn()
    ;(stellarService.getTransaction as Mock).mockResolvedValue({
      status: 'failed',
      error: 'Contract error',
    })

    render(<TransactionStatus txHash="test-hash" onRetry={onRetry} />)

    await vi.waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument()
    })

    screen.getByRole('button', { name: /try again/i }).click()
    expect(onRetry).toHaveBeenCalled()
  })

  /**
   * A contract-logic rejection would be rejected identically on resubmission,
   * so the button is replaced by what has to change first — otherwise the user
   * pays the network fee again for the same verdict (issue #1160).
   */
  test('withholds "try again" for a deterministic contract rejection', async () => {
    const onRetry = vi.fn()
    ;(stellarService.getTransaction as Mock).mockResolvedValue({
      status: 'failed',
      error: 'HostError: Error(Contract, 10)',
    })

    render(<TransactionStatus txHash="test-hash" onRetry={onRetry} />)

    await vi.waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument()
    })

    // The mapped message, not the raw Soroban rendering.
    expect(screen.getByText(/Contract is paused/i)).toBeInTheDocument()
    expect(screen.getByTestId('retry-requirement')).toHaveTextContent(/unpause/i)
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    expect(onRetry).not.toHaveBeenCalled()
  })

  test('decodes a failed transaction result instead of showing raw XDR', async () => {
    ;(stellarService.getTransaction as Mock).mockResolvedValue({
      status: 'failed',
      result_xdr: trappedTransactionResult().toXDR('base64'),
    })

    render(<TransactionStatus txHash="test-hash" />)

    await vi.waitFor(() => {
      expect(screen.getByText(/contract rejected the call/i)).toBeInTheDocument()
    })
  })

  test('keeps polling when the hash is not indexed yet instead of failing', async () => {
    ;(stellarService.getTransaction as Mock)
      .mockRejectedValueOnce(new Error('Transaction not found: test-hash'))
      .mockRejectedValueOnce(new Error('Transaction not found: test-hash'))
      .mockResolvedValue({ status: 'success' })

    render(<TransactionStatus txHash="test-hash" />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(screen.getByText('Transaction Successful')).toBeInTheDocument()
  })

  test('grows the poll interval instead of polling at a fixed cadence', async () => {
    ;(stellarService.getTransaction as Mock).mockResolvedValue({ status: 'pending' })
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    render(<TransactionStatus txHash="test-hash" />)

    // Let several poll/schedule cycles run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })

    // Delays passed to setTimeout for the poll chain (excludes the initial
    // synchronous call and the fixed 60s overall timeout).
    const scheduledDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1] as number)
      .filter((delay): delay is number => typeof delay === 'number' && delay > 0 && delay !== 60000)

    expect(scheduledDelays.length).toBeGreaterThan(1)
    // Fixed-cadence polling (the regression this guards against) would mean
    // every scheduled delay is identical; backoff means they are not.
    const allEqual = scheduledDelays.every((d) => d === scheduledDelays[0])
    expect(allEqual).toBe(false)

    setTimeoutSpy.mockRestore()
  })
})
