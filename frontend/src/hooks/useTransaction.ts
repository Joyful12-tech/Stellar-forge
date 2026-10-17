import { useState, useCallback, useEffect } from 'react'
import { stellarService } from '../services/stellar'
import { captureTransactionError } from '../lib/monitoring/sentry'
import { STELLAR_CONFIG } from '../config/stellar'
import { nextBackoffDelay } from '../utils/pollWithBackoff'
import {
  TransactionSubmissionError,
  type TransactionLifecycleStatus,
} from '../services/transactionSubmission'
import {
  contractErrorCodeFromMessage,
  contractErrorRetryRequirement,
  isDeterministicContractError,
} from '../utils/contractErrors'
import { decodeTransactionFailure } from '../utils/transactionResult'

/*
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Transaction-status tracking has exactly one implementation.     │
 * │                                                                  │
 * │  All transaction-related hooks live in this file to prevent      │
 * │  divergence. If you need a new way to track a transaction's      │
 * │  status, extend the API here rather than creating a separate     │
 * │  hook file.                                                      │
 * │                                                                  │
 * │  Consumers:                                                      │
 * │    • useTransaction          – MintForm, BurnForm, AdminPanel,    │
 * │                                 TokenCreateForm                  │
 * │    • useTransactionPolling   – TransactionStatus                 │
 * └──────────────────────────────────────────────────────────────────┘
 */

/**
 * Every state a write can be in, including the terminal verdicts that used to
 * collapse into a single `error`.
 *
 * `dropped` / `expired` mean the transaction provably never applied, so the UI
 * may offer "try again"; `unconfirmed` means we lost sight of a live envelope,
 * where re-signing risks executing the call twice. See
 * `services/transactionSubmission.ts` for how each verdict is reached.
 */
export type TransactionStatus =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'submitting'
  | 'submitted'
  | 'retrying'
  | 'polling'
  | 'success'
  | 'error'
  | 'dropped'
  | 'expired'
  | 'unconfirmed'

/** Statuses where a transaction is still in flight and no verdict exists yet. */
const IN_FLIGHT_STATUSES = new Set<TransactionStatus>([
  'simulating',
  'signing',
  'submitting',
  'submitted',
  'retrying',
  'polling',
])

/**
 * True while a transaction is being simulated, signed, submitted or awaited.
 * Components use this for their busy/disabled state so a new lifecycle status
 * can be added without every form re-enabling its submit button mid-flight.
 */
export function isTransactionInFlight(status: TransactionStatus): boolean {
  return IN_FLIGHT_STATUSES.has(status)
}

/**
 * Normalise a status reported by a builder (which speaks the service layer's
 * lifecycle vocabulary) into the hook's status. `confirmed`/`failed` are the
 * service names for the hook's `success`/`error`.
 */
function normalizeStatus(
  status: TransactionStatus | TransactionLifecycleStatus,
): TransactionStatus {
  if (status === 'confirmed') return 'success'
  if (status === 'failed') return 'error'
  return status
}

/** Terminal statuses a failed write can end in. */
export type TransactionFailureKind = 'error' | 'dropped' | 'expired' | 'unconfirmed'

/** What happened to a write that did not confirm, and whether retrying is safe. */
export interface TransactionFailure {
  kind: TransactionFailureKind
  message: string
  /**
   * True only when resubmission provably cannot execute the call twice
   * (dropped / expired / included-and-failed) *and* the same call would not be
   * rejected identically. Never true for `unconfirmed`, and never true for a
   * deterministic contract rejection (paused, supply cap, whitelist, …) — see
   * `retryRequirement` for what has to change first.
   */
  safeToRetry: boolean
  /** The contract's `Error` enum code, when the failure decoded to one. */
  contractErrorCode?: number
  /** What has to change before a retry could succeed, when known. */
  retryRequirement?: string
  /** Hash of the signed envelope, when the network assigned one. */
  txHash?: string
}

function toFailure(err: Error): TransactionFailure {
  if (err instanceof TransactionSubmissionError) {
    return {
      kind: err.status === 'failed' ? 'error' : err.status,
      message: err.message,
      safeToRetry: err.safeToRetry,
      ...(err.contractErrorCode !== undefined ? { contractErrorCode: err.contractErrorCode } : {}),
      ...(err.retryRequirement ? { retryRequirement: err.retryRequirement } : {}),
      ...(err.txHash ? { txHash: err.txHash } : {}),
    }
  }
  // Errors from simulation/signing never reached the network, so nothing can
  // have executed. That makes them safe to retry — but a simulation that was
  // rejected by contract logic (paused, supply cap, whitelist) will be
  // rejected identically until the condition changes, so it is not offered as
  // a one-click retry either.
  const code = contractErrorCodeFromMessage(err.message)
  if (code !== undefined && isDeterministicContractError(code)) {
    const requirement = contractErrorRetryRequirement(code)
    return {
      kind: 'error',
      message: err.message,
      safeToRetry: false,
      contractErrorCode: code,
      ...(requirement ? { retryRequirement: requirement } : {}),
    }
  }
  return { kind: 'error', message: err.message, safeToRetry: true }
}

// ── Reconciliation policy ───────────────────────────────────────────────────
//
// Every write-path component MUST follow this policy:
//
// 1. No optimistic cache mutation.
//    Never add/update/remove entries in any shared cache (useTokens,
//    useFactoryState, TokenDashboard, etc.) before the transaction is
//    confirmed on-chain. A phantom entry that looks real but doesn't exist
//    on the ledger is worse than a brief loading state.
//
// 2. Only call refresh() after a CONFIRMED success.
//    The `onSuccess` callback (or equivalent) is the one place where
//    caches should be invalidated. Listen for `status === 'success'` (not
//    just "the promise resolved") and call refresh() / refetch() / re-run
//    the relevant query hook.
//
// 3. On failure or timeout, do NOT mutate any cache.
//    Show an error toast. If the transaction timed out, communicate
//    uncertainty: "Transaction submitted but not yet confirmed — check
//    the explorer for the final status." Never silently treat a timeout
//    as either success or failure.
//
//    Timeout guards are the component's responsibility — wrap the
//    builder call with Promise.race against a timeout and surface the
//    uncertainty banner when the race is lost.
//
// 4. Prefer useTransaction over ad-hoc loading states.
//    The hook centralises simulate → sign → submit → poll. Components
//    that roll their own isDeploying / isSubmitting state bypass this
//    lifecycle and risk drifting from the policy.

export interface UseTransactionResult<T> {
  /** Run the transaction. Resolves with the result or throws on error. */
  execute: () => Promise<T>
  reset: () => void
  status: TransactionStatus
  result: T | null
  error: Error | null
  /** Typed verdict for a failed run: what happened and whether retrying is safe. */
  failure: TransactionFailure | null
  /** True while the transaction is still in flight (no verdict yet). */
  isInFlight: boolean
  /**
   * Whether a "try again" affordance may be offered. False until a run fails,
   * and false for `unconfirmed` failures where the envelope may still land —
   * re-signing there could execute create_token/mint_tokens twice.
   */
  canRetry: boolean
}

/**
 * Centralises transaction lifecycle: simulate → sign → submit → poll.
 *
 * @param builder - Async function that performs the full transaction and returns a result.
 *                  Use the `onStatusChange` callback to report fine-grained status transitions;
 *                  it accepts the service layer's lifecycle statuses directly.
 */
export function useTransaction<T>(
  builder: (
    onStatusChange: (status: TransactionStatus | TransactionLifecycleStatus) => void,
  ) => Promise<T>,
): UseTransactionResult<T> {
  const [status, setStatus] = useState<TransactionStatus>('idle')
  const [result, setResult] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [failure, setFailure] = useState<TransactionFailure | null>(null)

  const execute = useCallback(async (): Promise<T> => {
    setStatus('simulating')
    setResult(null)
    setError(null)
    setFailure(null)
    try {
      const value = await builder((next) => setStatus(normalizeStatus(next)))
      setResult(value)
      setStatus('success')
      return value
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      const nextFailure = toFailure(e)
      setError(e)
      setFailure(nextFailure)
      setStatus(nextFailure.kind)
      throw e
    }
  }, [builder])

  const reset = useCallback(() => {
    setStatus('idle')
    setResult(null)
    setError(null)
    setFailure(null)
  }, [])

  return {
    execute,
    reset,
    status,
    result,
    error,
    failure,
    isInFlight: isTransactionInFlight(status),
    canRetry: failure?.safeToRetry ?? false,
  }
}

// ─── Polling (post-submission status check) ────────────────────────────────

/**
 * `unconfirmed` is deliberately distinct from `failed`: the transaction was
 * accepted by the network and simply has not been seen to land within the
 * polling window. Reporting that as a failure is what previously invited users
 * to re-sign a transaction that could still be included — a double-execution
 * hazard for create_token / mint_tokens.
 */
export type TransactionPollStatus = 'pending' | 'success' | 'failed' | 'unconfirmed'

export interface UseTransactionPollingResult {
  status: TransactionPollStatus
  error?: string
  /** Sentry event ID for the polling failure, when available. */
  sentryEventId?: string
  /**
   * True only when the transaction is known not to have applied *and* a
   * resubmission could reach a different verdict. `unconfirmed` is never safe
   * (the envelope may still land), and neither is a deterministic contract
   * rejection — see `retryRequirement`.
   */
  safeToRetry: boolean
  /** What has to change before a retry could succeed, when known. */
  retryRequirement?: string
}

/**
 * Read a failed transaction payload into user-facing text.
 *
 * Horizon returns the transaction result as a base64 `result_xdr` string; the
 * decoder reads its result codes rather than handing the blob to the user, and
 * recognises a contract rejection (from the result, or from an error string
 * that already names one) so the retry affordance can be withheld.
 */
function describePollFailure(
  payload: Record<string, unknown> | undefined,
  fallbackMessage: string,
): { message: string; deterministic: boolean; retryRequirement?: string } {
  const resultXdr = payload?.['result_xdr']
  const decoded = decodeTransactionFailure({
    ...(typeof resultXdr === 'string' ? { result: resultXdr } : {}),
    fallbackMessage,
  })
  return {
    message: decoded.message,
    deterministic: decoded.deterministic,
    ...(decoded.retryRequirement ? { retryRequirement: decoded.retryRequirement } : {}),
  }
}

/**
 * A hash that Horizon does not know about yet is the expected answer before
 * inclusion, not an error — it must not end the poll.
 */
function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not found/i.test(message)
}

const INITIAL_DELAY_MS = 500
const MAX_DELAY_MS = 4000
const TIMEOUT_MS = 60000

/**
 * Polls stellarService.getTransaction(txHash) until it resolves to a
 * terminal status (success/error) or TIMEOUT_MS elapses. Uses the same
 * exponential-backoff-with-jitter schedule (via nextBackoffDelay) as
 * stellar-impl.ts's pollTransaction, so there is one growth curve for
 * "poll a transaction hash until terminal status" across the codebase.
 *
 * Thin, justified wrapper: TransactionStatus.tsx needs to poll an
 * *already-submitted* transaction by hash independently of the builder
 * lifecycle that useTransaction manages. Keeping the polling primitive
 * co-located here ensures both paths draw from the same implementation.
 */
export function useTransactionPolling(txHash: string): UseTransactionPollingResult {
  const [status, setStatus] = useState<TransactionPollStatus>('pending')
  const [error, setError] = useState<string | undefined>(undefined)
  const [sentryEventId, setSentryEventId] = useState<string | undefined>(undefined)
  // Set when the failure is a contract rejection that would repeat verbatim —
  // the retry button is withheld and this is shown instead.
  const [retryRequirement, setRetryRequirement] = useState<string | undefined>(undefined)
  const [deterministicFailure, setDeterministicFailure] = useState(false)

  useEffect(() => {
    // Reset to pending whenever txHash changes so a new poll cycle doesn't
    // briefly show the previous transaction's terminal status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('pending')
    setError(undefined)
    setSentryEventId(undefined)
    setRetryRequirement(undefined)
    setDeterministicFailure(false)

    let settled = false
    let attempt = 0
    let pollTimeoutId: ReturnType<typeof setTimeout> | undefined

    function settle() {
      settled = true
      clearTimeout(pollTimeoutId)
    }

    function scheduleNextPoll() {
      const delay = nextBackoffDelay(attempt, {
        initialDelayMs: INITIAL_DELAY_MS,
        maxDelayMs: MAX_DELAY_MS,
      })
      attempt += 1
      pollTimeoutId = setTimeout(poll, delay)
    }

    /** Capture to Sentry with full transaction correlation tags. */
    function report(err: Error): string | undefined {
      return captureTransactionError(err, {
        txHash,
        network: STELLAR_CONFIG.network,
        contractId: STELLAR_CONFIG.factoryContractId ?? undefined,
        functionName: 'pollTransaction',
      })
    }

    async function poll() {
      try {
        const result = await stellarService.getTransaction(txHash)
        if (settled) return

        if (result.status === 'success') {
          settle()
          setStatus('success')
        } else if (result.status === 'error' || result.status === 'failed') {
          settle()
          setStatus('failed')
          const failure = describePollFailure(
            result,
            typeof result.error === 'string' ? result.error : 'Transaction failed',
          )
          setError(failure.message)
          setDeterministicFailure(failure.deterministic)
          setRetryRequirement(failure.retryRequirement)

          const eventId = report(new Error(`Transaction failed: ${failure.message}`))
          if (eventId) setSentryEventId(eventId)
        } else {
          // status === 'pending' — schedule the next attempt with backoff
          scheduleNextPoll()
        }
      } catch (err) {
        if (settled) return

        // "Not found" means the transaction has not been included *yet* —
        // the same distinction the RPC poller draws between NOT_FOUND and a
        // transport failure. Keep polling until the overall timeout decides.
        if (isNotFoundError(err)) {
          scheduleNextPoll()
          return
        }

        settle()
        setStatus('failed')
        const errorMessage = err instanceof Error ? err.message : 'Transaction failed'
        setError(errorMessage)

        const eventId = report(err instanceof Error ? err : new Error(errorMessage))
        if (eventId) setSentryEventId(eventId)
      }
    }

    void poll()

    const timeoutId = setTimeout(() => {
      if (settled) return
      settle()
      // Not a failure: the transaction was accepted and may still land. The
      // UI must say so rather than inviting a re-sign.
      setStatus('unconfirmed')
      setError(
        'Not confirmed yet — the transaction was submitted but has not been included within ' +
          'the polling window. Check the explorer before submitting it again.',
      )

      report(new Error(`Transaction polling timed out: ${txHash}`))
    }, TIMEOUT_MS)

    return () => {
      settled = true
      clearTimeout(pollTimeoutId)
      clearTimeout(timeoutId)
    }
  }, [txHash])

  // A transaction that was included and failed applied no state changes, so
  // retrying cannot double-execute; `unconfirmed` (and the pre-verdict
  // `pending`) is not. A decoded contract rejection is excluded too — the
  // identical call would be rejected identically, at the cost of another fee.
  const safeToRetry = status === 'failed' && !deterministicFailure

  return {
    status,
    safeToRetry,
    ...(retryRequirement ? { retryRequirement } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(sentryEventId ? { sentryEventId } : {}),
  }
}
