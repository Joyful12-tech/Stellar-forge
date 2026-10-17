/**
 * Decoding tests for real, ledger-included transaction failures.
 *
 * Every fixture here is built with the SDK's own XDR constructors and
 * round-tripped through base64, so these tests fail if the code goes back to
 * re-serialising a parsed result instead of reading it (issue #1160).
 */

import { describe, it, expect } from 'vitest'
import { xdr } from 'stellar-sdk'
import {
  contractErrorCodeFromDiagnosticEvents,
  decodeTransactionFailure,
  transactionResultCodes,
} from './transactionResult'
import { CONTRACT_ERROR_MESSAGES } from './contractErrors'
import {
  contractErrorDiagnosticEvent,
  diagnosticEvent,
  invokeHostFunctionResult,
  plainDiagnosticEvent,
  roundTripEvent,
  roundTripResult,
  transactionLevelResult,
  trappedTransactionResult,
} from '../test/xdrFixtures'

/** The base64 a `toXDR('base64')` call would have produced for this result. */
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/

describe('transactionResultCodes', () => {
  it('reads the transaction and operation result codes off a parsed result', () => {
    expect(transactionResultCodes(roundTripResult(trappedTransactionResult()))).toEqual({
      transactionCode: 'txFailed',
      operationCodes: ['invokeHostFunctionTrapped'],
    })
  })

  it('reads a transaction-level rejection with no operation results', () => {
    const result = roundTripResult(
      transactionLevelResult(xdr.TransactionResultResult.txInsufficientFee()),
    )
    expect(transactionResultCodes(result)).toEqual({
      transactionCode: 'txInsufficientFee',
      operationCodes: [],
    })
  })
})

describe('contractErrorCodeFromDiagnosticEvents', () => {
  it('extracts the contract error code from a real diagnostic event', () => {
    const events = [roundTripEvent(contractErrorDiagnosticEvent(16))]
    expect(contractErrorCodeFromDiagnosticEvents(events)).toBe(16)
  })

  it('accepts base64 diagnostic events as well as parsed ones', () => {
    const events = [contractErrorDiagnosticEvent(10).toXDR('base64')]
    expect(contractErrorCodeFromDiagnosticEvents(events)).toBe(10)
  })

  it('skips events that carry no error', () => {
    expect(
      contractErrorCodeFromDiagnosticEvents([
        roundTripEvent(plainDiagnosticEvent()),
        roundTripEvent(contractErrorDiagnosticEvent(20)),
      ]),
    ).toBe(20)
  })

  it('returns undefined when nothing carries a contract error', () => {
    expect(contractErrorCodeFromDiagnosticEvents([roundTripEvent(plainDiagnosticEvent())])).toBe(
      undefined,
    )
    expect(contractErrorCodeFromDiagnosticEvents([])).toBe(undefined)
    expect(contractErrorCodeFromDiagnosticEvents(undefined)).toBe(undefined)
  })

  it('ignores a non-contract host error (wasm/budget/auth)', () => {
    const hostError = diagnosticEvent([
      xdr.ScVal.scvSymbol('error'),
      xdr.ScVal.scvError(xdr.ScError.sceBudget(xdr.ScErrorCode.scecExceededLimit())),
    ])

    expect(contractErrorCodeFromDiagnosticEvents([roundTripEvent(hostError)])).toBe(undefined)
  })

  it('finds a contract error nested inside an event payload', () => {
    const nested = diagnosticEvent(
      [xdr.ScVal.scvSymbol('error')],
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('mint_tokens'),
        xdr.ScVal.scvError(xdr.ScError.sceContract(16)),
      ]),
    )

    expect(contractErrorCodeFromDiagnosticEvents([roundTripEvent(nested)])).toBe(16)
  })

  it('survives a malformed base64 event without throwing', () => {
    expect(contractErrorCodeFromDiagnosticEvents(['not-valid-xdr', null])).toBe(undefined)
  })
})

describe('decodeTransactionFailure', () => {
  it('surfaces the mapped message for a real MaxSupplyExceeded rejection', () => {
    // What the RPC server actually returns for a mint over the cap: the result
    // says the host function trapped, and the code is in the diagnostics.
    const decoded = decodeTransactionFailure({
      result: roundTripResult(trappedTransactionResult()),
      diagnosticEvents: [roundTripEvent(contractErrorDiagnosticEvent(16))],
    })

    expect(decoded.message).toBe(CONTRACT_ERROR_MESSAGES[16])
    expect(decoded.message).toMatch(/maximum supply/i)
    expect(decoded.contractErrorCode).toBe(16)
    expect(decoded.transactionCode).toBe('txFailed')
    expect(decoded.operationCodes).toEqual(['invokeHostFunctionTrapped'])
    // Minting over the cap again cannot succeed — no blind retry.
    expect(decoded.deterministic).toBe(true)
    expect(decoded.retryRequirement).toMatch(/maximum supply/i)
    expect(decoded.message).not.toMatch(BASE64)
  })

  it.each([
    [1, /fee/i],
    [10, /paused/i],
    [20, /whitelist/i],
  ])('maps contract error %i to its actionable message', (code, expected) => {
    const decoded = decodeTransactionFailure({
      result: roundTripResult(trappedTransactionResult()),
      diagnosticEvents: [roundTripEvent(contractErrorDiagnosticEvent(code))],
    })

    expect(decoded.message).toBe(CONTRACT_ERROR_MESSAGES[code])
    expect(decoded.message).toMatch(expected)
    expect(decoded.deterministic).toBe(true)
    expect(decoded.retryRequirement).toBeTruthy()
  })

  it('treats the contract lock error as retryable rather than deterministic', () => {
    const decoded = decodeTransactionFailure({
      result: roundTripResult(trappedTransactionResult()),
      diagnosticEvents: [roundTripEvent(contractErrorDiagnosticEvent(11))],
    })

    expect(decoded.contractErrorCode).toBe(11)
    expect(decoded.deterministic).toBe(false)
    expect(decoded.retryRequirement).toBeUndefined()
  })

  it('names an unknown contract code instead of showing XDR', () => {
    const decoded = decodeTransactionFailure({
      result: roundTripResult(trappedTransactionResult()),
      diagnosticEvents: [roundTripEvent(contractErrorDiagnosticEvent(99))],
    })

    expect(decoded.message).toContain('99')
    // An unrecognised code may be a future transient one — never withhold the
    // retry on a guess.
    expect(decoded.deterministic).toBe(false)
  })

  it('describes a trapped call with no diagnostics in words, not base64', () => {
    const decoded = decodeTransactionFailure({
      result: roundTripResult(trappedTransactionResult()),
    })

    expect(decoded.message).toMatch(/contract rejected the call/i)
    expect(decoded.message).not.toMatch(BASE64)
    expect(decoded.deterministic).toBe(false)
  })

  it('describes transaction-level rejections', () => {
    const decoded = decodeTransactionFailure({
      result: transactionLevelResult(xdr.TransactionResultResult.txInsufficientFee()).toXDR(
        'base64',
      ),
    })

    expect(decoded.transactionCode).toBe('txInsufficientFee')
    expect(decoded.message).toMatch(/higher fee/i)
  })

  it('describes archived contract data', () => {
    const decoded = decodeTransactionFailure({
      result: roundTripResult(
        invokeHostFunctionResult(xdr.InvokeHostFunctionResult.invokeHostFunctionEntryArchived()),
      ),
    })

    expect(decoded.message).toMatch(/archived/i)
  })

  it('reads a contract code out of an already-stringified error message', () => {
    const decoded = decodeTransactionFailure({
      fallbackMessage: 'HostError: Error(Contract, 10)',
    })

    expect(decoded.contractErrorCode).toBe(10)
    expect(decoded.message).toBe(CONTRACT_ERROR_MESSAGES[10])
    expect(decoded.deterministic).toBe(true)
  })

  it('leaves an unrelated message untouched', () => {
    const decoded = decodeTransactionFailure({ fallbackMessage: 'Insufficient funds' })

    expect(decoded.message).toBe('Insufficient funds')
    expect(decoded.deterministic).toBe(false)
  })

  it('falls back to a generic message when there is nothing to decode', () => {
    const decoded = decodeTransactionFailure({})

    expect(decoded.message).toBe('The network rejected the transaction')
    expect(decoded.deterministic).toBe(false)
  })

  it('does not throw on an unparseable result blob', () => {
    const decoded = decodeTransactionFailure({
      result: 'definitely-not-xdr',
      fallbackMessage: 'Transaction failed: abc',
    })

    expect(decoded.message).toBe('Transaction failed: abc')
  })
})
