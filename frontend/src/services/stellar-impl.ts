// Stellar SDK integration service
import { STELLAR_CONFIG, NETWORK_CONFIGS } from '../config/stellar'
import { walletService } from './wallet'
import { captureContractError, type ContractErrorContext } from '../lib/monitoring/sentry'
import type {
  AppError,
  ContractEvent,
  ContractEventType,
  DeploymentResult,
  FactoryState,
  GetEventsResult,
  TokenEventsResult,
  TokenInfo,
  TokenInfoResult,
} from '../types'
import {
  Account,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
  FeeBumpTransaction,
  Transaction,
  StrKey,
} from 'stellar-sdk'
import type { Network } from '../config/stellar'
import { withRetry, HttpError } from '../utils/retry'
import { fetchAllContractEvents } from '../utils/fetchAllContractEvents'
import { parseContractError } from '../utils/contractErrors'
import { contractErrorCodeFromScVal } from '../utils/transactionResult'
import {
  submitAndConfirm,
  TransactionSubmissionError,
  type SubmitAndConfirmResult,
  type SubmitOptions,
  type TransactionLifecycleStatus,
} from './transactionSubmission'

export {
  TransactionSubmissionError,
  type TransactionFailureStatus,
  type TransactionLifecycleStatus,
} from './transactionSubmission'

export type { FactoryState } from '../types'

// ── Utilities ─────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Invalid WASM hash: expected exactly 64 hex characters, got "${hex}"`)
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Lowercase hex, the form `stellar contract install` and explorers print. */
function bytesToHex(bytes: Iterable<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Build the retryable {@link HttpError} for a non-OK Horizon/RPC response. */
function httpErrorFromResponse(res: Response, message: string): HttpError {
  const retryAfter = res.headers.get('Retry-After')
  return new HttpError(res.status, message, retryAfter ? parseInt(retryAfter, 10) : undefined)
}

function requireFactoryContractId(): string {
  const contractId = STELLAR_CONFIG.factoryContractId
  if (!contractId) throw new Error('Factory contract ID is not configured')
  return contractId
}

function requireConnectedAddress(): string {
  const sourceAddress = walletService.getConnectedAddress()
  if (!sourceAddress) throw new Error('Wallet not connected')
  return sourceAddress
}

/**
 * Encode a Rust `Option<i128>` contract argument.
 *
 * Soroban does not represent `Option<T>` as a tagged union on the wire: `None`
 * is the plain `Void` ScVal and `Some(v)` is the inner value *itself*, with no
 * wrapper (see soroban-env-common's `TryFromVal<E, Option<T>> for Val`, which
 * returns `Val::VOID` for `None` and `t.try_into_val(env)` for `Some`).
 * Wrapping the value in a `["Some", v]` vector — the encoding used for
 * `#[contracttype]` enum variants — makes the host's `Option` decode fail,
 * because a non-void value is handed straight to `i128`'s converter.
 *
 * `null`, `undefined` and `''` all encode as `None`.
 */
function optionI128(value: string | null | undefined): xdr.ScVal {
  if (value === null || value === undefined || value === '') {
    return xdr.ScVal.scvVoid()
  }
  return nativeToScVal(BigInt(value), { type: 'i128' })
}

/** Convert a raw error into the project's AppError shape. */
function toAppError(err: unknown): AppError {
  const parsed = parseContractError(err)
  return { code: 'CONTRACT_ERROR', message: parsed.message }
}

/**
 * Map a raw error to the one thrown to callers.
 *
 * A {@link TransactionSubmissionError} is passed through unchanged: its message
 * is already user-facing and, crucially, its `status`/`safeToRetry` fields tell
 * the UI whether re-signing could double-execute the call. Flattening it into a
 * plain `Error` (as every write path used to) discarded exactly that.
 */
function toUserFacingError(err: unknown): Error {
  if (err instanceof TransactionSubmissionError) return err
  return new Error(toAppError(err).message)
}

/**
 * Default page size for `getAllTokens` when a caller does not specify one.
 * Mirrors the Token Explorer / dashboard default so the first page maps to a
 * single index-range fetch.
 */
const DEFAULT_TOKEN_PAGE_LIMIT = 10

/**
 * Maximum number of `get_token_info` view calls kept in flight at once while
 * assembling one page of the global token list. The SDF publishes no static
 * RPC rate limit and throttles dynamically (see docs/rpc-rate-limits.md), so
 * we stay deliberately conservative — a single page never bursts more than
 * this many simultaneous simulations at the endpoint.
 */
const GET_ALL_TOKENS_CONCURRENCY = 5

/**
 * Resolve `tasks` with at most `limit` running concurrently, preserving input
 * order. Uses `Promise.allSettled` semantics: every task settles and the
 * caller decides how to treat rejections, so one failing index read never
 * rejects the whole batch.
 */
async function allSettledWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]!() }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, tasks.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

// ── Network helpers ───────────────────────────────────────────────────────────

function getNetworkConfig(network: Network) {
  return NETWORK_CONFIGS[network]
}

function getNetworkPassphrase(network: Network): string {
  if (network === 'mainnet') return Networks.PUBLIC
  if (network === 'testnet') return Networks.TESTNET
  return NETWORK_CONFIGS[network].networkPassphrase
}

function getRpcServer(network: Network): rpc.Server {
  return new rpc.Server(getNetworkConfig(network).sorobanRpcUrl, { allowHttp: false })
}

// ── Transaction lifecycle ─────────────────────────────────────────────────────

/**
 * Simulate, sign via Freighter, submit, and wait for a definitive verdict.
 * Returns the transaction hash on confirmed inclusion.
 *
 * Simulation is wrapped with retry logic so that transient failures (including
 * 429 rate-limit responses) are handled with exponential backoff. Submission
 * and inclusion tracking are delegated to `transactionSubmission`, which gives
 * every `sendTransaction` status its own path and rejects with a typed
 * {@link TransactionSubmissionError} (`dropped` / `expired` / `failed` /
 * `unconfirmed`) instead of a generic attempt-count timeout.
 */
async function simulateAndSubmitDetailed(
  server: rpc.Server,
  tx: ReturnType<TransactionBuilder['build']>,
  network: Network,
  onStatus?: (status: TransactionLifecycleStatus) => void,
): Promise<SubmitAndConfirmResult> {
  const simResult = await withRetry(() => server.simulateTransaction(tx))

  if (rpc.Api.isSimulationError(simResult)) {
    throw parseContractError(new Error(simResult.error))
  }
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error('Transaction simulation returned an unexpected result')
  }

  const assembled = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await walletService.signTransaction(assembled.toXDR(), network)
  const signedTx = TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase(network))

  const options: SubmitOptions = onStatus ? { onStatus } : {}
  return submitAndConfirm(server, signedTx, options)
}

/** Result selector for write calls whose callers only need the hash. */
const selectHash = ({ hash }: SubmitAndConfirmResult): string => hash

// ── Fee Bump Transactions ─────────────────────────────────────────────────────

/**
 * Wrap a signed inner transaction in a fee bump envelope.
 * The fee-source account (connected via Freighter) signs the bump.
 */
export async function buildFeeBumpTransaction(
  innerTxXdr: string,
  feeSource: string,
  network: Network,
  baseFee: string = String(Number(BASE_FEE) * 10),
): Promise<string> {
  const networkPassphrase = getNetworkPassphrase(network)
  const innerTx = TransactionBuilder.fromXDR(innerTxXdr, networkPassphrase) as Transaction
  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    baseFee,
    innerTx,
    networkPassphrase,
  )
  return walletService.signTransaction(feeBumpTx.toXDR(), network)
}

/**
 * Submit a signed fee bump transaction and wait for a definitive verdict.
 *
 * Shares the submission path with `simulateAndSubmit`, so a fee bump gets the
 * same explicit handling of every `sendTransaction` status — including
 * TRY_AGAIN_LATER resubmission of the identical signed envelope — and the same
 * timebounds-derived expiry verdict (read from the inner transaction).
 */
export async function submitFeeBumpTransaction(
  signedFeeBumpXdr: string,
  network: Network,
  onStatus?: (status: TransactionLifecycleStatus) => void,
): Promise<string> {
  const server = getRpcServer(network)
  const feeBumpTx = TransactionBuilder.fromXDR(
    signedFeeBumpXdr,
    getNetworkPassphrase(network),
  ) as FeeBumpTransaction

  const options: SubmitOptions = onStatus ? { onStatus } : {}
  const { hash } = await submitAndConfirm(server, feeBumpTx, options)
  return hash
}

// ── Shared builder helper ─────────────────────────────────────────────────────

async function buildTxBuilder(
  server: rpc.Server,
  sourceAddress: string,
  network: Network,
): Promise<TransactionBuilder> {
  const account = await withRetry(() => server.getAccount(sourceAddress))
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(network),
  })
}

// ── View function helper ──────────────────────────────────────────────────────

/** Simulate `method` from `account` and return its return value. */
async function simulateView(
  server: rpc.Server,
  account: Account,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  network: Network,
): Promise<xdr.ScVal> {
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(network),
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build()

  const simResult = await withRetry(() => server.simulateTransaction(tx))
  if (rpc.Api.isSimulationError(simResult)) {
    throw parseContractError(new Error(simResult.error))
  }
  if (!rpc.Api.isSimulationSuccess(simResult) || !simResult.result) {
    throw new Error(`View call to ${method} returned no result`)
  }
  return simResult.result.retval
}

/**
 * Call a read-only contract function via simulation (no signing required).
 */
async function callView(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  network: Network,
): Promise<xdr.ScVal> {
  const account = await withRetry(() => server.getAccount(sourceAddress))
  return simulateView(server, account, contractId, method, args, network)
}

/**
 * Approximate window (in days) that public Soroban RPC infrastructure retains
 * contract events for. `getEvents` cannot return events older than this, so any
 * event-derived history is inherently partial and must be disclosed as such
 * rather than presented as a token's complete lifetime. See
 * `docs/rpc-rate-limits.md` for the retention constraint.
 */
export const RPC_EVENT_RETENTION_DAYS = 7

/**
 * Placeholder source account for read-only view simulations. Soroban's
 * `simulateTransaction` does not require the source account to exist or be
 * funded for invocations that require no authorization, so token identity can
 * be resolved without a connected wallet. This is the canonical all-zero
 * ed25519 account (`StrKey.encodeEd25519PublicKey(new Uint8Array(32))`), a
 * valid — if unfunded — StrKey, hardcoded to avoid a Buffer dependency.
 */
const READONLY_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

/**
 * Call a read-only contract view via simulation without requiring a connected
 * wallet. Unlike {@link callView}, the source account is not fetched from the
 * network (a placeholder is used) so anonymous page loads can resolve token
 * data. The connected wallet address is used when available so simulations are
 * attributed to a real account, but it is never required.
 */
async function callViewReadonly(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  network: Network,
): Promise<xdr.ScVal> {
  const source = walletService.getConnectedAddress() ?? READONLY_SOURCE_ACCOUNT
  // Sequence number is irrelevant for a read-only simulation; a locally
  // constructed account avoids an extra `getAccount` round-trip and works even
  // when `source` has never been funded on-chain.
  const account = new Account(source, '0')
  return simulateView(server, account, contractId, method, args, network)
}

// ── Raw RPC types ─────────────────────────────────────────────────────────────

export interface RpcEventResponse {
  id: string
  type: string
  ledger: number
  ledgerClosedAt: string
  contractId: string
  pagingToken: string
  inSuccessfulContractCall: boolean
  txHash: string
  topic: string[]
  value: string
}

interface RpcGetEventsResult {
  events: RpcEventResponse[]
  latestLedger: number
}

// ── XDR decode helper ─────────────────────────────────────────────────────────

function scValToString(val: xdr.ScVal | undefined): string {
  if (!val) return ''
  try {
    const type = val.switch()
    if (type === xdr.ScValType.scvAddress()) {
      const addr = val.address()
      if (addr.switch() === xdr.ScAddressType.scAddressTypeAccount()) {
        return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519())
      }
      return bytesToHex(addr.contractId() as Uint8Array)
    }
    if (type === xdr.ScValType.scvI128()) {
      const hi = BigInt(val.i128().hi().toString())
      const lo = BigInt(val.i128().lo().toString())
      return ((hi << 64n) | lo).toString()
    }
    if (type === xdr.ScValType.scvU64()) return val.u64().toString()
    if (type === xdr.ScValType.scvString()) return val.str().toString()
    if (type === xdr.ScValType.scvSymbol()) return val.sym().toString()
    if (type === xdr.ScValType.scvBool()) return val.b().toString()
    if (type === xdr.ScValType.scvVoid()) return 'none'
    if (type === xdr.ScValType.scvVec()) {
      return (val.vec() ?? []).map((v) => scValToString(v)).join(', ')
    }
    // BytesN<N> payloads (WASM hashes, salts) are identifiers operators compare
    // against `stellar contract install` output and explorer pages, both of
    // which print lowercase hex. Base64 would be unrecognisable there.
    if (type === xdr.ScValType.scvBytes()) {
      return bytesToHex(val.bytes() as unknown as Uint8Array)
    }
    // An error value in an event payload is readable data, not an opaque blob:
    // render the contract code rather than re-serialising it to base64.
    if (type === xdr.ScValType.scvError()) {
      const code = contractErrorCodeFromScVal(val)
      if (code !== undefined) return `Error(Contract, ${code})`
      return val.error().switch().name
    }
    // Last resort for a value type this helper does not model. Not an error
    // path — nothing here is shown to a user as a failure reason.
    return val.toXDR('base64')
  } catch {
    return ''
  }
}

// ── Event parsing ─────────────────────────────────────────────────────────────

/**
 * Single source of truth that maps every contract symbol_short! topic value to
 * its ContractEventType.  The allow-list and the parser both derive from this
 * table, so they can never drift apart.
 *
 * Contract topics are verified against lib.rs symbol_short! calls by
 * scripts/check-event-topic-drift.sh (CI).  If you add a new event to the
 * contract, add it here first — the CI script will catch any omission.
 *
 * `meta_frz`, `split_set` and `split_clr` are privileged mutations that the
 * contract has always emitted but the frontend used to drop on the floor,
 * leaving holes in the audit trail this table is supposed to reconstruct
 * (issue #917).
 *
 * Admin rotation is two-step, so there is no single `adm_upd` topic: the
 * contract emits `adm_prop` when a rotation is proposed, `adm_acc` when the
 * proposed admin accepts it, and `adm_can` when the current admin cancels a
 * pending proposal.  `adm_dep` rides alongside `adm_prop` when the proposal
 * came from the deprecated `transfer_admin` / `update_admin` aliases.
 *
 * Contract upgrades are two-step and timelocked (issue #6), so they emit three
 * topics rather than one: `upg_prop` (hash proposed, with the ledger it becomes
 * executable), `upg_exec` (WASM actually swapped) and `upg_can` (proposal
 * withdrawn). Only `upg_exec` means the deployed code changed.
 *
 * Audit of all twenty-two contract topics (lib.rs → frontend):
 *   init      → 'init'      (factory init)
 *   created   → 'created'   (token deployed)
 *   meta      → 'meta'      (metadata URI set)
 *   meta_frz  → 'meta_frz'  (metadata frozen)
 *   mint      → 'mint'      (tokens minted)
 *   burn      → 'burn'      (tokens burned)
 *   fees      → 'fees'      (fees updated)
 *   fee_redir → 'fee_redir' (fee share redirected to treasury)
 *   split_set → 'split_set' (fee split configured)
 *   split_clr → 'split_clr' (fee split cleared)
 *   pause     → 'pause'     (factory paused)
 *   unpause   → 'unpause'   (factory unpaused)
 *   adm_prop  → 'adm_prop'  (admin rotation proposed)
 *   adm_acc   → 'adm_acc'   (admin rotation accepted — admin changed)
 *   adm_can   → 'adm_can'   (pending admin rotation cancelled)
 *   adm_dep   → 'adm_dep'   (rotation proposed via a deprecated alias)
 *   wl_add    → 'wl_add'   (address added to whitelist)
 *   wl_rm     → 'wl_rm'    (address removed from whitelist)
 *   wl_tog    → 'wl_tog'   (whitelist enforcement toggled)
 *   upg_prop  → 'upg_prop' (upgrade proposed — timelock started)
 *   upg_exec  → 'upg_exec' (upgrade executed — factory WASM swapped)
 *   upg_can   → 'upg_can'  (pending upgrade proposal cancelled)
 */
export const CONTRACT_TOPIC_MAP: Record<string, ContractEventType> = {
  init: 'init',
  created: 'created',
  meta: 'meta',
  meta_frz: 'meta_frz',
  mint: 'mint',
  burn: 'burn',
  fees: 'fees',
  fee_redir: 'fee_redir',
  split_set: 'split_set',
  split_clr: 'split_clr',
  pause: 'pause',
  unpause: 'unpause',
  adm_prop: 'adm_prop',
  adm_acc: 'adm_acc',
  adm_can: 'adm_can',
  adm_dep: 'adm_dep',
  wl_add: 'wl_add',
  wl_rm: 'wl_rm',
  wl_tog: 'wl_tog',
  upg_prop: 'upg_prop',
  upg_exec: 'upg_exec',
  upg_can: 'upg_can',
} as const

/** Allow-list of recognised event types, derived from CONTRACT_TOPIC_MAP. */
const EVENT_TOPICS = new Set<string>(Object.keys(CONTRACT_TOPIC_MAP))

/**
 * Names for each event's positional payload values, in contract emit order.
 * An empty list means the payload is not decoded into `data`.
 */
const EVENT_PAYLOAD_FIELDS: Record<ContractEventType, readonly string[]> = {
  init: ['admin'],
  created: ['tokenAddress', 'creator', 'name', 'symbol'],
  meta: ['tokenAddress', 'metadataUri'],
  meta_frz: [],
  mint: ['tokenAddress', 'to', 'amount'],
  burn: ['tokenAddress', 'from', 'amount'],
  fees: ['baseFee', 'metadataFee'],
  fee_redir: ['recipient', 'amount'],
  split_set: [],
  split_clr: [],
  pause: ['admin'],
  unpause: ['admin'],
  adm_prop: ['currentAdmin', 'newAdmin', 'expiryLedger'],
  adm_acc: ['currentAdmin', 'newAdmin'],
  adm_can: ['currentAdmin', 'cancelledAdmin'],
  // `deprecatedEntrypoint` is the deprecated entrypoint the caller used —
  // `transfer_admin` or `update_admin`. Neither completes the rotation;
  // `accept_admin` must still be called before `expiryLedger`.
  adm_dep: ['currentAdmin', 'newAdmin', 'expiryLedger', 'deprecatedEntrypoint'],
  wl_add: ['address'],
  wl_rm: ['address'],
  wl_tog: ['enabled'],
  // The upgrade cannot be executed before `readyAtLedger`. Surfacing it is the
  // point of the timelock — it is the window in which the proposal can still
  // be cancelled.
  upg_prop: ['admin', 'wasmHash', 'readyAtLedger'],
  upg_exec: ['admin', 'wasmHash'],
  upg_can: ['admin', 'cancelledWasmHash'],
}

export async function parseRpcEvent(raw: RpcEventResponse): Promise<ContractEvent | null> {
  try {
    if (!raw.topic?.length || raw.topic.length < 2) return null
    const topicVal = xdr.ScVal.fromXDR(raw.topic[1]!, 'base64') // second topic is the action
    const rawTopic = scValToString(topicVal)
    if (!EVENT_TOPICS.has(rawTopic)) return null
    const eventType = CONTRACT_TOPIC_MAP[rawTopic]!

    const items: xdr.ScVal[] = xdr.ScVal.fromXDR(raw.value, 'base64').vec() ?? []
    const data: Record<string, string> = {}
    EVENT_PAYLOAD_FIELDS[eventType].forEach((field, i) => {
      data[field] = scValToString(items[i])
    })

    return {
      id: raw.id,
      type: eventType,
      ledger: raw.ledger,
      timestamp: raw.ledgerClosedAt ? Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000) : 0,
      txHash: raw.txHash,
      data,
    }
  } catch {
    return null
  }
}

// ── JSON-RPC helper ───────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown, network: Network): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(getNetworkConfig(network).sorobanRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!res.ok) throw httpErrorFromResponse(res, `RPC HTTP error ${res.status}`)
    const json = await res.json()
    if (json.error) {
      const errorMsg: string = json.error.message ?? 'RPC error'
      if (errorMsg.toLowerCase().includes('rate limit')) throw new HttpError(429, errorMsg)
      throw new Error(errorMsg)
    }
    return json.result as T
  })
}

// ── StellarService ────────────────────────────────────────────────────────────

export class StellarService {
  private network: Network

  constructor(network: Network = 'testnet') {
    this.network = network
  }

  setNetwork(network: Network) {
    this.network = network
  }

  /** Report a failed call to Sentry, then throw its user-facing form. */
  private fail(err: unknown, context: ContractErrorContext & { txHash?: string }): never {
    const userError = toUserFacingError(err)
    captureContractError(err instanceof Error ? err : new Error(String(err)), {
      network: this.network,
      ...context,
    })
    throw userError
  }

  /**
   * Build, sign and submit one factory-contract invocation from the connected
   * wallet, returning `select` applied to the confirmed result. Failures are
   * reported under `functionName` with `params` as context.
   */
  private async invokeFactory<T>(
    functionName: string,
    params: Record<string, unknown>,
    buildCall: (contract: Contract, sourceAddress: string) => xdr.Operation,
    select: (result: SubmitAndConfirmResult) => T,
  ): Promise<T> {
    try {
      const contractId = requireFactoryContractId()
      const sourceAddress = requireConnectedAddress()
      const server = getRpcServer(this.network)
      const contract = new Contract(contractId)

      const tx = (await buildTxBuilder(server, sourceAddress, this.network))
        .addOperation(buildCall(contract, sourceAddress))
        .setTimeout(30)
        .build()

      return select(await simulateAndSubmitDetailed(server, tx, this.network))
    } catch (err) {
      this.fail(err, {
        contractId: STELLAR_CONFIG.factoryContractId ?? 'unknown',
        functionName,
        params,
      })
    }
  }

  // ── deployToken ─────────────────────────────────────────────────────────────

  /**
   * Build and submit a `create_token` invocation to the factory contract.
   * Waits for transaction inclusion and returns the new contract ID.
   */
  async deployToken(params: {
    name: string
    symbol: string
    decimals: number
    initialSupply: string
    /**
     * Optional supply cap. When provided, the token is created with a
     * `max_supply` and `mint_tokens` will reject mints that would exceed it.
     * Omit (or pass null/undefined) to create an uncapped token — the contract
     * receives `Option::None`.
     */
    maxSupply?: string | null | undefined
    salt: string
    feePayment: string
  }): Promise<DeploymentResult> {
    return this.invokeFactory(
      'deployToken',
      { name: params.name, symbol: params.symbol, decimals: params.decimals },
      (contract, sourceAddress) =>
        contract.call(
          'create_token',
          new Address(sourceAddress).toScVal(),
          nativeToScVal(hexToBytes(params.salt), { type: 'bytes' }),
          nativeToScVal(params.name, { type: 'string' }),
          nativeToScVal(params.symbol, { type: 'string' }),
          nativeToScVal(params.decimals, { type: 'u32' }),
          nativeToScVal(BigInt(params.initialSupply), { type: 'i128' }),
          optionI128(params.maxSupply),
          nativeToScVal(BigInt(params.feePayment), { type: 'i128' }),
        ),
      // The confirmed response is already in hand — re-fetching it by hash was
      // a redundant round-trip that could itself fail after a successful write.
      ({ hash, response }) => {
        // Extract the returned token address from the transaction result
        const tokenAddress = response.returnValue
          ? (scValToNative(response.returnValue) as string)
          : ''
        return { tokenAddress, transactionHash: hash, success: true }
      },
    )
  }

  // ── mintTokens ──────────────────────────────────────────────────────────────

  /**
   * Invoke `mint_tokens` on the factory contract for the given token address.
   * `amount` and `feePayment` are decimal string representations of i128 values.
   */
  async mintTokens(params: {
    tokenAddress: string
    to: string
    amount: string
    feePayment: string
  }): Promise<string> {
    return this.invokeFactory(
      'mintTokens',
      { tokenAddress: params.tokenAddress, amount: params.amount },
      (contract, sourceAddress) =>
        contract.call(
          'mint_tokens',
          new Address(params.tokenAddress).toScVal(), // token_address
          new Address(sourceAddress).toScVal(), // admin (caller)
          new Address(params.to).toScVal(), // to
          nativeToScVal(BigInt(params.amount), { type: 'i128' }),
          nativeToScVal(BigInt(params.feePayment), { type: 'i128' }),
        ),
      selectHash,
    )
  }

  // ── burnTokens ──────────────────────────────────────────────────────────────

  /**
   * Invoke `burn` on the factory contract.
   * `amount` is a decimal string representation of an i128 value.
   */
  async burnTokens(params: { tokenAddress: string; amount: string }): Promise<string> {
    return this.invokeFactory(
      'burnTokens',
      { tokenAddress: params.tokenAddress, amount: params.amount },
      (contract, sourceAddress) =>
        contract.call(
          'burn',
          new Address(params.tokenAddress).toScVal(), // token_address
          new Address(sourceAddress).toScVal(), // from (caller)
          nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        ),
      selectHash,
    )
  }

  // ── setMetadata ─────────────────────────────────────────────────────────────

  /**
   * Invoke `set_metadata` on the factory contract.
   * `feePayment` is a decimal string representation of an i128 value.
   */
  async setMetadata(params: {
    tokenAddress: string
    metadataUri: string
    feePayment: string
  }): Promise<string> {
    return this.invokeFactory(
      'setMetadata',
      { tokenAddress: params.tokenAddress, metadataUri: params.metadataUri },
      (contract, sourceAddress) =>
        contract.call(
          'set_metadata',
          new Address(params.tokenAddress).toScVal(), // token_address
          new Address(sourceAddress).toScVal(), // admin (caller)
          nativeToScVal(params.metadataUri, { type: 'string' }),
          nativeToScVal(BigInt(params.feePayment), { type: 'i128' }),
        ),
      selectHash,
    )
  }

  // ── getTokenInfo ────────────────────────────────────────────────────────────

  /**
   * Perform a read-only RPC simulation of `get_token_info` on the factory
   * contract and map the response to the local TokenInfo interface.
   */
  async getTokenInfo(index: number): Promise<TokenInfo> {
    const contractId = requireFactoryContractId()
    const sourceAddress = requireConnectedAddress()

    try {
      const server = getRpcServer(this.network)
      const retval = await callView(
        server,
        contractId,
        'get_token_info',
        [nativeToScVal(index, { type: 'u32' })],
        sourceAddress,
        this.network,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const native = scValToNative(retval) as any
      return {
        name: String(native.name ?? ''),
        symbol: String(native.symbol ?? ''),
        decimals: Number(native.decimals ?? 7),
        creator: native.creator?.toString() ?? '',
        createdAt: Number(native.created_at ?? 0),
        totalSupply: native.total_supply?.toString(),
      }
    } catch (err) {
      this.fail(err, { contractId, functionName: 'getTokenInfo', params: { index } })
    }
  }

  // ── getTransaction ──────────────────────────────────────────────────────────

  /**
   * Fetch transaction details from the Horizon server using the transaction hash.
   */
  async getTransaction(hash: string): Promise<Record<string, unknown>> {
    try {
      return await withRetry(async () => {
        const { horizonUrl } = getNetworkConfig(this.network)
        const res = await fetch(`${horizonUrl}/transactions/${hash}`)
        if (!res.ok) {
          if (res.status === 404) throw new Error(`Transaction not found: ${hash}`)
          throw httpErrorFromResponse(res, `Horizon error ${res.status}`)
        }
        return res.json() as Promise<Record<string, unknown>>
      })
    } catch (err) {
      this.fail(err, { functionName: 'getTransaction', txHash: hash, params: { hash } })
    }
  }

  async getFactoryState(): Promise<FactoryState> {
    const contractId = requireFactoryContractId()
    const sourceAddress = requireConnectedAddress()

    try {
      const server = getRpcServer(this.network)
      const retval = await callView(
        server,
        contractId,
        'get_state',
        [],
        sourceAddress,
        this.network,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const native = scValToNative(retval) as any
      return {
        admin: native.admin?.toString() ?? '',
        paused: Boolean(native.paused),
        treasury: native.treasury?.toString() ?? '',
        baseFee: native.base_fee?.toString() ?? '0',
        metadataFee: native.metadata_fee?.toString() ?? '0',
        tokenCount: Number(native.token_count ?? 0),
        whitelistEnabled: Boolean(native.whitelist_enabled ?? false),
        // scValToNative turns BytesN<32> into a Buffer/Uint8Array — normalise
        // to lowercase hex so it is directly comparable to VITE_TOKEN_WASM_HASH.
        tokenWasmHash: native.token_wasm_hash
          ? bytesToHex(new Uint8Array(native.token_wasm_hash))
          : undefined,
      }
    } catch (err) {
      this.fail(err, { contractId, functionName: 'getFactoryState' })
    }
  }

  // ── accountExists ───────────────────────────────────────────────────────────

  async accountExists(address: string): Promise<boolean> {
    return withRetry(async () => {
      const { horizonUrl } = getNetworkConfig(this.network)
      const res = await fetch(`${horizonUrl}/accounts/${address}`)
      if (res.status === 404) return false
      if (!res.ok) throw httpErrorFromResponse(res, `Horizon error ${res.status}`)
      return true
    })
  }

  // ── updateFees ──────────────────────────────────────────────────────────────

  async updateFees(params: { baseFee: string; metadataFee: string }): Promise<string> {
    // `update_fees` takes two `Option<i128>` arguments. These were
    // previously encoded as `["Some", value]` vectors, which is the layout
    // for `#[contracttype]` enum variants, not for `Option` — the host
    // handed the vector straight to i128's converter and the call failed to
    // decode. See `optionI128` for the correct representation.
    return this.invokeFactory(
      'updateFees',
      { baseFee: params.baseFee, metadataFee: params.metadataFee },
      (contract, sourceAddress) =>
        contract.call(
          'update_fees',
          new Address(sourceAddress).toScVal(),
          optionI128(params.baseFee),
          optionI128(params.metadataFee),
        ),
      selectHash,
    )
  }

  // ── setWhitelistEnabled ──────────────────────────────────────────────────────

  /**
   * Invoke `set_whitelist_enabled` on the factory contract.
   * When `enabled` is true, only whitelisted addresses may call
   * `create_token` / `create_tokens_batch`.
   */
  async setWhitelistEnabled(enabled: boolean): Promise<string> {
    return this.invokeFactory(
      'setWhitelistEnabled',
      { enabled },
      (contract, sourceAddress) =>
        contract.call(
          'set_whitelist_enabled',
          new Address(sourceAddress).toScVal(),
          nativeToScVal(enabled, { type: 'bool' }),
        ),
      selectHash,
    )
  }

  // ── getContractEvents ───────────────────────────────────────────────────────

  async getContractEvents(
    contractId: string,
    limit = 20,
    cursor?: string,
  ): Promise<GetEventsResult> {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [contractId] }],
      pagination: { limit, ...(cursor ? { cursor } : {}) },
    }

    const result = await rpcCall<RpcGetEventsResult>('getEvents', params, this.network)
    const parsed = await Promise.all(result.events.map(parseRpcEvent))
    const events = parsed
      .filter((e): e is ContractEvent => e !== null)
      .sort((a, b) => b.ledger - a.ledger)

    const lastEvent = result.events[result.events.length - 1]
    return { events, cursor: lastEvent?.pagingToken ?? null }
  }

  // ── getAllTokens ─────────────────────────────────────────────────────────────

  /**
   * Fetch a page of the global token list, newest-first.
   *
   * The factory exposes no `get_all_tokens` view, but it maintains a
   * monotonically increasing `token_count` and stores every token at a 1-based
   * index (`TokenInfo(1..=token_count)`), readable via `get_token_info(index)`.
   * We page over that index range instead of walking event history.
   *
   * `offset`/`limit` describe a newest-first window: `offset = 0` starts at the
   * most-recently-created token (index `total`) and walks down toward index 1.
   * Index reads are issued with bounded concurrency
   * (`GET_ALL_TOKENS_CONCURRENCY`) to respect RPC rate limits
   * (docs/rpc-rate-limits.md) and collected with `Promise.allSettled` semantics
   * so a single transiently-missing index does not fail the whole page.
   *
   * Returns `{ tokens, total }` where `total` is the factory's `token_count`.
   * Callers MUST use `total` (not `tokens.length`) to distinguish "factory has
   * zero tokens" from "this page failed" — a short/empty page is never on its
   * own a truthful "no tokens exist" signal.
   *
   * Throws when the factory state cannot be read, or when a non-empty index
   * window was requested but *every* index read failed — so consumers render an
   * error state rather than a fake-empty list.
   */
  async getAllTokens(
    offset = 0,
    limit = DEFAULT_TOKEN_PAGE_LIMIT,
    /**
     * Optional session-scoped token-count snapshot.
     *
     * When provided, `getFactoryState()` is **not** called and the snapshot
     * value is used directly as `total`. This pins all page-index windows for
     * a browsing session to the same baseline so that tokens created between
     * page fetches cannot shift windows and produce duplicates or gaps.
     *
     * Callers are responsible for obtaining the snapshot once (e.g. on
     * Explorer mount or on an explicit "refresh") via `getFactoryState()`, and
     * for discarding it when the user deliberately refreshes the list.
     *
     * When omitted (or `undefined`), behaviour is unchanged: the live count is
     * fetched from the chain on every call.
     */
    tokenCountSnapshot?: number,
  ): Promise<{ tokens: TokenInfo[]; total: number }> {
    requireFactoryContractId()

    const rawCount =
      tokenCountSnapshot !== undefined
        ? tokenCountSnapshot
        : (await this.getFactoryState()).tokenCount
    const total = Math.max(0, rawCount)
    if (total === 0 || limit <= 0) return { tokens: [], total }

    // Newest-first window over the 1-based index range [1, total].
    const highIndex = total - Math.max(0, offset)
    if (highIndex < 1) return { tokens: [], total } // offset past the oldest token
    const lowIndex = Math.max(1, highIndex - limit + 1)

    const indices: number[] = []
    for (let i = highIndex; i >= lowIndex; i--) indices.push(i)

    const settled = await allSettledWithConcurrency(
      indices.map((index) => () => this.getTokenInfo(index)),
      GET_ALL_TOKENS_CONCURRENCY,
    )

    // `settled[k]` corresponds to `indices[k]`; stamp the resolved 1-based
    // index onto each token so consumers can correlate it (e.g. to a token
    // address derived from `created` events, the complementary path).
    const tokens: TokenInfo[] = []
    settled.forEach((r, k) => {
      if (r.status === 'fulfilled') tokens.push({ ...r.value, index: indices[k]! })
    })

    // A non-empty window that resolved nothing is a fetch failure, not an
    // empty factory — surface it so the UI never shows a fake-empty list.
    if (tokens.length === 0) {
      const firstRejection = settled.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )
      throw firstRejection?.reason instanceof Error
        ? firstRejection.reason
        : new Error('Failed to fetch any tokens for the requested page')
    }

    return { tokens, total }
  }

  // ── getTokensByCreator ───────────────────────────────────────────────────────

  /**
   * Fetch a paginated slice of tokens created by `creator`.
   *
   * This calls the contract's `get_tokens_by_creator` view function with the
   * supplied `offset` and `limit`, then resolves each returned index to a
   * full `TokenInfo` via `get_token_info`. Failed index lookups are skipped
   * (the page may end up smaller than `limit` when one token's metadata is
   * temporarily unavailable).
   *
   * The contract caps the `limit` it will service per call to keep responses
   * below Stellar ledger entry size limits, so callers should treat responses
   * shorter than `limit` as "end of available data" and stop iterating.
   */
  async getTokensByCreator(creator: string, offset: number, limit: number): Promise<TokenInfo[]> {
    const contractId = requireFactoryContractId()
    const sourceAddress = requireConnectedAddress()

    try {
      const server = getRpcServer(this.network)
      const indicesRetval = await callView(
        server,
        contractId,
        'get_tokens_by_creator',
        [
          new Address(creator).toScVal(),
          nativeToScVal(offset, { type: 'u32' }),
          nativeToScVal(limit, { type: 'u32' }),
        ],
        sourceAddress,
        this.network,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const native = scValToNative(indicesRetval) as any
      const indices: number[] = Array.isArray(native) ? native.map((v: unknown) => Number(v)) : []

      if (indices.length === 0) return []

      const results = await Promise.allSettled(indices.map((i) => this.getTokenInfo(i)))
      return results
        .filter((r): r is PromiseFulfilledResult<TokenInfo> => r.status === 'fulfilled')
        .map((r) => r.value)
    } catch (err) {
      this.fail(err, {
        contractId,
        functionName: 'getTokensByCreator',
        params: { creator, offset, limit },
      })
    }
  }

  // ── Address-keyed contract views ─────────────────────────────────────────────

  /**
   * Read a token's authoritative `TokenInfo` by contract address via the
   * on-chain `get_token_info_by_address` view.
   *
   * This is the source of truth for a token's name, symbol, decimals, creator
   * and creation time — unlike factory events, on-chain state has no retention
   * window, so a token created arbitrarily long ago still resolves correctly.
   * Throws (mapped to a `Token not found` error) when the address is not
   * registered with the factory.
   */
  async getTokenInfoByAddressView(tokenAddress: string): Promise<TokenInfo> {
    const contractId = requireFactoryContractId()
    const server = getRpcServer(this.network)
    const retval = await callViewReadonly(
      server,
      contractId,
      'get_token_info_by_address',
      [new Address(tokenAddress).toScVal()],
      this.network,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const native = scValToNative(retval) as any
    return {
      name: String(native.name ?? ''),
      symbol: String(native.symbol ?? ''),
      // Decimals come straight from contract state — never a guessed default.
      decimals: Number(native.decimals ?? 0),
      creator: native.creator?.toString() ?? '',
      createdAt: Number(native.created_at ?? 0),
    }
  }

  /**
   * Read a token's current metadata URI from the on-chain `get_metadata` view.
   * Returns an empty string when no metadata has been set. Resolving from
   * contract state avoids scanning `meta` events, which are subject to RPC
   * retention truncation.
   */
  async getTokenMetadataUri(tokenAddress: string): Promise<string> {
    const contractId = requireFactoryContractId()
    const server = getRpcServer(this.network)
    const retval = await callViewReadonly(
      server,
      contractId,
      'get_metadata',
      [new Address(tokenAddress).toScVal()],
      this.network,
    )
    const native = scValToNative(retval)
    return native == null ? '' : String(native)
  }

  // ── resolveTokenInfoByAddress ────────────────────────────────────────────────

  /**
   * Resolve a token's identity by address, returning a typed result rather than
   * ever fabricating a placeholder. Identity is read from the contract (see
   * {@link getTokenInfoByAddressView}), so `decimals` and the rest are always
   * authoritative when `status === 'resolved'`.
   *
   * When the factory has no such token (`not-found`) or cannot be reached
   * (`rpc-error`) the caller gets an explicit `unresolved` marker to render as
   * such — this is what prevents wrong decimals or an address-as-name from ever
   * being shown as if they were real token data.
   */
  async resolveTokenInfoByAddress(tokenAddress: string): Promise<TokenInfoResult> {
    try {
      const info = await this.getTokenInfoByAddressView(tokenAddress)

      let metadataUri = ''
      try {
        metadataUri = await this.getTokenMetadataUri(tokenAddress)
      } catch {
        // Metadata is non-critical; identity is already resolved. A failure
        // here (e.g. transient RPC error) must not downgrade a resolved token
        // to unresolved.
      }

      return { status: 'resolved', ...info, metadataUri }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const notFound = /token not found/i.test(message) || /Error\(Contract,\s*4\)/.test(message)
      return {
        status: 'unresolved',
        address: tokenAddress,
        reason: notFound ? 'not-found' : 'rpc-error',
        message: notFound
          ? `No token is registered at ${tokenAddress} with the factory contract.`
          : `Could not resolve token ${tokenAddress}: ${message}`,
      }
    }
  }

  // ── getTokenInfoByAddress ────────────────────────────────────────────────────

  /**
   * Throwing convenience wrapper over {@link resolveTokenInfoByAddress} for
   * callers that treat a rejection as "not found" (`TokenExplorer`, `useTokens`
   * filter the entry out). Prefer `resolveTokenInfoByAddress` where the UI can
   * render the `unresolved` state explicitly.
   */
  async getTokenInfoByAddress(tokenAddress: string): Promise<TokenInfo> {
    const result = await this.resolveTokenInfoByAddress(tokenAddress)
    if (result.status === 'unresolved') {
      throw new Error(
        result.reason === 'not-found'
          ? `No token found at address ${tokenAddress}`
          : result.message,
      )
    }
    const { status: _status, ...info } = result
    return info
  }

  /**
   * Get the complete available event history for a specific token address.
   *
   * Pages exhaustively through the factory's event stream via
   * {@link fetchAllContractEvents} (rather than a single fixed-size page, which
   * silently truncated a token's history to whatever happened most recently)
   * and filters to events referencing `tokenAddress`.
   *
   * The result is always flagged `retentionLimited`: Soroban RPC only retains
   * events for a bounded window (~{@link RPC_EVENT_RETENTION_DAYS} days on
   * public infrastructure), so events older than that cannot be served and the
   * list must never be presented as the token's complete lifetime. The UI
   * discloses this boundary rather than implying completeness.
   */
  async getTokenEvents(tokenAddress: string): Promise<TokenEventsResult> {
    const contractId = STELLAR_CONFIG.factoryContractId
    const events = contractId
      ? (await fetchAllContractEvents(this, contractId))
          .filter((event) => event.data.tokenAddress === tokenAddress)
          .sort((a, b) => b.ledger - a.ledger)
      : []

    return {
      events,
      retentionLimited: true,
      retentionDays: RPC_EVENT_RETENTION_DAYS,
      cursor: null,
    }
  }
}

export const stellarService = new StellarService()
