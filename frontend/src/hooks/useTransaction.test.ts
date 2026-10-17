import { renderHook, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { useTransaction, isTransactionInFlight } from './useTransaction'
import { TransactionSubmissionError } from '../services/transactionSubmission'
import { CONTRACT_ERROR_MESSAGES } from '../utils/contractErrors'

describe('useTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('starts in idle state', () => {
    const builder = vi.fn()
    const { result } = renderHook(() => useTransaction(builder))
    expect(result.current.status).toBe('idle')
    expect(result.current.result).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('transitions through statuses on success', async () => {
    const builder = vi.fn().mockImplementation(async (onStatus) => {
      onStatus('simulating')
      onStatus('signing')
      onStatus('submitting')
      return 'tx-hash-123'
    })

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.status).toBe('success')
    expect(result.current.result).toBe('tx-hash-123')
    expect(result.current.error).toBeNull()
  })

  test('sets error state on failure', async () => {
    const builder = vi.fn().mockRejectedValue(new Error('Transaction failed'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      try {
        await result.current.execute()
      } catch {
        // expected
      }
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error?.message).toBe('Transaction failed')
    expect(result.current.result).toBeNull()
  })

  test('reset clears state back to idle', async () => {
    const builder = vi.fn().mockResolvedValue('tx-hash')

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.status).toBe('success')

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.result).toBeNull()
    expect(result.current.error).toBeNull()
  })
  test('surfaces in-flight lifecycle statuses and normalises service names', async () => {
    let report: (status: string) => void = () => {}
    let finish: (value: string) => void = () => {}
    const builder = vi.fn().mockImplementation((onStatus: (s: string) => void) => {
      report = onStatus
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    })

    const { result } = renderHook(() => useTransaction(builder))

    let pending: Promise<unknown>
    act(() => {
      pending = result.current.execute()
    })

    act(() => report('submitted'))
    expect(result.current.status).toBe('submitted')
    expect(result.current.isInFlight).toBe(true)

    // TRY_AGAIN_LATER resubmission is visible to the UI rather than silently
    // looking like a stuck "pending".
    act(() => report('retrying'))
    expect(result.current.status).toBe('retrying')
    expect(result.current.isInFlight).toBe(true)

    // The service's terminal vocabulary maps onto the hook's.
    act(() => report('confirmed'))
    expect(result.current.status).toBe('success')

    await act(async () => {
      finish('tx-hash')
      await pending
    })

    expect(result.current.status).toBe('success')
    expect(result.current.failure).toBeNull()
  })

  test('a dropped transaction is safe to retry and says so', async () => {
    const builder = vi.fn().mockRejectedValue(
      new TransactionSubmissionError('dropped', 'The network was too busy…', {
        txHash: 'abc',
        attempts: 5,
      }),
    )

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.status).toBe('dropped')
    expect(result.current.failure).toEqual({
      kind: 'dropped',
      message: 'The network was too busy…',
      safeToRetry: true,
      txHash: 'abc',
    })
    expect(result.current.canRetry).toBe(true)
  })

  test('an expired transaction yields a definitive safe-to-retry signal', async () => {
    const builder = vi
      .fn()
      .mockRejectedValue(new TransactionSubmissionError('expired', 'Bounds elapsed'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.status).toBe('expired')
    expect(result.current.canRetry).toBe(true)
  })

  test('an unconfirmed transaction is never advertised as retryable', async () => {
    const builder = vi
      .fn()
      .mockRejectedValue(new TransactionSubmissionError('unconfirmed', 'Status unreadable'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.status).toBe('unconfirmed')
    expect(result.current.failure?.safeToRetry).toBe(false)
    expect(result.current.canRetry).toBe(false)
  })

  test('an included-but-failed transaction maps to the plain error status', async () => {
    const builder = vi
      .fn()
      .mockRejectedValue(new TransactionSubmissionError('failed', 'Insufficient fee payment.'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.failure?.kind).toBe('error')
  })

  /**
   * A contract-logic rejection is rolled back, so resubmitting cannot
   * double-execute — but it also cannot succeed until the on-chain condition
   * changes. Offering "try again" there just spends another network fee
   * (issue #1160).
   */
  test('a deterministic contract rejection is not offered as a retry', async () => {
    const builder = vi.fn().mockRejectedValue(
      new TransactionSubmissionError('failed', CONTRACT_ERROR_MESSAGES[10]!, {
        txHash: 'abc',
        contractErrorCode: 10,
        retryRequirement: 'An administrator has to unpause the factory…',
        deterministic: true,
      }),
    )

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.canRetry).toBe(false)
    expect(result.current.failure?.contractErrorCode).toBe(10)
    expect(result.current.failure?.retryRequirement).toMatch(/unpause/i)
  })

  test('a simulation rejected by contract logic is not offered as a retry either', async () => {
    // Pre-submission errors never reached the network, but the same call will
    // simulate the same way until the supply cap stops being exceeded.
    const builder = vi.fn().mockRejectedValue(new Error(CONTRACT_ERROR_MESSAGES[16]!))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.canRetry).toBe(false)
    expect(result.current.failure?.contractErrorCode).toBe(16)
    expect(result.current.failure?.retryRequirement).toMatch(/maximum supply/i)
  })

  test('an ordinary pre-submission error is still retryable', async () => {
    const builder = vi.fn().mockRejectedValue(new Error('Freighter is not installed'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })

    expect(result.current.canRetry).toBe(true)
    expect(result.current.failure?.retryRequirement).toBeUndefined()
  })

  test('reset clears the typed failure too', async () => {
    const builder = vi.fn().mockRejectedValue(new TransactionSubmissionError('dropped', 'dropped'))

    const { result } = renderHook(() => useTransaction(builder))

    await act(async () => {
      await result.current.execute().catch(() => undefined)
    })
    act(() => result.current.reset())

    expect(result.current.status).toBe('idle')
    expect(result.current.failure).toBeNull()
    expect(result.current.canRetry).toBe(false)
  })
})

describe('isTransactionInFlight', () => {
  test('covers every non-terminal status', () => {
    for (const status of [
      'simulating',
      'signing',
      'submitting',
      'submitted',
      'retrying',
      'polling',
    ] as const) {
      expect(isTransactionInFlight(status)).toBe(true)
    }
    for (const status of [
      'idle',
      'success',
      'error',
      'dropped',
      'expired',
      'unconfirmed',
    ] as const) {
      expect(isTransactionInFlight(status)).toBe(false)
    }
  })
})
