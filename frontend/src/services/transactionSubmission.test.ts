/**
 * Unit tests for every documented `sendTransaction` status and every polling
 * verdict, with mocked RPC responses.
 *
 * The regression these pin down: only `ERROR` used to be treated as a failure,
 * so `TRY_AGAIN_LATER` (envelope dropped before the mempool) fell through to
 * hash-polling and burned the entire backoff schedule before reporting a
 * generic timeout — leaving the UI unable to tell "never submitted" from
 * "submitted, still unconfirmed". The latter is what makes a naive retry a
 * real-funds hazard for create_token / mint_tokens.
 *
 * `sleep` is injected everywhere so the backoff schedule is exercised without
 * real timers.
 */

import { describe, it, expect, vi } from 'vitest'
import { rpc } from 'stellar-sdk'
import {
  awaitTransactionInclusion,
  inclusionDeadlineOf,
  sendSignedTransaction,
  submitAndConfirm,
  TransactionSubmissionError,
  type TransactionLifecycleStatus,
  type TransactionRpc,
} from './transactionSubmission'
import type { Transaction, FeeBumpTransaction } from 'stellar-sdk'
import { CONTRACT_ERROR_MESSAGES } from '../utils/contractErrors'
import {
  contractErrorDiagnosticEvent,
  roundTripEvent,
  roundTripResult,
  trappedTransactionResult,
} from '../test/xdrFixtures'

const HASH = 'a'.repeat(64)

/** Base64/XDR text must never reach the user as an error message. */
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/

// ── Response builders ─────────────────────────────────────────────────────────

type SendStatus = 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR'

function sendResponse(status: SendStatus, overrides: Record<string, unknown> = {}) {
  return {
    status,
    hash: HASH,
    latestLedger: 100,
    latestLedgerCloseTime: 1_700_000_000,
    ...overrides,
  } as unknown as rpc.Api.SendTransactionResponse
}

function notFound(latestLedger = 100, latestLedgerCloseTime = 1_700_000_000) {
  return {
    status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    txHash: HASH,
    latestLedger,
    latestLedgerCloseTime,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1_600_000_000,
  } as unknown as rpc.Api.GetTransactionResponse
}

function success() {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    txHash: HASH,
    latestLedger: 105,
    latestLedgerCloseTime: 1_700_000_050,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1_600_000_000,
    ledger: 104,
    returnValue: undefined,
  } as unknown as rpc.Api.GetTransactionResponse
}

/**
 * A ledger-included failure, shaped exactly as the RPC client delivers one:
 * `resultXdr` is a parsed `xdr.TransactionResult` (the host function trapped)
 * and the contract's own error code rides in the diagnostic events.
 *
 * The old mock returned `{ toXDR: () => 'Error(Contract, 7)' }` — a
 * debug-format literal `toXDR('base64')` can never produce — which is what let
 * the dead decode path in the module under test pass its tests (issue #1160).
 */
function failed(contractErrorCode?: number) {
  return {
    status: rpc.Api.GetTransactionStatus.FAILED,
    txHash: HASH,
    latestLedger: 105,
    latestLedgerCloseTime: 1_700_000_050,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1_600_000_000,
    ledger: 104,
    resultXdr: roundTripResult(trappedTransactionResult()),
    ...(contractErrorCode !== undefined
      ? { diagnosticEventsXdr: [roundTripEvent(contractErrorDiagnosticEvent(contractErrorCode))] }
      : {}),
  } as unknown as rpc.Api.GetTransactionResponse
}

/** A signed envelope stub — only its bounds are read by this module. */
function envelope(bounds: { maxTime?: string; maxLedger?: number } = {}): Transaction {
  return {
    ...(bounds.maxTime !== undefined
      ? { timeBounds: { minTime: '0', maxTime: bounds.maxTime } }
      : {}),
    ...(bounds.maxLedger !== undefined
      ? { ledgerBounds: { minLedger: 0, maxLedger: bounds.maxLedger } }
      : {}),
  } as unknown as Transaction
}

function mockServer(overrides: Partial<TransactionRpc> = {}): TransactionRpc {
  return {
    sendTransaction: vi.fn().mockResolvedValue(sendResponse('PENDING')),
    getTransaction: vi.fn().mockResolvedValue(success()),
    ...overrides,
  }
}

const noSleep = () => Promise.resolve()

function recorder() {
  const seen: TransactionLifecycleStatus[] = []
  return { seen, onStatus: (s: TransactionLifecycleStatus) => void seen.push(s) }
}

// ── sendTransaction status paths ──────────────────────────────────────────────

describe('sendSignedTransaction', () => {
  it('PENDING → accepted for polling', async () => {
    const server = mockServer()
    const { seen, onStatus } = recorder()

    const result = await sendSignedTransaction(server, envelope(), { onStatus, sleep: noSleep })

    expect(result).toEqual({ hash: HASH, status: 'PENDING', attempts: 1 })
    expect(seen).toEqual(['submitting', 'submitted'])
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('DUPLICATE → polls the existing hash instead of resubmitting', async () => {
    const send = vi.fn().mockResolvedValue(sendResponse('DUPLICATE'))
    const server = mockServer({ sendTransaction: send })

    const result = await sendSignedTransaction(server, envelope(), { sleep: noSleep })

    // Already in the mempool: one call, and the hash is still pollable.
    expect(result).toEqual({ hash: HASH, status: 'DUPLICATE', attempts: 1 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('TRY_AGAIN_LATER → resubmits the same signed envelope and succeeds', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(sendResponse('TRY_AGAIN_LATER'))
      .mockResolvedValueOnce(sendResponse('TRY_AGAIN_LATER'))
      .mockResolvedValueOnce(sendResponse('PENDING'))
    const server = mockServer({ sendTransaction: send })
    const { seen, onStatus } = recorder()
    const signed = envelope()

    const result = await sendSignedTransaction(server, signed, { onStatus, sleep: noSleep })

    expect(result.status).toBe('PENDING')
    expect(result.attempts).toBe(3)
    expect(seen).toEqual(['submitting', 'retrying', 'retrying', 'submitted'])
    // Never re-signed: the identical envelope object goes back to the server.
    expect(send.mock.calls.every(([tx]) => tx === signed)).toBe(true)
  })

  it('TRY_AGAIN_LATER storm → reports `dropped` within the resubmission budget', async () => {
    const send = vi.fn().mockResolvedValue(sendResponse('TRY_AGAIN_LATER'))
    const server = mockServer({ sendTransaction: send })
    const { seen, onStatus } = recorder()

    const error = await sendSignedTransaction(server, envelope(), {
      onStatus,
      sleep: noSleep,
      maxSendAttempts: 4,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TransactionSubmissionError)
    const submissionError = error as TransactionSubmissionError
    expect(submissionError.status).toBe('dropped')
    expect(submissionError.safeToRetry).toBe(true)
    expect(submissionError.message).toMatch(/never reached the ledger/i)
    expect(submissionError.message).toMatch(/safely try again/i)
    // Bounded: exactly the budget, and it never falls through to polling.
    expect(send).toHaveBeenCalledTimes(4)
    expect(server.getTransaction).not.toHaveBeenCalled()
    expect(seen[seen.length - 1]).toBe('dropped')
  })

  it('ERROR → decodes the result XDR and does not poll', async () => {
    const send = vi.fn().mockResolvedValue(
      sendResponse('ERROR', {
        errorResult: roundTripResult(trappedTransactionResult()),
        diagnosticEvents: [roundTripEvent(contractErrorDiagnosticEvent(1))],
      }),
    )
    const server = mockServer({ sendTransaction: send })

    const error = (await sendSignedTransaction(server, envelope(), { sleep: noSleep }).catch(
      (e: unknown) => e,
    )) as TransactionSubmissionError

    expect(error).toBeInstanceOf(TransactionSubmissionError)
    expect(error.status).toBe('failed')
    // The mapped message, not the base64 the result would re-serialise to.
    expect(error.message).toBe(CONTRACT_ERROR_MESSAGES[1])
    expect(error.contractErrorCode).toBe(1)
    expect(error.message).not.toMatch(BASE64)
    expect(send).toHaveBeenCalledTimes(1)
    expect(server.getTransaction).not.toHaveBeenCalled()
  })

  it('ERROR with no diagnostics still reports words rather than XDR', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        sendResponse('ERROR', { errorResult: roundTripResult(trappedTransactionResult()) }),
      )
    const server = mockServer({ sendTransaction: send })

    const error = (await sendSignedTransaction(server, envelope(), { sleep: noSleep }).catch(
      (e: unknown) => e,
    )) as TransactionSubmissionError

    expect(error.message).toMatch(/contract rejected the call/i)
    expect(error.message).not.toMatch(BASE64)
  })

  it('an unrecognised status is never treated as accepted', async () => {
    const send = vi.fn().mockResolvedValue(sendResponse('SOMETHING_NEW' as SendStatus))
    const server = mockServer({ sendTransaction: send })

    const error = (await sendSignedTransaction(server, envelope(), { sleep: noSleep }).catch(
      (e: unknown) => e,
    )) as TransactionSubmissionError

    expect(error.status).toBe('unconfirmed')
    expect(error.safeToRetry).toBe(false)
    expect(error.message).toMatch(/SOMETHING_NEW/)
  })

  it('retries transient transport failures on the same budget as TRY_AGAIN_LATER', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(sendResponse('PENDING'))
    const server = mockServer({ sendTransaction: send })

    const result = await sendSignedTransaction(server, envelope(), { sleep: noSleep })

    expect(result.status).toBe('PENDING')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-transient submission failure, and calls it dropped', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Unauthorized'))
    const server = mockServer({ sendTransaction: send })

    const error = (await sendSignedTransaction(server, envelope(), { sleep: noSleep }).catch(
      (e: unknown) => e,
    )) as TransactionSubmissionError

    // The server rejected the envelope outright — nothing was accepted.
    expect(error.status).toBe('dropped')
    expect(error.safeToRetry).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('exhausting the budget on transport errors is `unconfirmed`, not `dropped`', async () => {
    // The request may have reached the server before the connection failed, so
    // acceptance cannot be ruled out — a re-sign could execute twice.
    const send = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const server = mockServer({ sendTransaction: send })

    const error = (await sendSignedTransaction(server, envelope(), {
      sleep: noSleep,
      maxSendAttempts: 3,
    }).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('unconfirmed')
    expect(error.safeToRetry).toBe(false)
    expect(send).toHaveBeenCalledTimes(3)
  })
})

// ── Inclusion polling ─────────────────────────────────────────────────────────

describe('awaitTransactionInclusion', () => {
  it('confirms after a NOT_FOUND streak (late inclusion)', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(success())
    const server = mockServer({ getTransaction: get })
    const { seen, onStatus } = recorder()

    const response = await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { onStatus, sleep: noSleep },
    )

    expect(response.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
    expect(get).toHaveBeenCalledTimes(4)
    expect(seen).toEqual(['polling', 'confirmed'])
  })

  it('keeps polling while NOT_FOUND and the transaction is still within its bounds', async () => {
    // Ledger close time stays under maxTime, so no expiry verdict is reachable.
    const get = vi
      .fn()
      .mockResolvedValueOnce(notFound(100, 1_700_000_100))
      .mockResolvedValueOnce(notFound(101, 1_700_000_200))
      .mockResolvedValueOnce(success())
    const server = mockServer({ getTransaction: get })

    await awaitTransactionInclusion(server, HASH, { maxTime: 1_700_000_600 }, { sleep: noSleep })

    expect(get).toHaveBeenCalledTimes(3)
  })

  it('declares `expired` once the ledger closes past the transaction timebounds', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(notFound(100, 1_700_000_100))
      // Network has now closed a ledger after maxTime: inclusion is impossible.
      .mockResolvedValueOnce(notFound(101, 1_700_000_601))
    const server = mockServer({ getTransaction: get })
    const { seen, onStatus } = recorder()

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { onStatus, sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error).toBeInstanceOf(TransactionSubmissionError)
    expect(error.status).toBe('expired')
    // The definitive "safe to retry" signal — no attempt-count guesswork.
    expect(error.safeToRetry).toBe(true)
    expect(error.txHash).toBe(HASH)
    expect(get).toHaveBeenCalledTimes(2)
    expect(seen[seen.length - 1]).toBe('expired')
  })

  it('declares `expired` from ledgerBounds as well as timebounds', async () => {
    const get = vi.fn().mockResolvedValue(notFound(220, 1_700_000_100))
    const server = mockServer({ getTransaction: get })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxLedger: 200 },
      { sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('expired')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('reports `failed` for an included-but-rejected transaction', async () => {
    const server = mockServer({ getTransaction: vi.fn().mockResolvedValue(failed()) })
    const { seen, onStatus } = recorder()

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { onStatus, sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('failed')
    expect(seen[seen.length - 1]).toBe('failed')
    // No base64 leaks out even when there is no contract code to decode.
    expect(error.message).not.toMatch(BASE64)
  })

  /**
   * The regression at the heart of issue #1160: a mint rejected on-chain for
   * exceeding the token's maximum supply used to reach the user as the base64
   * re-serialisation of the result XDR.
   */
  it('surfaces the mapped contract message for a ledger-included rejection', async () => {
    const server = mockServer({ getTransaction: vi.fn().mockResolvedValue(failed(16)) })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('failed')
    expect(error.message).toBe(CONTRACT_ERROR_MESSAGES[16])
    expect(error.contractErrorCode).toBe(16)
    expect(error.message).not.toMatch(BASE64)
    expect(error.txHash).toBe(HASH)
  })

  it('withholds the retry affordance for a deterministic contract rejection', async () => {
    // Contract paused: the identical transaction cannot succeed until an
    // admin unpauses, so a one-click retry would just burn another fee.
    const server = mockServer({ getTransaction: vi.fn().mockResolvedValue(failed(10)) })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.message).toBe(CONTRACT_ERROR_MESSAGES[10])
    expect(error.safeToRetry).toBe(false)
    expect(error.retryRequirement).toMatch(/unpause/i)
  })

  it('still allows a retry for a transient contract rejection', async () => {
    // Code 11 is the contract's concurrency guard — it clears on its own.
    const server = mockServer({ getTransaction: vi.fn().mockResolvedValue(failed(11)) })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.message).toBe(CONTRACT_ERROR_MESSAGES[11])
    expect(error.safeToRetry).toBe(true)
    expect(error.retryRequirement).toBeUndefined()
  })

  it('tolerates a bounded run of transport errors without ending the poll', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(success())
    const server = mockServer({ getTransaction: get })

    const response = await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep },
    )

    expect(response.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('reports `unconfirmed` (never safe to retry) when visibility is lost', async () => {
    const get = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const server = mockServer({ getTransaction: get })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep, maxConsecutiveTransportErrors: 3 },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('unconfirmed')
    expect(error.safeToRetry).toBe(false)
    expect(error.message).toMatch(/check the explorer/i)
    // Exactly one retry layer: 3 tolerated failures + the one that gives up.
    expect(get).toHaveBeenCalledTimes(4)
  })

  it('a transient-error streak broken by NOT_FOUND does not count toward the cap', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(notFound())
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(success())
    const server = mockServer({ getTransaction: get })

    const response = await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      { sleep: noSleep, maxConsecutiveTransportErrors: 2 },
    )

    expect(response.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
  })

  it('falls back to a duration budget when the envelope carries no bounds', async () => {
    const get = vi.fn().mockResolvedValue(notFound())
    const server = mockServer({ getTransaction: get })
    let clock = 0
    const now = () => clock
    const sleep = (ms: number) => {
      clock += ms
      return Promise.resolve()
    }

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      {},
      {
        sleep,
        now,
        maxPollDurationMs: 5_000,
      },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    // No bounds means no expiry proof, so the verdict must stay ambiguous.
    expect(error.status).toBe('unconfirmed')
    expect(error.safeToRetry).toBe(false)
    expect(clock).toBeGreaterThanOrEqual(5_000)
  })

  it('stops on a non-transient RPC error rather than retrying it', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Unauthorized'))
    const server = mockServer({ getTransaction: get })

    const error = (await awaitTransactionInclusion(
      server,
      HASH,
      { maxTime: 1_700_000_600 },
      {
        sleep: noSleep,
      },
    ).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('unconfirmed')
    expect(get).toHaveBeenCalledTimes(1)
  })
})

// ── Deadline extraction ───────────────────────────────────────────────────────

describe('inclusionDeadlineOf', () => {
  it('reads timebounds and ledgerbounds off a transaction', () => {
    expect(inclusionDeadlineOf(envelope({ maxTime: '1700000600', maxLedger: 500 }))).toEqual({
      maxTime: 1_700_000_600,
      maxLedger: 500,
    })
  })

  it('treats the XDR "unbounded" zero as no deadline at all', () => {
    expect(inclusionDeadlineOf(envelope({ maxTime: '0', maxLedger: 0 }))).toEqual({})
    expect(inclusionDeadlineOf(envelope())).toEqual({})
  })

  it('reads a fee bump deadline from its inner transaction', () => {
    const feeBump = {
      innerTransaction: envelope({ maxTime: '1700000900' }),
    } as unknown as FeeBumpTransaction

    expect(inclusionDeadlineOf(feeBump)).toEqual({ maxTime: 1_700_000_900 })
  })
})

// ── End-to-end submission ─────────────────────────────────────────────────────

describe('submitAndConfirm', () => {
  it('rides out a TRY_AGAIN_LATER storm and a NOT_FOUND streak to confirmation', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(sendResponse('TRY_AGAIN_LATER'))
      .mockResolvedValueOnce(sendResponse('PENDING'))
    const get = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(success())
    const server = mockServer({ sendTransaction: send, getTransaction: get })
    const { seen, onStatus } = recorder()

    const { hash } = await submitAndConfirm(server, envelope({ maxTime: '1700000600' }), {
      onStatus,
      sleep: noSleep,
    })

    expect(hash).toBe(HASH)
    expect(seen).toEqual(['submitting', 'retrying', 'submitted', 'polling', 'confirmed'])
  })

  it('never polls a hash that was never accepted', async () => {
    const send = vi.fn().mockResolvedValue(sendResponse('TRY_AGAIN_LATER'))
    const get = vi.fn()
    const server = mockServer({ sendTransaction: send, getTransaction: get })

    const error = (await submitAndConfirm(server, envelope({ maxTime: '1700000600' }), {
      sleep: noSleep,
      maxSendAttempts: 3,
    }).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('dropped')
    expect(get).not.toHaveBeenCalled()
  })

  it('uses the envelope bounds for the expiry verdict', async () => {
    const send = vi.fn().mockResolvedValue(sendResponse('PENDING'))
    const get = vi.fn().mockResolvedValue(notFound(101, 1_700_000_601))
    const server = mockServer({ sendTransaction: send, getTransaction: get })

    const error = (await submitAndConfirm(server, envelope({ maxTime: '1700000600' }), {
      sleep: noSleep,
    }).catch((e: unknown) => e)) as TransactionSubmissionError

    expect(error.status).toBe('expired')
    expect(error.safeToRetry).toBe(true)
    // One getTransaction call: the verdict came from the ledger clock, not
    // from exhausting a fixed attempt count.
    expect(get).toHaveBeenCalledTimes(1)
  })
})
