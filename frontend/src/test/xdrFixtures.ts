/**
 * Real XDR fixtures for transaction-failure tests.
 *
 * These are built with the SDK's own constructors and round-tripped through
 * base64, so a test that decodes them exercises exactly what the RPC server
 * hands the app. The previous mocks (`{ toXDR: () => 'Error(Contract, 7)' }`)
 * returned a debug-format literal that `xdr.TransactionResult.toXDR('base64')`
 * can never produce, which is why the dead decode path in
 * `transactionSubmission.ts` passed its tests for so long (issue #1160).
 */

import { xdr } from 'stellar-sdk'

/**
 * Build a js-xdr union whose arms are numbered rather than named
 * (`ContractEventBody`, `ExtensionPoint`, `TransactionResultExt`).
 *
 * js-xdr constructs these as `new Union(switchValue, arm)`, but the shipped
 * type declarations only expose a static `0(...)` factory that does not exist
 * at runtime — so the cast is what actually matches the SDK.
 */
function union<T>(
  ctor: abstract new (...args: never[]) => T,
  switchValue: number,
  arm?: unknown,
): T {
  const construct = ctor as unknown as new (switchValue: number, arm?: unknown) => T
  return new construct(switchValue, arm)
}

/** A `TransactionResult` whose single operation is the given host-function result. */
export function invokeHostFunctionResult(
  result: xdr.InvokeHostFunctionResult,
): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result: xdr.TransactionResultResult.txFailed([
      xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(result)),
    ]),
    ext: union<xdr.TransactionResultExt>(xdr.TransactionResultExt, 0),
  })
}

/**
 * What the network returns when a contract panics: the transaction failed and
 * the host function trapped. The contract's own error code is *not* here — it
 * travels in the diagnostic events.
 */
export function trappedTransactionResult(): xdr.TransactionResult {
  return invokeHostFunctionResult(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped())
}

/** A transaction-level rejection, e.g. `txInsufficientFee`. */
export function transactionLevelResult(result: xdr.TransactionResultResult): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result,
    ext: union<xdr.TransactionResultExt>(xdr.TransactionResultExt, 0),
  })
}

/** A diagnostic event with the given topics and payload. */
export function diagnosticEvent(
  topics: xdr.ScVal[],
  data: xdr.ScVal = xdr.ScVal.scvVoid(),
): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: union<xdr.ExtensionPoint>(xdr.ExtensionPoint, 0),
      contractId: Buffer.alloc(32),
      type: xdr.ContractEventType.diagnostic(),
      body: union<xdr.ContractEventBody>(
        xdr.ContractEventBody,
        0,
        new xdr.ContractEventV0({ topics, data }),
      ),
    }),
  })
}

/**
 * The diagnostic event the Soroban host emits when a contract returns
 * `Error::<Variant>`: topics `("error", <ScError>)` with the panic message as
 * the payload. This — not the transaction result — is where the contract's own
 * error code lives.
 */
export function contractErrorDiagnosticEvent(code: number): xdr.DiagnosticEvent {
  return diagnosticEvent(
    [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
    xdr.ScVal.scvString('escalating error to VM trap from failed host function call'),
  )
}

/** A diagnostic event carrying no error at all — the "nothing to decode" case. */
export function plainDiagnosticEvent(): xdr.DiagnosticEvent {
  return diagnosticEvent([xdr.ScVal.scvSymbol('fn_call')], xdr.ScVal.scvString('mint_tokens'))
}

/**
 * Round-trip through the wire format, so tests decode an object parsed from
 * base64 exactly as the RPC client produces it — never a hand-built one that
 * might happen to carry extra state.
 */
export function roundTripResult(result: xdr.TransactionResult): xdr.TransactionResult {
  return xdr.TransactionResult.fromXDR(result.toXDR('base64'), 'base64')
}

export function roundTripEvent(event: xdr.DiagnosticEvent): xdr.DiagnosticEvent {
  return xdr.DiagnosticEvent.fromXDR(event.toXDR('base64'), 'base64')
}
