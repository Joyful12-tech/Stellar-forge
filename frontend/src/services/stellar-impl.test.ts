/**
 * Unit tests for parseRpcEvent and CONTRACT_TOPIC_MAP.
 *
 * XDR fixtures are real base64-encoded ScVal blobs generated with stellar-sdk
 * (Keypair.random() addresses are embedded in the XDR, so they are stable
 * across runs).  Every test decodes from the raw wire format all the way to
 * the ContractEvent shape, proving the full parse path.
 *
 * These two test addresses are baked into the XDR fixtures below:
 *   ADDR1 = GD73JKOGSEGFO7PJLZFWL6MT7HOF7L27NJX6AJ3QOWIM45AMHNT7T7JE
 *   ADDR2 = GB5QBV5XY4AUAZ4VQENJDW7A4KHHH77CIDAUXVJT476ZAKHTVC36S3MD
 */

import { describe, it, expect } from 'vitest'
import { parseRpcEvent, CONTRACT_TOPIC_MAP } from './stellar-impl'
import type { RpcEventResponse } from './stellar-impl'

// ── Test addresses (embedded in the XDR fixtures) ─────────────────────────────

const ADDR1 = 'GD73JKOGSEGFO7PJLZFWL6MT7HOF7L27NJX6AJ3QOWIM45AMHNT7T7JE'
const ADDR2 = 'GB5QBV5XY4AUAZ4VQENJDW7A4KHHH77CIDAUXVJT476ZAKHTVC36S3MD'

// topic[0] is always symbol_short!("factory"), topic[1] is the action symbol.
const FACTORY_TOPIC = 'AAAADwAAAAdmYWN0b3J5AA=='

// ── XDR fixtures ─────────────────────────────────────────────────────────────
// Generated with stellar-sdk: xdr.ScVal.scvSymbol / scvVec / scvAddress etc.

const XDR = {
  init: {
    topic1: 'AAAADwAAAARpbml0',
    value: 'AAAAEAAAAAEAAAABAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/k=',
  },
  created: {
    topic1: 'AAAADwAAAAdjcmVhdGVkAA==',
    value:
      'AAAAEAAAAAEAAAAEAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAASAAAAAAAAAAD/tKnGkQxXfeleS2X5k/ncX69fam/gJ3B1kM50DDtn+QAAAA4AAAAHTXlUb2tlbgAAAAAOAAAAA01USwA=',
  },
  meta: {
    topic1: 'AAAADwAAAARtZXRh',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAAOAAAANWlwZnM6Ly9RbVhveXBpempXM1drbkZpSm5LTHdIQ25MNzJ2ZWR4alFrRERQMW1YV282dWNvAAAA',
  },
  mint: {
    topic1: 'AAAADwAAAARtaW50',
    value:
      'AAAAEAAAAAEAAAADAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAASAAAAAAAAAAD/tKnGkQxXfeleS2X5k/ncX69fam/gJ3B1kM50DDtn+QAAAAoAAAAAAAAAAAAAAAEqBfIA',
  },
  burn: {
    topic1: 'AAAADwAAAARidXJu',
    value:
      'AAAAEAAAAAEAAAADAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAASAAAAAAAAAAD/tKnGkQxXfeleS2X5k/ncX69fam/gJ3B1kM50DDtn+QAAAAoAAAAAAAAAAAAAAAAAD0JA',
  },
  fees: {
    topic1: 'AAAADwAAAARmZWVz',
    value: 'AAAAEAAAAAEAAAACAAAACgAAAAAAAAAAAAAAAAX14QAAAAAKAAAAAAAAAAAAAAAAAvrwgA==',
  },
  pause: {
    topic1: 'AAAADwAAAAVwYXVzZQAAAA==',
    value: 'AAAAEAAAAAEAAAABAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/k=',
  },
  unpause: {
    topic1: 'AAAADwAAAAd1bnBhdXNlAA==',
    value: 'AAAAEAAAAAEAAAABAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/k=',
  },
  // Admin rotation is two-step: adm_prop (proposed) → adm_acc (accepted),
  // or adm_can (cancelled by the current admin). There is no adm_upd topic.
  adm_prop: {
    topic1: 'AAAADwAAAAhhZG1fcHJvcA==',
    value:
      'AAAAEAAAAAEAAAADAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAASAAAAAAAAAAB7ANe3xwFAZ5WBGpHb4OKOc//iQMFL1TPn/ZAo86i36QAAAAUAAAAAAAAH0A==',
  },
  adm_acc: {
    topic1: 'AAAADwAAAAdhZG1fYWNjAA==',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAASAAAAAAAAAAB7ANe3xwFAZ5WBGpHb4OKOc//iQMFL1TPn/ZAo86i36Q==',
  },
  adm_can: {
    topic1: 'AAAADwAAAAdhZG1fY2FuAA==',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAASAAAAAAAAAAB7ANe3xwFAZ5WBGpHb4OKOc//iQMFL1TPn/ZAo86i36Q==',
  },
  // (current_admin, new_admin, expiry_ledger, deprecated_entrypoint) — emitted
  // alongside adm_prop when the proposal came from transfer_admin/update_admin.
  adm_dep: {
    topic1: 'AAAADwAAAAdhZG1fZGVwAA==',
    value:
      'AAAAEAAAAAEAAAAEAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAASAAAAAAAAAAB7ANe3xwFAZ5WBGpHb4OKOc//iQMFL1TPn/ZAo86i36QAAAAUAAAAAAAAH0AAAAA8AAAAOdHJhbnNmZXJfYWRtaW4AAA==',
  },
  fee_redir: {
    topic1: 'AAAADwAAAAlmZWVfcmVkaXIAAAA=',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAAKAAAAAAAAAAAAAAAAAA9CQA==',
  },
  // Two-step timelocked upgrade (issue #6). The BytesN<32> WASM hash in all
  // three payloads is WASM_HASH_HEX below.
  // (admin, new_wasm_hash, ready_at_ledger)
  upg_prop: {
    topic1: 'AAAADwAAAAh1cGdfcHJvcA==',
    value:
      'AAAAEAAAAAEAAAADAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAANAAAAIAMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXcAAAABQAAAAAAAAgA',
  },
  // (admin, new_wasm_hash)
  upg_exec: {
    topic1: 'AAAADwAAAAh1cGdfZXhlYw==',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAA/7SpxpEMV33pXktl+ZP53F+vX2pv4CdwdZDOdAw7Z/kAAAANAAAAIAMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXc',
  },
  // (admin, cancelled_hash)
  upg_can: {
    topic1: 'AAAADwAAAAd1cGdfY2FuAA==',
    value:
      'AAAAEAAAAAEAAAACAAAAEgAAAAAAAAAAewDXt8cBQGeVgRqR2+DijnP/4kDBS9Uz5/2QKPOot+kAAAANAAAAIAMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXc',
  },
} as const

/** The BytesN<32> WASM hash embedded in the three upg_* fixtures, as hex. */
const WASM_HASH_HEX = '030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRaw(
  key: keyof typeof XDR,
  overrides: Partial<RpcEventResponse> = {},
): RpcEventResponse {
  return {
    id: `evt-${key}`,
    type: 'contract',
    ledger: 1000,
    ledgerClosedAt: '2026-07-22T18:00:00Z',
    contractId: 'CFACTORY',
    pagingToken: `tok-${key}`,
    inSuccessfulContractCall: true,
    txHash: `txhash-${key}`,
    topic: [FACTORY_TOPIC, XDR[key].topic1],
    value: XDR[key].value,
    ...overrides,
  }
}

// ── CONTRACT_TOPIC_MAP completeness ──────────────────────────────────────────

describe('CONTRACT_TOPIC_MAP', () => {
  // Must match every `symbol_short!` action topic emitted by
  // contracts/token-factory/src/lib.rs. `scripts/check-event-topic-drift.sh`
  // enforces the same invariant in CI against the contract source itself.
  const EXPECTED_TOPICS = [
    'init',
    'created',
    'meta',
    'meta_frz',
    'mint',
    'burn',
    'fees',
    'fee_redir',
    'split_set',
    'split_clr',
    'pause',
    'unpause',
    'adm_prop',
    'adm_acc',
    'adm_can',
    'adm_dep',
    'wl_add',
    'wl_rm',
    'wl_tog',
    'upg_prop',
    'upg_exec',
    'upg_can',
  ] as const

  it('contains exactly the twenty-two contract topics', () => {
    expect(Object.keys(CONTRACT_TOPIC_MAP).sort()).toEqual([...EXPECTED_TOPICS].sort())
  })

  it('maps each two-step admin-rotation topic to itself', () => {
    expect(CONTRACT_TOPIC_MAP['adm_prop']).toBe('adm_prop')
    expect(CONTRACT_TOPIC_MAP['adm_acc']).toBe('adm_acc')
    expect(CONTRACT_TOPIC_MAP['adm_can']).toBe('adm_can')
    expect(CONTRACT_TOPIC_MAP['adm_dep']).toBe('adm_dep')
  })

  it('does NOT contain the legacy admin_update or single-step adm_upd keys', () => {
    expect(CONTRACT_TOPIC_MAP).not.toHaveProperty('admin_update')
    expect(CONTRACT_TOPIC_MAP).not.toHaveProperty('adm_upd')
  })

  it('maps each two-step upgrade topic to itself', () => {
    expect(CONTRACT_TOPIC_MAP['upg_prop']).toBe('upg_prop')
    expect(CONTRACT_TOPIC_MAP['upg_exec']).toBe('upg_exec')
    expect(CONTRACT_TOPIC_MAP['upg_can']).toBe('upg_can')
  })

  it('does NOT contain a single-step upgrade key', () => {
    // The pre-timelock contract had no upgrade event at all; anything named
    // plainly "upgrade" would mean the two-step model was reverted.
    expect(CONTRACT_TOPIC_MAP).not.toHaveProperty('upgrade')
    expect(CONTRACT_TOPIC_MAP).not.toHaveProperty('upg')
  })
})

// ── parseRpcEvent – common behaviour ─────────────────────────────────────────

describe('parseRpcEvent – edge cases', () => {
  it('returns null when topic array is empty', async () => {
    const raw = makeRaw('init', { topic: [] })
    expect(await parseRpcEvent(raw)).toBeNull()
  })

  it('returns null when topic array has fewer than 2 entries', async () => {
    const raw = makeRaw('init', { topic: [FACTORY_TOPIC] })
    expect(await parseRpcEvent(raw)).toBeNull()
  })

  it('returns null for an unrecognised topic (e.g. admin_update)', async () => {
    // The old, incorrect topic string that used to be in the frontend
    const unknownTopic = 'AAAADwAAAAxhZG1pbl91cGRhdGU=' // scvSymbol("admin_update")
    const raw = makeRaw('adm_acc', { topic: [FACTORY_TOPIC, unknownTopic] })
    expect(await parseRpcEvent(raw)).toBeNull()
  })

  it('returns null when the XDR value is malformed', async () => {
    const raw = makeRaw('init', { value: 'not-valid-base64!!!' })
    expect(await parseRpcEvent(raw)).toBeNull()
  })
})

// ── parseRpcEvent – init ──────────────────────────────────────────────────────

describe('parseRpcEvent – init', () => {
  it('decodes an init event', async () => {
    const result = await parseRpcEvent(makeRaw('init'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('init')
    expect(result!.data.admin).toBe(ADDR1)
    expect(result!.txHash).toBe('txhash-init')
    expect(result!.ledger).toBe(1000)
    expect(result!.timestamp).toBeGreaterThan(0)
  })
})

// ── parseRpcEvent – created ───────────────────────────────────────────────────

describe('parseRpcEvent – created', () => {
  it('decodes a created event', async () => {
    const result = await parseRpcEvent(makeRaw('created'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('created')
    expect(result!.data.tokenAddress).toBe(ADDR2)
    expect(result!.data.creator).toBe(ADDR1)
    expect(result!.data.name).toBe('MyToken')
    expect(result!.data.symbol).toBe('MTK')
  })
})

// ── parseRpcEvent – meta ──────────────────────────────────────────────────────

describe('parseRpcEvent – meta', () => {
  it('decodes a meta event', async () => {
    const result = await parseRpcEvent(makeRaw('meta'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('meta')
    expect(result!.data.tokenAddress).toBe(ADDR2)
    expect(result!.data.metadataUri).toBe('ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')
  })
})

// ── parseRpcEvent – mint ──────────────────────────────────────────────────────

describe('parseRpcEvent – mint', () => {
  it('decodes a mint event', async () => {
    const result = await parseRpcEvent(makeRaw('mint'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('mint')
    expect(result!.data.tokenAddress).toBe(ADDR2)
    expect(result!.data.to).toBe(ADDR1)
    expect(result!.data.amount).toBe('5000000000')
  })
})

// ── parseRpcEvent – burn ──────────────────────────────────────────────────────

describe('parseRpcEvent – burn', () => {
  it('decodes a burn event', async () => {
    const result = await parseRpcEvent(makeRaw('burn'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('burn')
    expect(result!.data.tokenAddress).toBe(ADDR2)
    expect(result!.data.from).toBe(ADDR1)
    expect(result!.data.amount).toBe('1000000')
  })
})

// ── parseRpcEvent – fees ──────────────────────────────────────────────────────

describe('parseRpcEvent – fees', () => {
  it('decodes a fees event', async () => {
    const result = await parseRpcEvent(makeRaw('fees'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('fees')
    expect(result!.data.baseFee).toBe('100000000')
    expect(result!.data.metadataFee).toBe('50000000')
  })
})

// ── parseRpcEvent – pause ─────────────────────────────────────────────────────

describe('parseRpcEvent – pause', () => {
  it('decodes a pause event', async () => {
    const result = await parseRpcEvent(makeRaw('pause'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('pause')
    expect(result!.data.admin).toBe(ADDR1)
  })
})

// ── parseRpcEvent – unpause ───────────────────────────────────────────────────

describe('parseRpcEvent – unpause', () => {
  it('decodes an unpause event', async () => {
    const result = await parseRpcEvent(makeRaw('unpause'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('unpause')
    expect(result!.data.admin).toBe(ADDR1)
  })
})

// ── parseRpcEvent – admin rotation (THE KEY REGRESSION TESTS) ───────────────

describe('parseRpcEvent – admin rotation (adm_prop / adm_acc / adm_can)', () => {
  /**
   * These are the regression tests for the admin-topic mismatch.
   *
   * The frontend EVENT_TOPICS first contained 'admin_update', then the
   * single-step 'adm_upd'; the contract now performs a two-step rotation and
   * emits symbol_short!("adm_prop") / ("adm_acc") / ("adm_can").  A decoded
   * topic missing from the allow-list makes parseRpcEvent return null, so
   * every admin-rotation event is silently dropped from Transaction History
   * and CSV exports.
   */
  it('decodes an adm_prop event — a rotation proposed but not yet accepted', async () => {
    const result = await parseRpcEvent(makeRaw('adm_prop'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('adm_prop')
    expect(result!.data.currentAdmin).toBe(ADDR1)
    expect(result!.data.newAdmin).toBe(ADDR2)
    // The expiry ledger tells a watcher when the proposal lapses.
    expect(result!.data.expiryLedger).toBe('2000')
  })

  it('decodes an adm_acc event — the rotation that actually changes the admin', async () => {
    const result = await parseRpcEvent(makeRaw('adm_acc'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('adm_acc')
    expect(result!.data.currentAdmin).toBe(ADDR1)
    expect(result!.data.newAdmin).toBe(ADDR2)
  })

  it('decodes an adm_can event — a pending proposal cancelled', async () => {
    const result = await parseRpcEvent(makeRaw('adm_can'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('adm_can')
    expect(result!.data.currentAdmin).toBe(ADDR1)
    expect(result!.data.cancelledAdmin).toBe(ADDR2)
  })

  it('preserves both admin addresses in the data payload', async () => {
    const result = await parseRpcEvent(makeRaw('adm_acc'))
    // Both must be present and distinct — this is the information that
    // users and auditors need to audit who controls the factory.
    expect(result!.data.currentAdmin).not.toBe(result!.data.newAdmin)
    expect(result!.data.currentAdmin).toBeTruthy()
    expect(result!.data.newAdmin).toBeTruthy()
  })

  it('returns null for the legacy admin_update topic string (no regression back)', async () => {
    // Verify that the raw string "admin_update" is never silently accepted
    const legacyTopic = 'AAAADwAAAAxhZG1pbl91cGRhdGU=' // scvSymbol("admin_update")
    const raw = makeRaw('adm_acc', { topic: [FACTORY_TOPIC, legacyTopic] })
    expect(await parseRpcEvent(raw)).toBeNull()
  })

  it('returns null for the retired single-step adm_upd topic string', async () => {
    const retiredTopic = 'AAAADwAAAAdhZG1fdXBkAA==' // scvSymbol("adm_upd")
    const raw = makeRaw('adm_acc', { topic: [FACTORY_TOPIC, retiredTopic] })
    expect(await parseRpcEvent(raw)).toBeNull()
  })

  // Issue #1159: a rotation started through transfer_admin/update_admin looks
  // identical on-chain to one started through propose_admin, except for this
  // extra event. Dropping it would hide the fact that some tooling still
  // assumes a rotation completes in a single transaction.
  it('decodes an adm_dep event — proposal raised through a deprecated alias', async () => {
    const result = await parseRpcEvent(makeRaw('adm_dep'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('adm_dep')
    expect(result!.data.currentAdmin).toBe(ADDR1)
    expect(result!.data.newAdmin).toBe(ADDR2)
    expect(result!.data.expiryLedger).toBe('2000')
    // Names the entrypoint that was used, so the stale caller can be found.
    expect(result!.data.deprecatedEntrypoint).toBe('transfer_admin')
  })
})

// ── parseRpcEvent – two-step upgrade ─────────────────────────────────────────

/**
 * Issue #6 replaced the single-step `upgrade` with propose → timelock → execute.
 * The contract gained three topics; the frontend topic map did not, so upgrade
 * activity — the single most security-relevant thing an admin can do — was
 * dropped on the floor by the history view. These tests pin the decode path.
 */
describe('parseRpcEvent – two-step upgrade (upg_prop / upg_exec / upg_can)', () => {
  it('decodes an upg_prop event — upgrade proposed, timelock started', async () => {
    const result = await parseRpcEvent(makeRaw('upg_prop'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('upg_prop')
    expect(result!.data.admin).toBe(ADDR1)
    expect(result!.data.wasmHash).toBe(WASM_HASH_HEX)
    expect(result!.data.readyAtLedger).toBe('2048')
  })

  it('decodes an upg_exec event — WASM actually swapped', async () => {
    const result = await parseRpcEvent(makeRaw('upg_exec'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('upg_exec')
    expect(result!.data.admin).toBe(ADDR1)
    expect(result!.data.wasmHash).toBe(WASM_HASH_HEX)
    // Only the execution carries no ready-at ledger: by definition the
    // timelock has already elapsed.
    expect(result!.data.readyAtLedger).toBeUndefined()
  })

  it('decodes an upg_can event — pending proposal withdrawn', async () => {
    const result = await parseRpcEvent(makeRaw('upg_can'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('upg_can')
    expect(result!.data.admin).toBe(ADDR2)
    expect(result!.data.cancelledWasmHash).toBe(WASM_HASH_HEX)
  })

  it('renders the WASM hash as lowercase hex, not base64', async () => {
    // Operators compare this against `stellar contract install` output and
    // explorer pages, both of which print hex. A base64 blob is unverifiable
    // by eye and was what the unmodelled scvBytes fallback produced.
    const result = await parseRpcEvent(makeRaw('upg_exec'))
    expect(result!.data.wasmHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes a proposal from an execution', async () => {
    // The distinction is the whole point of the timelock: a proposal that was
    // never executed must never be reported as an upgrade that happened.
    const proposed = await parseRpcEvent(makeRaw('upg_prop'))
    const executed = await parseRpcEvent(makeRaw('upg_exec'))
    expect(proposed!.type).not.toBe(executed!.type)
    // Same hash, different meaning.
    expect(proposed!.data.wasmHash).toBe(executed!.data.wasmHash)
  })
})

// ── parseRpcEvent – fee redirect ─────────────────────────────────────────────

describe('parseRpcEvent – fee_redir (fee share redirected to treasury)', () => {
  it('decodes the skipped recipient and the redirected amount', async () => {
    const result = await parseRpcEvent(makeRaw('fee_redir'))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('fee_redir')
    expect(result!.data.recipient).toBe(ADDR2)
    expect(result!.data.amount).toBe('1000000')
  })
})

// ── CSV serialization includes admin rotation ─────────────────────────────────

describe('admin-rotation CSV serialization', () => {
  /**
   * Verify that once an admin-rotation event is parsed, serializeTransactionsToCSV
   * would capture it.  We test the data shape because the CSV util operates
   * on TransactionHistoryItem (Horizon op model), but we can verify the parsed
   * event has the right shape to be mapped to a CSV row.
   */
  it('parsed adm_acc event has currentAdmin and newAdmin in data', async () => {
    const result = await parseRpcEvent(makeRaw('adm_acc'))
    expect(result).not.toBeNull()
    // These fields must be present for a UI row to show both addresses
    expect(Object.keys(result!.data)).toContain('currentAdmin')
    expect(Object.keys(result!.data)).toContain('newAdmin')
  })
})
