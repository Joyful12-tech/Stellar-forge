/**
 * Soroban transaction submission and inclusion tracking.
 *
 * `sendTransaction` has four documented statuses and only one of them
 * (`PENDING`) means "the network accepted this envelope and it is now waiting
 * for inclusion". Treating everything that is not `ERROR` as success made the
 * app poll hashes that could never appear (`TRY_AGAIN_LATER` — the envelope was
 * dropped before it ever reached the mempool), burn the full backoff schedule,
 * and then report a generic timeout. This module gives every status an explicit
 * path, and replaces the attempt-count timeout with a verdict derived from the
 * transaction's own timebounds/ledgerbounds:
 *
 *   PENDING          → poll for inclusion
 *   DUPLICATE        → poll the existing hash (already in the mempool)
 *   TRY_AGAIN_LATER  → resubmit the *same signed envelope* with backoff, then
 *                      report `dropped` — nothing was ever submitted
 *   ERROR            → parse the result XDR and surface the reason
 *
 * The distinction that matters for real funds: `dropped` and `expired` are
 * provably-not-included, so re-signing cannot double-execute `create_token` /
 * `mint_tokens`. `unconfirmed` means we lost visibility while the envelope was
 * live — retrying there could execute twice, so it is never advertised as safe.
 */

import { rpc, FeeBumpTransaction, Transaction } from 'stellar-sdk'
import { parseContractError } from '../utils/contractErrors'
import { decodeTransactionFailure } from '../utils/transactionResult'
import { isTransientError } from '../utils/retry'
import { nextBackoffDelay } from '../utils/pollWithBackoff'

/**
 * Lifecycle status of one signed envelope, from submission to a terminal
 * verdict. Propagated to `useTransaction` / `TransactionStatus` so the UI can
 * say exactly what happened rather than "pending" for everything in flight.
 */
export type TransactionLifecycleStatus =
  /** Handing the signed envelope to the RPC server. */
  | 'submitting'
  /** Accepted into the mempool (PENDING/DUPLICATE); waiting for inclusion. */
  | 'submitted'
  /** TRY_AGAIN_LATER or a transient transport error — resubmitting as-is. */
  | 'retrying'
  /** Polling `getTransaction` for inclusion. */
  | 'polling'
  /** Included in a ledger and applied successfully. */
  | 'confirmed'
  /** Included in a ledger and rejected by the network or the contract. */
  | 'failed'
  /** Never accepted by the network — no ledger effects, safe to try again. */
  | 'dropped'
  /** Bounds elapsed without inclusion — can never be included, safe to retry. */
  | 'expired'
  /** Visibility lost while the envelope was live — retrying may double-execute. */
  | 'unconfirmed'

/** Terminal statuses that a failed submission can carry. */
export type TransactionFailureStatus = Extract<
  TransactionLifecycleStatus,
  'failed' | 'dropped' | 'expired' | 'unconfirmed'
>

/**
 * Whether re-signing and resubmitting is provably free of double-execution
 * risk.
 *
 * - `dropped`  — the envelope never entered the mempool, so it cannot land.
 * - `expired`  — its bounds have elapsed; validators can no longer include it.
 * - `failed`   — it was included and rejected; contract state was rolled back.
 * - `unconfirmed` — it may still be live. Never safe.
 */
const RETRY_SAFETY: Record<TransactionFailureStatus, boolean> = {
  dropped: true,
  expired: true,
  failed: true,
  unconfirmed: false,
}

/** A submission that ended without an applied transaction, with the reason. */
export class TransactionSubmissionError extends Error {
  readonly status: TransactionFailureStatus
  /**
   * Whether a "try again" affordance may be offered.
   *
   * Two conditions, both required: resubmission cannot execute the call twice
   * (see {@link RETRY_SAFETY}), *and* it is not a deterministic contract-logic
   * rejection that would fail identically. A paused factory, an exceeded
   * supply cap or a stale fee is safe to resubmit but pointless — retrying
   * burns another network fee for a verdict that cannot change until the
   * on-chain condition does. {@link retryRequirement} says what that is.
   */
  readonly safeToRetry: boolean
  /** The contract's `Error` enum code, when the diagnostics carried one. */
  readonly contractErrorCode: number | undefined
  /** What has to change before a retry could succeed, when known. */
  readonly retryRequirement: string | undefined
  /** Hash of the envelope, when one was computed by the server. */
  readonly txHash: string | undefined
  /** Number of `sendTransaction` calls made for this envelope. */
  readonly attempts: number | undefined
  /** The underlying transport/RPC error, when the verdict came from one. */
  readonly cause: unknown

  constructor(
    status: TransactionFailureStatus,
    message: string,
    options: {
      txHash?: string
      attempts?: number
      cause?: unknown
      contractErrorCode?: number
      retryRequirement?: string
      /** Set when the same call would deterministically fail again. */
      deterministic?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'TransactionSubmissionError'
    this.cause = options.cause
    this.status = status
    this.safeToRetry = RETRY_SAFETY[status] && !options.deterministic
    this.contractErrorCode = options.contractErrorCode
    this.retryRequirement = options.retryRequirement
    this.txHash = options.txHash
    this.attempts = options.attempts
  }
}

/** Deadline after which a transaction can no longer be included in a ledger. */
export interface InclusionDeadline {
  /** Inclusive max ledger from `ledgerBounds`, when set. */
  maxLedger?: number
  /** Inclusive max close time (unix seconds) from `timeBounds`, when set. */
  maxTime?: number
}

/**
 * The subset of `rpc.Server` this module needs. Structural so tests can supply
 * a plain object of mocked RPC responses.
 */
export interface TransactionRpc {
  sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse>
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>
}

export interface SubmitOptions {
  /** Reports each lifecycle transition as it happens. */
  onStatus?: ((status: TransactionLifecycleStatus) => void) | undefined
  /** Total `sendTransaction` calls, including the first. */
  maxSendAttempts?: number
  sendInitialDelayMs?: number
  sendMaxDelayMs?: number
  pollInitialDelayMs?: number
  pollMaxDelayMs?: number
  /** Consecutive transport failures tolerated while polling before giving up. */
  maxConsecutiveTransportErrors?: number
  /**
   * Safety net for envelopes with no bounds at all (`setTimeout(0)`), where no
   * definitive expiry verdict exists. Ignored when bounds are present.
   */
  maxPollDurationMs?: number
  /** Injectable for tests; defaults to a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable clock for tests. */
  now?: () => number
}

const DEFAULTS = {
  maxSendAttempts: 5,
  sendInitialDelayMs: 1_000,
  sendMaxDelayMs: 8_000,
  pollInitialDelayMs: 500,
  pollMaxDelayMs: 4_000,
  maxConsecutiveTransportErrors: 5,
  maxPollDurationMs: 120_000,
} as const

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Read the inclusion deadline off a signed envelope. For a fee bump the inner
 * transaction carries the bounds — the bump inherits them.
 *
 * `maxTime`/`maxLedger` of `0` mean "unbounded" in XDR and are reported as
 * absent, so callers never derive an expiry verdict from a missing bound.
 */
export function inclusionDeadlineOf(tx: Transaction | FeeBumpTransaction): InclusionDeadline {
  const inner: Transaction =
    'innerTransaction' in tx && tx.innerTransaction ? tx.innerTransaction : (tx as Transaction)

  const deadline: InclusionDeadline = {}

  const maxTime = Number(inner.timeBounds?.maxTime ?? 0)
  if (Number.isFinite(maxTime) && maxTime > 0) deadline.maxTime = maxTime

  const maxLedger = Number(inner.ledgerBounds?.maxLedger ?? 0)
  if (Number.isFinite(maxLedger) && maxLedger > 0) deadline.maxLedger = maxLedger

  return deadline
}

/** True once the network has provably moved past the transaction's bounds. */
function deadlinePassed(
  deadline: InclusionDeadline,
  response: rpc.Api.GetTransactionResponse,
): boolean {
  const latestLedger = Number(response.latestLedger)
  const latestCloseTime = Number(response.latestLedgerCloseTime)

  if (deadline.maxLedger !== undefined && Number.isFinite(latestLedger)) {
    if (latestLedger > deadline.maxLedger) return true
  }
  if (deadline.maxTime !== undefined && Number.isFinite(latestCloseTime)) {
    if (latestCloseTime > deadline.maxTime) return true
  }
  return false
}

/**
 * Options carrying a decoded on-chain rejection into
 * {@link TransactionSubmissionError}.
 *
 * `errorResult` / `resultXdr` are already-parsed `xdr.TransactionResult`
 * objects. Re-serialising one with `.toXDR('base64')` (what this module used to
 * do) hands the user opaque binary and can never match the friendly
 * `Error(Contract, N)` table — see `utils/transactionResult.ts`.
 */
function failureOptions(input: {
  result?: Parameters<typeof decodeTransactionFailure>[0]['result']
  diagnosticEvents?: Parameters<typeof decodeTransactionFailure>[0]['diagnosticEvents']
  fallbackMessage?: string | undefined
}): {
  message: string
  contractErrorCode?: number
  retryRequirement?: string
  deterministic: boolean
} {
  let decoded
  try {
    decoded = decodeTransactionFailure(input)
  } catch {
    // A malformed result XDR must not mask the rejection itself.
    return {
      message: input.fallbackMessage ?? 'The network rejected the transaction',
      deterministic: false,
    }
  }
  return {
    message: decoded.message,
    ...(decoded.contractErrorCode !== undefined
      ? { contractErrorCode: decoded.contractErrorCode }
      : {}),
    ...(decoded.retryRequirement ? { retryRequirement: decoded.retryRequirement } : {}),
    deterministic: decoded.deterministic,
  }
}

export interface SendResult {
  hash: string
  /** The accepting status: `PENDING` for a fresh envelope, `DUPLICATE` if it was already in flight. */
  status: 'PENDING' | 'DUPLICATE'
  /** How many `sendTransaction` calls it took to get accepted. */
  attempts: number
}

/**
 * Submit a signed envelope, giving every `sendTransaction` status its own path.
 *
 * `TRY_AGAIN_LATER` resubmits the identical signed envelope (never a re-sign,
 * which would change the hash and could double-execute) on a backoff schedule
 * until the attempt budget is exhausted, at which point the transaction is
 * reported `dropped`. Transient transport failures share that same budget, so
 * there is exactly one retry layer over submission.
 */
export async function sendSignedTransaction(
  server: TransactionRpc,
  signedTx: Transaction | FeeBumpTransaction,
  options: SubmitOptions = {},
): Promise<SendResult> {
  const {
    onStatus,
    maxSendAttempts = DEFAULTS.maxSendAttempts,
    sendInitialDelayMs = DEFAULTS.sendInitialDelayMs,
    sendMaxDelayMs = DEFAULTS.sendMaxDelayMs,
    sleep = defaultSleep,
  } = options

  onStatus?.('submitting')

  let lastHash: string | undefined
  let tryAgainCount = 0

  for (let attempt = 0; attempt < maxSendAttempts; attempt++) {
    const isLastAttempt = attempt === maxSendAttempts - 1
    let response: rpc.Api.SendTransactionResponse

    try {
      response = await server.sendTransaction(signedTx)
    } catch (err) {
      // Resubmitting the identical envelope is idempotent (same hash →
      // DUPLICATE), so a transient failure is retried on this same budget.
      if (!isTransientError(err)) {
        // A rejection the server chose to make (malformed envelope, auth) —
        // the transaction was definitively not accepted.
        onStatus?.('dropped')
        throw new TransactionSubmissionError('dropped', parseContractError(err).message, {
          attempts: attempt + 1,
        })
      }
      if (isLastAttempt) {
        // The budget ran out mid-transport: a request may have reached the
        // server and been accepted, so this is not provably a non-submission.
        onStatus?.('unconfirmed')
        throw new TransactionSubmissionError(
          'unconfirmed',
          'The transaction could not be submitted reliably — the network connection failed ' +
            `after ${maxSendAttempts} attempts. It may still have been accepted; check the ` +
            'explorer before submitting it again.',
          { attempts: attempt + 1, cause: err },
        )
      }
      onStatus?.('retrying')
      await sleep(
        nextBackoffDelay(attempt, {
          initialDelayMs: sendInitialDelayMs,
          maxDelayMs: sendMaxDelayMs,
        }),
      )
      continue
    }

    lastHash = response.hash || lastHash

    switch (response.status) {
      case 'PENDING':
        onStatus?.('submitted')
        return { hash: response.hash, status: 'PENDING', attempts: attempt + 1 }

      case 'DUPLICATE':
        // The exact envelope is already in the mempool — there is nothing to
        // resubmit; the existing hash is the one to poll.
        onStatus?.('submitted')
        return { hash: response.hash, status: 'DUPLICATE', attempts: attempt + 1 }

      case 'TRY_AGAIN_LATER': {
        tryAgainCount++
        if (isLastAttempt) break
        onStatus?.('retrying')
        await sleep(
          nextBackoffDelay(attempt, {
            initialDelayMs: sendInitialDelayMs,
            maxDelayMs: sendMaxDelayMs,
          }),
        )
        continue
      }

      case 'ERROR': {
        onStatus?.('failed')
        const { message, ...failure } = failureOptions({
          result: response.errorResult,
          diagnosticEvents: response.diagnosticEvents,
        })
        throw new TransactionSubmissionError('failed', message, {
          ...failure,
          ...(response.hash ? { txHash: response.hash } : {}),
          attempts: attempt + 1,
        })
      }

      default: {
        // An undocumented status must never fall through to hash-polling: we
        // cannot prove the envelope is either live or dropped.
        const unknownStatus: string = String((response as { status: string }).status)
        onStatus?.('unconfirmed')
        throw new TransactionSubmissionError(
          'unconfirmed',
          `The RPC server returned an unrecognised submission status "${unknownStatus}". ` +
            'Check the transaction in a block explorer before retrying.',
          {
            ...(response.hash ? { txHash: response.hash } : {}),
            attempts: attempt + 1,
          },
        )
      }
    }

    // Only reached when the final attempt returned TRY_AGAIN_LATER.
    break
  }

  onStatus?.('dropped')
  throw new TransactionSubmissionError(
    'dropped',
    `The network was too busy to accept the transaction (TRY_AGAIN_LATER) after ${maxSendAttempts} ` +
      `attempt${maxSendAttempts === 1 ? '' : 's'}. It never reached the ledger, so nothing was ` +
      'charged and no tokens were affected — you can safely try again.',
    {
      ...(lastHash ? { txHash: lastHash } : {}),
      attempts: tryAgainCount || maxSendAttempts,
    },
  )
}

/**
 * Poll `getTransaction` until the transaction is included or its bounds prove
 * it never can be.
 *
 * One retry layer only: `getTransaction` is called directly (not through
 * `withRetry`) so transport failures cannot multiply the worst-case wait. They
 * are counted separately from `NOT_FOUND`, which is the expected pre-inclusion
 * answer and is not an error at all.
 */
export async function awaitTransactionInclusion(
  server: TransactionRpc,
  hash: string,
  deadline: InclusionDeadline = {},
  options: SubmitOptions = {},
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const {
    onStatus,
    pollInitialDelayMs = DEFAULTS.pollInitialDelayMs,
    pollMaxDelayMs = DEFAULTS.pollMaxDelayMs,
    maxConsecutiveTransportErrors = DEFAULTS.maxConsecutiveTransportErrors,
    maxPollDurationMs = DEFAULTS.maxPollDurationMs,
    sleep = defaultSleep,
    now = Date.now,
  } = options

  const hasDeadline = deadline.maxLedger !== undefined || deadline.maxTime !== undefined
  const startedAt = now()

  onStatus?.('polling')

  let attempt = 0
  let consecutiveTransportErrors = 0

  for (;;) {
    let response: rpc.Api.GetTransactionResponse

    try {
      response = await server.getTransaction(hash)
      consecutiveTransportErrors = 0
    } catch (err) {
      consecutiveTransportErrors++
      const retryable =
        isTransientError(err) && consecutiveTransportErrors <= maxConsecutiveTransportErrors
      if (!retryable) {
        onStatus?.('unconfirmed')
        throw new TransactionSubmissionError(
          'unconfirmed',
          'The transaction was submitted, but its status could not be read from the network ' +
            `(${err instanceof Error ? err.message : String(err)}). It may still be confirmed — ` +
            'check the explorer before submitting it again.',
          { txHash: hash, cause: err },
        )
      }
      await sleep(
        nextBackoffDelay(attempt++, {
          initialDelayMs: pollInitialDelayMs,
          maxDelayMs: pollMaxDelayMs,
        }),
      )
      continue
    }

    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      onStatus?.('confirmed')
      return response
    }

    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      onStatus?.('failed')
      const { message, ...failure } = failureOptions({
        result: response.resultXdr,
        diagnosticEvents: response.diagnosticEventsXdr,
        fallbackMessage: `Transaction failed: ${hash}`,
      })
      throw new TransactionSubmissionError('failed', message, { ...failure, txHash: hash })
    }

    // NOT_FOUND: expected until the transaction lands. The only definitive
    // "it never will" answer comes from the network passing its bounds.
    if (hasDeadline && deadlinePassed(deadline, response)) {
      onStatus?.('expired')
      throw new TransactionSubmissionError(
        'expired',
        'The transaction expired before it was included in a ledger. Its time bounds have ' +
          'passed, so it can never be applied — no funds moved and it is safe to try again.',
        { txHash: hash },
      )
    }

    if (!hasDeadline && now() - startedAt >= maxPollDurationMs) {
      onStatus?.('unconfirmed')
      throw new TransactionSubmissionError(
        'unconfirmed',
        'The transaction was submitted but has not been confirmed yet, and it carries no time ' +
          'bounds to prove it expired. Check the explorer before submitting it again.',
        { txHash: hash },
      )
    }

    await sleep(
      nextBackoffDelay(attempt++, {
        initialDelayMs: pollInitialDelayMs,
        maxDelayMs: pollMaxDelayMs,
      }),
    )
  }
}

export interface SubmitAndConfirmResult {
  hash: string
  response: rpc.Api.GetSuccessfulTransactionResponse
}

/**
 * Submit a signed envelope and wait for a definitive verdict: resolves only on
 * confirmed inclusion, and otherwise rejects with a {@link
 * TransactionSubmissionError} whose `status`/`safeToRetry` say exactly what
 * happened to the user's signed transaction.
 */
export async function submitAndConfirm(
  server: TransactionRpc,
  signedTx: Transaction | FeeBumpTransaction,
  options: SubmitOptions = {},
): Promise<SubmitAndConfirmResult> {
  const { hash } = await sendSignedTransaction(server, signedTx, options)
  const response = await awaitTransactionInclusion(
    server,
    hash,
    inclusionDeadlineOf(signedTx),
    options,
  )
  return { hash, response }
}
