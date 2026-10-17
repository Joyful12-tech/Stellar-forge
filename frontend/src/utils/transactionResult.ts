/**
 * Decoding of on-chain transaction failures into user-facing text.
 *
 * `xdr.TransactionResult` / `xdr.DiagnosticEvent` arrive from the RPC server
 * *already parsed* into typed XDR objects. Calling `.toXDR('base64')` on one of
 * them does not "read" it — it serialises the object straight back to the
 * opaque binary it was parsed from. Feeding that base64 blob to
 * `parseContractError` could never match `Error(Contract, N)`, so every
 * ledger-included rejection reached the user as unreadable binary while the
 * friendly `CONTRACT_ERROR_MESSAGES` table sat unused (issue #1160).
 *
 * The contract's `Error` enum code is *not* in the transaction result: the
 * result only says the host function trapped. The code travels in the
 * diagnostic events, as an `ScVal` of type `scvError` whose `ScError` is
 * `sceContract(code)`. So decoding walks, in order:
 *
 *   1. diagnostic events        → the contract's own error code
 *   2. an accompanying message  → a textual `Error(Contract, N)`, e.g. from a
 *                                 simulation error the SDK already stringified
 *   3. the transaction result   → transaction- and operation-level result
 *                                 codes ("txInsufficientFee", "…Trapped", …)
 *
 * and never falls back to raw XDR text.
 */

import { xdr } from 'stellar-sdk'
import {
  contractErrorCodeFromMessage,
  contractErrorMessage,
  contractErrorRetryRequirement,
  isDeterministicContractError,
} from './contractErrors'

/** What a failed transaction actually says, once its XDR has been read. */
export interface DecodedTransactionFailure {
  /** User-facing text. Never raw base64/XDR. */
  message: string
  /** The contract's `Error` enum code, when the diagnostics carried one. */
  contractErrorCode?: number
  /** Transaction-level result code, e.g. `txFailed`, `txInsufficientFee`. */
  transactionCode?: string
  /** Operation-level result codes, e.g. `invokeHostFunctionTrapped`. */
  operationCodes?: string[]
  /**
   * True when resubmitting the identical call must fail the same way until
   * something changes on-chain or in the request (paused factory, supply cap,
   * whitelist, stale fee). Retrying such a failure only burns fees again.
   */
  deterministic: boolean
  /** What has to change before a retry could succeed, when we can say. */
  retryRequirement?: string
}

/** Anything the RPC layer may hand us for a result: parsed XDR or base64. */
type ResultInput = xdr.TransactionResult | string | null | undefined
type DiagnosticInput = xdr.DiagnosticEvent | string | null | undefined

/** Transaction-level result codes we can describe better than their name. */
const TRANSACTION_RESULT_MESSAGES: Record<string, string> = {
  txInsufficientFee:
    'The network fee offered was below the minimum the network accepted for this ledger. ' +
    'Submit again with a higher fee.',
  txInsufficientBalance: 'Your XLM balance is too low to cover this transaction and its reserves.',
  txBadSeq:
    'The transaction used an out-of-date sequence number. Refresh and build the transaction again.',
  txBadAuth: 'The transaction was not signed by the required account(s).',
  txBadAuthExtra: 'The transaction carried a signature that was not needed.',
  txNoAccount: 'The source account does not exist on this network.',
  txTooEarly: 'The transaction was submitted before its time bounds opened.',
  txTooLate: 'The transaction was submitted after its time bounds expired.',
  txMissingOperation: 'The transaction contained no operations.',
  txSorobanInvalid: 'The Soroban resources declared for this transaction were invalid.',
  txMalformed: 'The transaction envelope was malformed.',
}

/** Operation-level result codes, including the Soroban host-function ones. */
const OPERATION_RESULT_MESSAGES: Record<string, string> = {
  invokeHostFunctionTrapped: 'The contract rejected the call and the transaction was reverted.',
  invokeHostFunctionMalformed: 'The contract call was malformed and could not be executed.',
  invokeHostFunctionResourceLimitExceeded:
    'The contract call exceeded the network resource limits. Try again with a smaller batch.',
  invokeHostFunctionEntryArchived:
    'Contract data needed by this call has been archived and must be restored first.',
  opBadAuth: 'The operation was not signed by the required account.',
  opNoAccount: 'The source account for the operation does not exist.',
  opNotSupported: 'The network does not support this operation.',
  opExceededWorkLimit: 'The operation exceeded the network work limit.',
  extendFootprintTtlResourceLimitExceeded:
    'Extending the contract data lifetime exceeded the network resource limits.',
  restoreFootprintResourceLimitExceeded:
    'Restoring the archived contract data exceeded the network resource limits.',
}

const GENERIC_FAILURE = 'The network rejected the transaction'

/** Parse a base64 result when that is what we were handed. */
function toTransactionResult(input: ResultInput): xdr.TransactionResult | undefined {
  if (!input) return undefined
  if (typeof input !== 'string') return input
  try {
    return xdr.TransactionResult.fromXDR(input, 'base64')
  } catch {
    return undefined
  }
}

function toDiagnosticEvent(input: DiagnosticInput): xdr.DiagnosticEvent | undefined {
  if (!input) return undefined
  if (typeof input !== 'string') return input
  try {
    return xdr.DiagnosticEvent.fromXDR(input, 'base64')
  } catch {
    return undefined
  }
}

/**
 * Depth-limited walk for the `sceContract` error buried in an `ScVal`. The
 * host wraps the failing value in vectors/maps often enough (an error inside
 * an event payload, or inside a `["error", …]` tuple) that a top-level check
 * alone misses real rejections.
 */
export function contractErrorCodeFromScVal(
  value: xdr.ScVal | undefined,
  depth = 0,
): number | undefined {
  if (!value || depth > 4) return undefined
  try {
    const type = value.switch()

    if (type === xdr.ScValType.scvError()) {
      const err = value.error()
      return err.switch() === xdr.ScErrorType.sceContract() ? err.contractCode() : undefined
    }

    if (type === xdr.ScValType.scvVec()) {
      for (const item of value.vec() ?? []) {
        const code = contractErrorCodeFromScVal(item, depth + 1)
        if (code !== undefined) return code
      }
      return undefined
    }

    if (type === xdr.ScValType.scvMap()) {
      for (const entry of value.map() ?? []) {
        const code = contractErrorCodeFromScVal(entry.val(), depth + 1)
        if (code !== undefined) return code
      }
    }
  } catch {
    // A value we cannot read is not a decode failure for the whole event.
  }
  return undefined
}

/**
 * The contract `Error` enum code carried by a set of diagnostic events, when
 * one of them reports a contract error. This — not the transaction result — is
 * where `Error(Contract, N)` actually lives.
 */
export function contractErrorCodeFromDiagnosticEvents(
  events: readonly DiagnosticInput[] | null | undefined,
): number | undefined {
  for (const raw of events ?? []) {
    const event = toDiagnosticEvent(raw)
    if (!event) continue
    try {
      const body = event.event().body()
      // `ContractEventBody` is an int-switched union; v0 is the only arm.
      if (body.switch() !== 0) continue
      const v0 = body.v0()

      for (const topic of v0.topics() ?? []) {
        const code = contractErrorCodeFromScVal(topic)
        if (code !== undefined) return code
      }

      const code = contractErrorCodeFromScVal(v0.data())
      if (code !== undefined) return code
    } catch {
      // Skip an event we cannot read; another may still carry the code.
    }
  }
  return undefined
}

/** The result code name of one operation, reaching into `opInner` when set. */
function operationResultCode(op: xdr.OperationResult): string | undefined {
  try {
    const outer = op.switch().name
    if (outer !== 'opInner') return outer
    const tr = op.tr()
    // The arm value is the per-operation result union, whose switch carries
    // the code we want (`invokeHostFunctionTrapped`, …).
    const arm = tr.value() as { switch?: () => { name?: string } } | undefined
    return arm?.switch?.()?.name ?? tr.switch().name
  } catch {
    return undefined
  }
}

/** Transaction- and operation-level result codes, read off the typed XDR. */
export function transactionResultCodes(result: xdr.TransactionResult): {
  transactionCode?: string
  operationCodes: string[]
} {
  try {
    const body = result.result()
    const transactionCode = body.switch().name

    if (transactionCode === 'txFeeBumpInnerFailed') {
      const inner = body.innerResultPair().result().result()
      const innerCodes =
        inner.switch().name === 'txFailed'
          ? inner.results().flatMap((op) => operationResultCode(op) ?? [])
          : [inner.switch().name]
      return { transactionCode, operationCodes: innerCodes }
    }

    if (transactionCode === 'txFailed') {
      return {
        transactionCode,
        operationCodes: body.results().flatMap((op) => operationResultCode(op) ?? []),
      }
    }

    return { transactionCode, operationCodes: [] }
  } catch {
    return { operationCodes: [] }
  }
}

/**
 * Turn everything the RPC server said about a failure into one user-facing
 * verdict.
 *
 * Preference order is deliberate: the contract's own error code says the most
 * (and is the only thing that maps to an actionable message), a textual
 * `Error(Contract, N)` from an already-stringified error says the same thing,
 * and the result codes are the generic backstop.
 */
export function decodeTransactionFailure(input: {
  result?: ResultInput
  diagnosticEvents?: readonly DiagnosticInput[] | null | undefined
  /** Message to use when nothing decodable is present (never base64). */
  fallbackMessage?: string | undefined
}): DecodedTransactionFailure {
  const { transactionCode, operationCodes } = (() => {
    const result = toTransactionResult(input.result)
    return result ? transactionResultCodes(result) : { operationCodes: [] as string[] }
  })()

  const codes: Pick<DecodedTransactionFailure, 'transactionCode' | 'operationCodes'> = {
    ...(transactionCode ? { transactionCode } : {}),
    ...(operationCodes.length ? { operationCodes } : {}),
  }

  const contractErrorCode =
    contractErrorCodeFromDiagnosticEvents(input.diagnosticEvents) ??
    contractErrorCodeFromMessage(input.fallbackMessage)

  if (contractErrorCode !== undefined) {
    const deterministic = isDeterministicContractError(contractErrorCode)
    const retryRequirement = contractErrorRetryRequirement(contractErrorCode)
    return {
      ...codes,
      message: contractErrorMessage(contractErrorCode),
      contractErrorCode,
      deterministic,
      ...(deterministic && retryRequirement ? { retryRequirement } : {}),
    }
  }

  const fromOperation = operationCodes.map((code) => OPERATION_RESULT_MESSAGES[code]).find(Boolean)
  const fromTransaction = transactionCode ? TRANSACTION_RESULT_MESSAGES[transactionCode] : undefined
  const named = transactionCode
    ? `The network rejected the transaction (${[transactionCode, ...operationCodes].join(': ')}).`
    : undefined

  return {
    ...codes,
    message: fromOperation ?? fromTransaction ?? input.fallbackMessage ?? named ?? GENERIC_FAILURE,
    deterministic: false,
  }
}
