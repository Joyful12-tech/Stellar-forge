/**
 * Maps Soroban contract error codes to user-friendly messages.
 * Codes correspond to the Error enum in the token-factory contract.
 */
export const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: 'Insufficient fee payment. Please increase the fee amount.',
  2: 'Unauthorized. You do not have permission to perform this action.',
  3: 'Invalid parameters provided.',
  4: 'Token not found.',
  5: 'Metadata has already been set for this token.',
  6: 'Contract is already initialized.',
  7: 'Burn amount exceeds your token balance.',
  8: 'Burning is not enabled for this token.',
  9: 'Invalid burn amount. Must be greater than zero.',
  10: 'Contract is paused. Please try again later.',
  11: 'A concurrent operation is in progress. Please try again in a moment.',
  12: 'Arithmetic overflow. One of the amounts provided is too large.',
  13: 'Contract state not found. The factory may not be initialized.',
  // Fault classes below are normalized to one code each across both the
  // single (`create_token`) and batch (`create_tokens_batch`) creation paths.
  14: 'Invalid token name or symbol. Name must be 1–32 and symbol 1–12 characters.',
  15: 'Invalid decimals. Must be between 0 and 18.',
  16: 'Mint would exceed the token’s maximum supply.',
  17: 'Invalid fee split. The basis points must sum to 10,000.',
  18: 'Too many fee split recipients.',
  19: 'Supply back-fill has already been applied to this token.',
  20: 'Your address is not on the whitelist for token creation.',
  21: 'Invalid metadata URI. It must be a non-empty ipfs:// URI within the length limit.',
  22: 'Fee split contains a recipient with a zero share.',
  23: 'Metadata is frozen and can no longer be updated.',
  // Codes 24–27 introduced with schema version 4 (issue #1164 — previously
  // colliding at discriminant 24; each now has a unique wire value).
  24: 'A fee transfer to the treasury failed. The transaction cannot proceed.',
  25: 'Batch size exceeds the maximum allowed (20 tokens per batch).',
  26: 'No pending admin proposal found, or the caller is not the proposed address.',
  27: 'The pending admin proposal has expired. The current admin must open a new proposal.',
}

/**
 * What has to change before resubmitting the same call could succeed.
 *
 * Every entry here describes a *deterministic* rejection: the contract will
 * reach the same verdict for the same inputs, so a one-click "try again" only
 * pays the network fee a second time for a transaction that cannot pass. The
 * UI surfaces these next to the error instead of a blind retry button.
 */
export const CONTRACT_ERROR_REQUIREMENTS: Record<number, string> = {
  1: 'Send at least the factory’s current creation fee with the call.',
  2: 'Sign with the account that administers this token or factory.',
  3: 'Correct the parameters before submitting again.',
  4: 'Use a token address that exists on this network.',
  5: 'Metadata can only be set once — deploy a new token to change it.',
  6: 'The factory is already initialized; no further initialization is possible.',
  7: 'Burn an amount at or below your current balance.',
  8: 'Burning is disabled for this token and cannot be enabled after deployment.',
  9: 'Enter a burn amount greater than zero.',
  10: 'An administrator has to unpause the factory before this call can succeed.',
  12: 'Use a smaller amount — the current one overflows the contract’s arithmetic.',
  13: 'The factory has to be initialized before this call can succeed.',
  14: 'Use a name of 1–32 characters and a symbol of 1–12 characters.',
  15: 'Use a decimals value between 0 and 18.',
  16: 'Mint an amount that keeps total supply at or below the token’s maximum supply.',
  17: 'Adjust the fee split so the basis points sum to exactly 10,000.',
  18: 'Reduce the number of fee split recipients.',
  19: 'The supply back-fill has already been applied and cannot run twice.',
  20: 'An administrator has to add your address to the creation whitelist.',
  21: 'Provide a non-empty ipfs:// metadata URI within the length limit.',
  22: 'Remove the fee split recipient with a zero share.',
  23: 'Metadata is frozen for this token and can no longer be updated.',
  24: 'Check the treasury address configuration — the fee payment could not be routed.',
  25: 'Reduce the batch to 20 tokens or fewer and resubmit.',
  26: 'Start a new admin proposal with propose_admin before calling accept_admin.',
  27: 'The proposal window has lapsed. The current admin must call propose_admin again.',
}

/**
 * Contract errors that a plain resubmission can clear on its own. Code 11 is
 * the contract's re-entrancy/lock guard, which releases when the concurrent
 * call finishes — everything else needs a changed input or changed on-chain
 * state first.
 */
const TRANSIENT_CONTRACT_ERRORS = new Set<number>([11])

/**
 * True when resubmitting the identical call must fail the same way. Unknown
 * codes are treated as non-deterministic so a future contract error is never
 * wrongly presented as un-retryable.
 */
export function isDeterministicContractError(code: number): boolean {
  return code in CONTRACT_ERROR_MESSAGES && !TRANSIENT_CONTRACT_ERRORS.has(code)
}

/** The mapped message for a code, or a generic one naming the code. */
export function contractErrorMessage(code: number): string {
  return CONTRACT_ERROR_MESSAGES[code] ?? `An unexpected contract error occurred (code ${code}).`
}

/** The "what has to change" hint for a code, when one is known. */
export function contractErrorRetryRequirement(code: number): string | undefined {
  return CONTRACT_ERROR_REQUIREMENTS[code]
}

/**
 * The contract error code named by an already-stringified error — either the
 * raw Soroban rendering (`HostError: Error(Contract, 16)`, which is what a
 * simulation error carries) or a message this module has already mapped.
 *
 * This is only ever a *textual* match: a parsed `xdr.TransactionResult` never
 * contains either shape, so it must not be relied on for ledger-included
 * failures. Those go through `decodeTransactionFailure` in
 * `utils/transactionResult.ts`.
 */
export function contractErrorCodeFromMessage(message: string | undefined): number | undefined {
  if (!message) return undefined

  const match = message.match(CONTRACT_ERROR_PATTERN)
  if (match?.[1]) {
    const code = parseInt(match[1], 10)
    if (!Number.isNaN(code)) return code
  }

  return MESSAGE_TO_CODE.get(message)
}

/** How Soroban renders a contract error inside a human-readable string. */
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*(\d+)\)/

/**
 * Reverse of {@link CONTRACT_ERROR_MESSAGES}, so a message that has already
 * been mapped once (a simulation error surfaced through
 * {@link parseContractError}) can still be recognised as the contract
 * rejection it is, and gated against a blind retry.
 */
const MESSAGE_TO_CODE = new Map<string, number>(
  Object.entries(CONTRACT_ERROR_MESSAGES).map(([code, message]) => [message, Number(code)]),
)

/**
 * Parses a raw contract error into a human-readable Error.
 * Soroban contract errors surface as "Error(Contract, X)" in result XDR.
 * Unknown codes fall back to a generic message.
 */
export function parseContractError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)

  // User rejected the transaction in Freighter
  if (
    msg.toLowerCase().includes('user declined') ||
    msg.toLowerCase().includes('user rejected') ||
    msg.toLowerCase().includes('rejected by user')
  ) {
    return new Error('Transaction rejected. You declined the signing request in your wallet.')
  }

  // Insufficient XLM to cover fees
  if (
    msg.toLowerCase().includes('insufficient') ||
    msg.toLowerCase().includes('op_underfunded') ||
    msg.toLowerCase().includes('balance')
  ) {
    return new Error('Insufficient funds. Your XLM balance is too low to cover this transaction.')
  }

  // Rate limiting / 429
  if (
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('too many requests') ||
    msg.toLowerCase().includes('http error 429') ||
    msg.toLowerCase().includes('status 429')
  ) {
    return new Error(
      'The server is currently rate-limiting requests. Please wait a moment and try again. ' +
        'If this persists, consider using a dedicated RPC provider.',
    )
  }

  // Network / RPC timeout
  if (
    msg.toLowerCase().includes('timeout') ||
    msg.toLowerCase().includes('timed out') ||
    msg.toLowerCase().includes('network')
  ) {
    return new Error('Network timeout. The Stellar network did not respond in time. Please retry.')
  }

  const code = contractErrorCodeFromMessage(msg)
  if (code !== undefined) return new Error(contractErrorMessage(code))

  if (msg.includes('simulation')) return new Error(`Simulation failed: ${msg}`)

  return err instanceof Error ? err : new Error(msg)
}
