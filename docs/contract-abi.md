# Token Factory Contract ABI

This document describes the public interface of the Stellar Forge `token-factory` Soroban contract deployed on Stellar testnet and mainnet.

The contract binary is built as `token_factory.wasm` (released alongside the frontend). All function names are lower_snake_case on-chain and translate to camelCase on the frontend wrapper in `frontend/src/services/stellar.ts`.

## Conventions

| Soroban     | TypeScript                                       |
| ----------- | ------------------------------------------------ |
| `Address`   | `string` (Stellar `G...` or contract `C...`)     |
| `u32`       | `number`                                         |
| `u64`       | `number` (lossy above `Number.MAX_SAFE_INTEGER`) |
| `i128`      | `string` (decimal)                               |
| `Vec<T>`    | `T[]`                                            |
| `Option<T>` | `T \| undefined`                                 |

## Storage architecture

As of schema version 3 (issue #1007), per-token and per-creator bookkeeping lives in Soroban **`persistent`** storage, keyed per-entry, rather than in the single shared **`instance`** ledger entry. This matters because `instance` storage is one ledger entry for the whole contract, subject to the ~64 KiB ledger-entry size limit and reserialized in full on every read/write — so before this change, `instance` storage size (and every call's cost) grew without bound as tokens accumulated, eventually bricking the factory outright once the size limit was hit.

| Data                                           | Storage backend                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `FactoryState` (`DataKey::State`)              | `instance` — small, fixed size                                                 |
| Fee split (`Map<Address, u32>`, key `"split"`) | `instance` — bounded to `MAX_FEE_SPLIT_RECIPIENTS` (10) entries                |
| `TokenInfo(index)`                             | `persistent`                                                                   |
| `TokenIndex(address)`                          | `persistent`                                                                   |
| `Metadata(address)`                            | `persistent`                                                                   |
| Per-token `owner`, `supply`, `bkfld` keys      | `persistent`                                                                   |
| Whitelist entries (`"wl"`, address)            | `persistent`                                                                   |
| `CreatorTokens(creator, page)`                 | `persistent` — paginated, ≤ `MAX_TOKENS_BY_CREATOR_PAGE` (50) indices per page |
| `CreatorTokenCount(creator)`                   | `persistent` — total token count per creator, used to compute page boundaries  |

Because `instance` storage now only ever holds `FactoryState` and the (bounded) fee split, its size is **O(1)** in `token_count` — creating the 1st token and the 10,000th cost the same to read/write the shared instance entry.

**TTL management:** every `persistent` read/write goes through helpers that extend that specific key's TTL on access (`Self::set_persistent`, `Self::migrate_addr_keyed`), so one archival event no longer takes down all token bookkeeping at once (see issue #1011) — each entry's rent is tracked independently.

**Migrating data written before schema version 3:** a factory upgraded from an older binary has its existing `TokenInfo`, `TokenIndex`, `Metadata`, `owner`, `supply`, and `CreatorTokens` entries sitting in legacy `instance` storage. Two mechanisms move them to `persistent` storage, and both are safe to run in any order or interleaving:

- `migrate(admin)`'s schema-v3 step walks `TokenInfo(1..=token_count)` in `MIGRATE_TOKEN_INFO_CHUNK`-sized (20) chunks per call, resuming across calls via an on-chain cursor if `token_count` is too large to finish in one invocation's resource budget. `FactoryState.schema_version` only advances to `3` once the cursor has caught up to `token_count`.
- Every mutating entrypoint that reads an address-keyed record (`TokenIndex`, `Metadata`, the `owner`/`supply`/`bkfld` keys) checks `persistent` storage first and, if absent, falls back to the legacy `instance` copy — migrating it into `persistent` storage (and removing the `instance` copy) as a side effect. `CreatorTokens` is migrated the same way, lazily, the first time a creator's page is next appended to, since creator addresses aren't enumerable and so can't be walked by `migrate` directly. Pure read-only view entrypoints (`get_token_info`, `get_metadata`, etc.) use the same `persistent`-then-`instance` fallback but never migrate, so simulated read calls stay free of a write footprint.

Whitelist entries need neither mechanism: they're already address-scoped by the caller (`add_to_whitelist(admin, address)` / `remove_from_whitelist(admin, address)`), so writes go straight to `persistent` storage and reads fall back to `instance` for any pre-migration entry.

## Initialization

### `initialize(admin, treasury, fee_token, token_wasm_hash, base_fee, metadata_fee)`

One-time setup. Fails with `Error::AlreadyInitialized` on retry.

| Param             | Type         | Description                                                                            |
| ----------------- | ------------ | -------------------------------------------------------------------------------------- |
| `admin`           | `Address`    | Authority for upgrades, fee updates, pause, and admin transfer.                        |
| `treasury`        | `Address`    | Default recipient of factory fees.                                                     |
| `fee_token`       | `Address`    | SEP-41 token used for fee payments.                                                    |
| `token_wasm_hash` | `BytesN<32>` | Hash of the token-contract WASM deployed for each new token.                           |
| `base_fee`        | `i128`       | Fee charged for `create_token`, `mint_tokens`, `create_tokens_batch`. **Must be ≥ 0.** |
| `metadata_fee`    | `i128`       | Fee charged for `set_metadata`. **Must be ≥ 0.**                                       |

### `__constructor(admin, treasury, fee_token, token_wasm_hash, base_fee, metadata_fee)`

> Formerly a plain `initialize(...)` entrypoint invoked _after_ deployment in a
> separate transaction. That left a window between deployment and
> initialization where an attacker could race the deployer's own
> `initialize` call with their own, passing themselves as `admin`/`treasury`
> and permanently seizing the factory (see
> [issue #1005](https://github.com/Favourorg/Stellar-forge/issues/1005)).
> It is now the contract's `__constructor` (Soroban SDK ≥ 22), which the host
> runs atomically as part of the deployment transaction itself (`deploy_v2`),
> so there is no separate transaction to race. `admin.require_auth()` is also
> now required, so the named `admin` address must itself authorize the
> deployment, not just the deploying account. Deploy tooling calls this via
> `stellar contract deploy ... -- --admin ... --treasury ...` (constructor
> args after `--`) rather than a follow-up `contract invoke`; see
> `scripts/deploy-contract.sh` and
> [`docs/mainnet-deployment-checklist.md`](./mainnet-deployment-checklist.md).
> This is a naming/entrypoint and auth change only — `FactoryState`'s field
> layout is unchanged, so `CURRENT_SCHEMA_VERSION` was not bumped.

One-time setup, atomic with deployment. Fails with `Error::AlreadyInitialized` if the factory's state already exists.

| Param             | Type         | Description                                                                                                |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `admin`           | `Address`    | Authority for upgrades, fee updates, pause, and admin transfer. Must authorize this call (`require_auth`). |
| `treasury`        | `Address`    | Default recipient of factory fees.                                                                         |
| `fee_token`       | `Address`    | SEP-41 token used for fee payments.                                                                        |
| `token_wasm_hash` | `BytesN<32>` | Hash of the token-contract WASM deployed for each new token.                                               |
| `base_fee`        | `i128`       | Fee charged for `create_token`, `mint_tokens`, `create_tokens_batch`. **Must be ≥ 0.**                     |
| `metadata_fee`    | `i128`       | Fee charged for `set_metadata`. **Must be ≥ 0.**                                                           |

**Fee sign constraint:** Both `base_fee` and `metadata_fee` must be **≥ 0**. A value of `0` is explicitly permitted (free token creation is a valid use-case). Any negative value is rejected with `Error::InvalidParameters` before any state is written. This constraint exists because:

- A negative required fee satisfies every `fee_payment < required_fee` guard trivially, making the fee gate a no-op regardless of what the caller sends.
- A negative amount passed to `distribute_fee` produces a negative SEP-41 `transfer`, whose behavior is implementation-defined on the token contract and has not been audited for this factory.

Stamps `FactoryState.schema_version = CURRENT_SCHEMA_VERSION` and stores the same value under the legacy `sv` instance key so `migrate` works on pre-versioned deployments.

## Token Lifecycle

### Fee semantics: `fee_payment` is an upper bound, not the amount charged

Every fee-gated entrypoint (`create_token`, `create_tokens_batch`, `mint_tokens`, `set_metadata`) takes a `fee_payment` argument. **`fee_payment` is the maximum the caller authorizes to be spent — the same pattern as `amount`/`max_amount` in DEX contracts — not the amount actually transferred.** The contract:

1. Rejects the call with `Error::InsufficientFee` if `fee_payment` is below the currently required fee (`base_fee`, `base_fee * tokens.len()`, or `metadata_fee`).
2. Otherwise transfers **exactly the required fee** — never more, regardless of how much headroom `fee_payment` included.

This matters because clients conventionally pad `fee_payment` above the currently displayed fee so the transaction still succeeds if the admin updates fees before it lands (see the fee-update race below). Before this behavior was fixed (issue #1008), the contract charged the caller's full `fee_payment` — any padding, unit-confused value (e.g. XLM vs. stroops), or stale cached fee was kept in full with no refund. Callers should still pass a value they consider a hard ceiling, since that's what they can lose in the worst case (e.g. if the required fee rises right up to that ceiling before the transaction lands), but any padding above the fee that's actually charged is always returned to the caller by simply never being transferred.

**Fee-update race:** if the admin raises the required fee between when a caller signs a transaction and when it lands, and the caller's `fee_payment` no longer covers the new fee, the call fails cleanly with `Error::InsufficientFee` and **no** value moves — not at the old rate, not at the new rate, not partially. The fee-gate check happens before any transfer.

### `create_token(creator, salt, name, symbol, decimals, initial_supply, max_supply, fee_payment)`

Deploy a new token contract under the factory. Requires `fee_payment >= base_fee`; charges exactly `base_fee`. Returns the deployed contract address.

| Param            | Type           | Description                                                                                                        |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `creator`        | `Address`      | Token creator; must authorize the call and pays the fee.                                                           |
| `salt`           | `BytesN<32>`   | Deterministic-deploy salt.                                                                                         |
| `name`           | `String`       | 1–32 bytes.                                                                                                        |
| `symbol`         | `String`       | 1–12 bytes.                                                                                                        |
| `decimals`       | `u32`          | 0–18.                                                                                                              |
| `initial_supply` | `i128`         | Amount minted to `creator` at creation. **Must be ≥ 0** (`0` mints nothing).                                       |
| `max_supply`     | `Option<i128>` | Optional supply cap. `Some(cap)` requires `cap > 0` and `cap >= initial_supply`; `None` creates an uncapped token. |
| `fee_payment`    | `i128`         | Caller-authorized fee upper bound (see fee semantics above).                                                       |

> **ABI change (issue #1022):** `initial_supply` was widened/retyped from `u128` to **`i128`** (matching the SDK's `mint` signature and the batch path), and the **`max_supply: Option<i128>`** parameter was added so single-token creation can cap supply with the same Issue #1006 accounting as the batch path. This changes the on-chain argument list; the frontend wrapper (`frontend/src/services/stellar.ts → deployToken`) was updated in the same change.

The single (`create_token`) and batch (`create_tokens_batch`) paths share one validation routine and one bookkeeping routine, so a given invalid parameter set is rejected with the **same error code** on either path:

| Fault                                                                         | Error                       |
| ----------------------------------------------------------------------------- | --------------------------- |
| `name` empty or > 32 bytes, or `symbol` empty or > 12 bytes                   | `Error::InvalidTokenParams` |
| `decimals` > 18                                                               | `Error::InvalidDecimals`    |
| `initial_supply` < 0, or `max_supply` ≤ 0, or `max_supply` < `initial_supply` | `Error::InvalidParameters`  |

### `create_tokens_batch(creator, tokens, fee_payment)`

Atomically deploy `tokens` (a `Vec<BatchTokenParams>`, each with the same `name`/`symbol`/`decimals`/`initial_supply`/`max_supply` fields validated identically to `create_token`). Requires `fee_payment >= base_fee * tokens.len()`; charges exactly `base_fee * tokens.len()`. All parameter validation (name, symbol, decimals, initial supply, `max_supply`, and total `token_count` arithmetic overflow checks) is front-loaded before any contract deployment or state locking begins, using the same shared `validate_token_params` routine as the single path — so the two entrypoints accept and reject exactly the same parameter sets with the same error codes. Furthermore, Soroban's per-invocation transaction atomicity guarantees that if any failure or host error occurs during execution, all state changes, sub-token deployments, and supply mints within the transaction are completely reverted at the ledger level.

#### Batch size limits and resource costs

Soroban transactions are subject to per-transaction resource budgets enforced by the ledger. Exceeding these limits causes an immediate `ExceededLimit` error and costs the full simulation fee — the user never gets a refund.

The table below shows measured CPU instructions and memory bytes consumed by `create_tokens_batch` at representative batch sizes. Numbers were obtained by running the benchmark harness in `contracts/token-factory/src/bench.rs` via `cargo test bench_ -- --nocapture` and comparing against the Soroban mainnet resource limits. **Important:** the Soroban native test environment underestimates real WASM CPU instruction counts (~30×) and memory (~5×) compared to an actual on-chain simulation, so the values below are used for _relative_ regression detection — the production limits column reflects real network values.

| Batch size | Test-env CPU (M insns) | Test-env Mem (MB) | Ledger reads | Ledger writes |  Within mainnet limits?   |
| :--------: | ---------------------: | ----------------: | -----------: | ------------: | :-----------------------: |
|     1      |                ~0.65 M |           ~1.1 MB |            6 |             6 |            ✅             |
|     5      |                 ~2.5 M |           ~4.3 MB |           18 |            18 |            ✅             |
|     10     |                 ~4.9 M |           ~8.6 MB |           33 |            33 |            ✅             |
|     15     |                 ~7.3 M |            ~13 MB |           48 |            48 |            ✅             |
|     20     |                 ~9.7 M |            ~17 MB |           63 |            63 | ✅ ← **recommended max**  |
|     25     |                  ~12 M |            ~22 MB |           78 |            78 | ⚠️ approaches write limit |

**Current Soroban per-transaction limits (Stellar Protocol 21+, mainnet):**

| Resource               | Mainnet limit            |
| ---------------------- | ------------------------ |
| CPU instructions       | 600 000 000 (600 M)      |
| Memory                 | 41 943 040 bytes (40 MB) |
| Ledger entries (read)  | 100 per transaction      |
| Ledger entries (write) | 50 per transaction       |

> **Note:** The test-harness numbers above are native Rust measurements. Actual on-chain WASM costs are ~30× higher for CPU and ~5× higher for memory. At batch size 20 the extrapolated WASM-equivalent values are approximately 290 M CPU instructions and 85 MB memory — comfortably within the 600 M CPU limit but approaching the 40 MB memory limit. This provides a margin of ~52 % on CPU and ~0 % margin on memory at the extrapolated scale, which is why **20 is the recommended cap** rather than a higher number.
>
> Protocol limits may change with network upgrades. Re-run the benchmark harness after each SDK bump and update this table. The CI job in `.github/workflows/benchmarks.yml` runs on every PR touching `contracts/` and surfaces regressions automatically.

**✅ Maximum batch size: 20 tokens (contract-enforced)**

This limit is enforced on-chain: `create_tokens_batch` rejects any call with more than `MAX_BATCH_SIZE` (20) entries with `Error::BatchSizeExceeded`, checked before any per-item validation or deployment work begins. The frontend (`frontend/src/utils/validation.ts → validateBatchSize`) mirrors the same value for early client-side feedback, but the contract is the source of truth and rejects oversized batches regardless of caller.

If you need to deploy more than 20 tokens, split them into multiple sequential `create_tokens_batch` calls, each containing ≤ 20 entries.

### `mint_tokens(token_address, admin, to, amount, fee_payment)`

Mint `amount` of `token_address` to `to`. Requires `fee_payment >= base_fee`; charges exactly `base_fee`. Rejects when a `max_supply` cap would be exceeded (`Error::MaxSupplyExceeded`).

#### Supply cap accounting

`max_supply` (set per-token via `create_token`'s `max_supply` argument or `create_tokens_batch`'s `BatchTokenParams.max_supply`) is enforced against a running counter stored under the persistent key `(token_address, "supply")`, not against the token's live balance. Every successful `mint_tokens` call adds `amount` to this counter and rejects the call if the result would exceed the cap.

**What counts toward the cap:** the token's `initial_supply` (minted at creation, before the token even has a `TokenInfo` entry to check against) **plus** every amount minted afterward via `mint_tokens`. As of the fix for issue #1006, the shared `record_token` routine (used by both creation paths) seeds the counter with `initial_supply` at creation time whenever `max_supply` is set, so a token created with `initial_supply == max_supply` can never be minted again — any `mint_tokens` call on it fails with `MaxSupplyExceeded`.

`burn` does **not** decrement this counter — burning tokens frees up balance for the holder but does not restore headroom under the cap. The cap therefore bounds _cumulative_ mints (initial + all `mint_tokens` calls), not net circulating supply.

**Back-fill for tokens created before this fix:** capped tokens deployed by a factory binary older than this fix have an under-seeded (or entirely absent) supply counter — `mint_tokens` would have read it as `0` regardless of `initial_supply`, letting the cap be bypassed. The factory has no on-chain record of a pre-fix token's true `initial_supply` to recover it automatically (`TokenInfo` never stored it, and standard SEP-41 tokens don't expose a `total_supply` query), so this cannot be fixed by `migrate()` alone. Operators must:

1. Reconstruct the token's true cumulative minted amount off-chain — the most reliable source is summing every `mint` event the token contract itself has emitted since deployment (queryable via RPC/Horizon `get_events`, independent of what the factory stored).
2. Call `backfill_capped_supply(admin, token_address, verified_supply)` once per affected token with that reconstructed value.

`backfill_capped_supply` is admin-only, requires the token to have `max_supply` configured, rejects a `verified_supply` outside `[0, max_supply]`, and can only be applied once per token (subsequent calls fail with `Error::AlreadyBackfilled`) — it cannot be used as a repeated backdoor to rewrite tracked supply.

### `burn(token_address, from, amount)`

Burn `amount` of `token_address` from `from`'s balance.

`token_address` **must** be a token this factory deployed. The factory resolves it through the `TokenIndex(address)` mapping _before_ making any cross-contract call; an address the factory never registered is rejected with `Error::TokenNotFound` and the factory never invokes it. This closes an open-proxy hole where `burn` would otherwise forward the call to (and emit an official-looking `burn` event for) an arbitrary external contract. Holders of non-factory tokens can always burn directly on those tokens' own contracts.

Because the registration lookup is mandatory, the `burn_enabled` gate is unconditional: burning is rejected with `Error::Unauthorized` whenever the token's `burn_enabled` flag is `false`, with no bypass. Other errors: `Error::InvalidBurnAmount` for a zero or negative `amount`, and `Error::BurnAmountExceedsBalance` when `amount` exceeds `from`'s balance.

### `set_metadata(token_address, admin, metadata_uri, fee_payment)`

Set or update the metadata URI for an existing token. Requires `fee_payment >= metadata_fee`; charges exactly `metadata_fee`.

The contract stores the URI opaquely and does not validate the document it points at. The frontend does, and enforces length caps on `name` and `description` plus an `ipfs://`-only rule for `image` when rendering — see [Token Metadata Format](./metadata-format.md) before pinning your own metadata.

**URI validation (enforced on-chain):**

| Rule                          | Error                |
| ----------------------------- | -------------------- |
| `metadata_uri` is empty       | `InvalidMetadataUri` |
| Does not start with `ipfs://` | `InvalidMetadataUri` |
| No CID after the prefix       | `InvalidMetadataUri` |
| `len > 128` bytes             | `InvalidMetadataUri` |

**Mutability:** Metadata is no longer write-once. A creator may update the URI up to `METADATA_MAX_UPDATES` (currently **5**) times total. Once the update count is exhausted the URI is automatically frozen (`MetadataFrozen`). Creators may also explicitly freeze at any time via `freeze_metadata`.

Emits a `meta` event with `(token_address, metadata_uri, version)` on every successful update so the full history is auditable on-chain.

### `freeze_metadata(token_address, admin)`

Permanently freeze a token's metadata URI so it can no longer be updated. Only the token creator may call this. Idempotent — calling on an already-frozen token is a no-op. Emits a `meta_frz` event.

### `is_metadata_frozen(token_address) → bool`

Return `true` if the token's metadata has been frozen (either explicitly or by reaching the update cap).

### `get_metadata_version(token_address) → u32`

Return the current metadata update version (0 = never set, 1 = first set, …, up to `METADATA_MAX_UPDATES = 5`).

### `set_burn_enabled(token_address, admin, enabled)`

Toggle the burn flag for a token.

## View Functions

### `get_state() → FactoryState`

Inspect factory configuration and aggregate counts. As of schema version 4, the returned `FactoryState` also includes `pending_admin: Option<Address>` (the proposed-but-not-yet-accepted admin, or `None`) and `pending_admin_expiry: Option<u64>` (the ledger sequence at which the proposal lapses, or `None`). Callers can use these fields to detect a pending rotation before it completes.

### `get_base_fee() → i128`

Current base fee.

### `get_metadata_fee() → i128`

Current set-metadata fee.

### `get_token_info(index) → TokenInfo`

Look up a single token by 1-based index. Returns `Error::TokenNotFound` for unknown indices.

### `get_token_index(token_address) → u32`

Resolve a token's 1-based storage index from its contract address, via the `TokenIndex(address)` mapping written at creation. Returns `Error::TokenNotFound` for addresses not registered with this factory. This is the authoritative address → index lookup — clients must not re-derive identity from the factory event stream, which only reflects a bounded RPC retention window.

### `get_token_address(index) → Address`

The inverse of `get_token_index`: resolve a token's contract address from its 1-based creation index. Returns `Error::TokenNotFound` for an index that was never registered.

This is what makes the factory's token set **enumerable from contract state alone** — a client can walk `1..=get_state().token_count` and resolve every token without depending on the RPC's event-retention window. `get_token_info(index)` deliberately carries no address, so before this mapping existed an off-chain indexer could only learn addresses from `created` events and therefore could never recover tokens older than that window (issue #943).

Tokens created by a factory binary predating this mapping return `TokenNotFound`; repair them with `backfill_token_address`.

### `backfill_token_address(token_address) → u32`

Populate the `index → address` mapping for a token created before it existed, returning the index that was mapped. Idempotent: re-running for an already-mapped token is a no-op that returns the same index.

**Permissionless by design, and safe because it is self-verifying.** The index is never taken from the caller — it is read back from the token's own authoritative `TokenIndex(address)` entry, so the only mapping that can ever be written is the one the factory itself recorded at creation time. Supplying an address the factory never registered returns `Error::TokenNotFound`, and an index already mapped to a different token cannot be repointed. That is what makes it safe to expose to the indexer, which is the component that needs it and holds no admin key.

### `get_token_info_by_address(token_address) → TokenInfo`

Return a token's full `TokenInfo` addressed by its contract address — equivalent to `get_token_info(get_token_index(address))` in a single call. This is the **source of truth** for a token's name, symbol, decimals, creator and creation time; unlike event-derived data it is unaffected by RPC event retention, so a token created arbitrarily long ago still resolves correctly. Returns `Error::TokenNotFound` for unregistered addresses (including the case where the index mapping exists but the `TokenInfo` entry is missing).

### `get_metadata(token_address) → Option<String>`

Return the metadata URI set for a token via `set_metadata`, or `None` if none was set. Reads directly from `Metadata(address)` state instead of scanning `meta` events (which are subject to the same retention truncation).

### `get_tokens_by_creator(creator, offset, limit) → Vec<u32>`

Return a paginated slice of token indices owned by `creator`. This replaces an earlier non-paginated version that returned the full `Vec<u32>` (which could exceed Stellar ledger entry size limits on creators with hundreds of registered tokens).

| Param     | Type      | Description                                                                                                                                                     |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creator` | `Address` | Creator whose tokens to list.                                                                                                                                   |
| `offset`  | `u32`     | 0-based index of the first element to return.                                                                                                                   |
| `limit`   | `u32`     | Maximum number of elements to return. Capped server-side at `MAX_TOKENS_BY_CREATOR_PAGE` (currently `50`) so callers cannot request pathologically large pages. |

**Returns:** `Vec<u32>` of token indices, len ≤ `min(limit, MAX_TOKENS_BY_CREATOR_PAGE)`. Use the indices with `get_token_info` to materialize each token's `TokenInfo`.

**Behavior:**

| Input                                | Output                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `limit == 0`                         | empty `Vec` (defensive — read-only path, no error)    |
| `limit > MAX_TOKENS_BY_CREATOR_PAGE` | clamped down to the cap                               |
| `offset >= total_tokens_for_creator` | empty `Vec` (past-the-end)                            |
| Unknown creator                      | empty `Vec`                                           |
| Otherwise                            | slice `[offset, offset + min(limit, cap, remaining))` |

To iterate the full list:

1. Call with `offset = 0, limit = 50`.
2. If response.length < 50 → you're done.
3. Otherwise advance `offset += response.length` and repeat.

The frontend helper `fetchAllTokensByCreator` in `frontend/src/hooks/useTokens.ts` does this loop automatically.

## Admin & Governance

### `update_fees(admin, base_fee?, metadata_fee?)`

Adjust either fee. `None` leaves the corresponding fee unchanged.

**Fee sign constraint:** Any `Some(value)` provided for `base_fee` or `metadata_fee` must be **≥ 0**. Negative values are rejected with `Error::InvalidParameters` and the stored fees are left unchanged. The same constraint applies as for `__constructor` — see that section for the rationale.

### `pause(admin)` / `unpause(admin)`

Toggle factory-wide pause. `create_token`, `create_tokens_batch`, `mint_tokens`, and `set_metadata` honor the pause; `burn` does not (users can always burn their own balance).

### `set_fee_split(admin, splits)`

Set a fee split where `splits` is a `Map<Address, u32>` of basis-point recipients summing to `10_000`. Empty map clears the split (full fee goes back to `treasury`).

**Constraints enforced at configuration time:**

| Rule                     | Error                       |
| ------------------------ | --------------------------- |
| `splits.len() > 10`      | `TooManyFeeSplitRecipients` |
| Any entry has `bps == 0` | `ZeroFeeSplitEntry`         |
| `sum(bps) != 10_000`     | `InvalidFeeSplit`           |

**Cap:** Maximum `10` recipients per split (`MAX_FEE_SPLIT_RECIPIENTS`). This bounds the number of cross-contract transfer calls per user transaction and keeps per-transaction gas predictable.

**Rounding:** `distribute_fee` uses the **largest-remainder method**. Each recipient's share is `floor(amount * bps / 10_000)`. Remainder stroops (at most `recipients - 1`) are awarded one-at-a-time to the entries with the largest fractional parts, so the sum of all transfers always equals the full fee amount. No recipient with non-zero `bps` receives zero forever as long as the fee amount is ≥ 1 stroop (the largest-remainder guarantee).

**Per-recipient failure isolation:** `distribute_fee` pays each split recipient with the non-panicking `try_transfer` rather than `transfer`. If a recipient's address cannot accept the fee token (frozen account, revoked trustline, clawback-locked balance, or a misbehaving contract address), that single transfer failure does **not** abort the call — the recipient's share is redirected to `treasury` instead, and a `fee_redir` event is emitted naming the skipped recipient and the redirected amount, so an admin can detect and fix a broken split (via `set_fee_split`) without reading contract logs. This holds for both the split path and the non-split (`treasury`-only) path. `treasury` itself is the terminal fallback: if the payment (or redirect) to `treasury` fails there is nowhere else to send the funds, so `distribute_fee` returns `Error::TreasuryTransferFailed` and the whole call reverts.

Emits a `split_set` event on successful configuration and a `split_clr` event when the split is cleared.

**Recipient cap:** `splits` may contain at most **10 recipients** (`MAX_FEE_SPLIT_RECIPIENTS`). Exceeding it is rejected with `Error::TooManyFeeSplitRecipients` before the basis-point sum is even checked. This exists because `distribute_fee` transfers a share to every configured recipient on **every** `create_token`, `create_tokens_batch`, `mint_tokens`, and `set_metadata` call — an unbounded admin-configured split would make every fee-paying call on the contract arbitrarily expensive for the caller, and risk exceeding Soroban's per-transaction resource limits outright.

The cap is conservative: typical treasury + referral + protocol-fund structures need ≤ 5 recipients, and the benchmark harness (`contracts/token-factory/src/bench.rs`, `bench_fee_split_mint_*`, `bench_fee_split_at_max_within_limits`) confirms `distribute_fee`'s cost at 10 recipients stays comfortably within Soroban's per-transaction resource limits — ledger _writes_ are the binding resource (each non-zero-share recipient writes a new SEP-41 balance entry), not CPU or memory.

### `get_fee_split() → Map<Address, u32>`

Read the current split (empty map means no split).

### `propose_admin(current_admin, new_admin)` — step 1

Propose a new admin address. The current admin calls this to name a successor. The proposal is stored in `FactoryState` and expires after `ADMIN_PROPOSAL_TTL_LEDGERS` ledgers (~28 hours at 6 seconds/ledger). If a second proposal is issued before the first is accepted or cancelled, it **overwrites** the first, resetting the expiry.

| Param           | Type      | Description                                           |
| --------------- | --------- | ----------------------------------------------------- |
| `current_admin` | `Address` | Current admin; must authorize this call.              |
| `new_admin`     | `Address` | Proposed successor. Must differ from `current_admin`. |

Emits `adm_prop` with `(current_admin, new_admin, expiry_ledger)`.

Errors: `Unauthorized` if caller is not the current admin; `InvalidParameters` for self-proposal.

### `accept_admin(new_admin)` — step 2

Complete a pending rotation. **The proposed admin** calls this, proving they control the proposed key. Only succeeds when a live (non-expired) proposal exists for `new_admin`.

| Param       | Type      | Description                                                         |
| ----------- | --------- | ------------------------------------------------------------------- |
| `new_admin` | `Address` | The address that was named in the most recent `propose_admin` call. |

Emits `adm_acc` with `(old_admin, new_admin)` on success.

Errors:

- `NoPendingProposal` (code 26) — no proposal is pending, or `new_admin` does not match the proposed address.
- `ProposalExpired` (code 27) — the proposal's expiry ledger has passed. The rejection reverts the call, so the expired proposal stays on record but can never be accepted; the current admin clears it with `cancel_admin_proposal` or replaces it with a new `propose_admin` call.

### `cancel_admin_proposal(current_admin)`

Cancel a live proposal. Only the current admin may cancel. Idempotent when no proposal is pending. Emits `adm_can` with `(current_admin, cancelled_address)`.

### `transfer_admin(admin, new_admin)` / `update_admin(current_admin, new_admin)` — deprecated

> ⚠️ **Deprecated. These do not complete a rotation.** Use `propose_admin` + `accept_admin` directly. Do **not** decommission the outgoing admin key until `accept_admin` has succeeded — see [issue #1159](https://github.com/Favourorg/Stellar-forge/issues/1159).

These names are retained so tooling built before the two-step model keeps working. **Both delegate to `propose_admin`** — neither completes the rotation on its own. Before the two-step model both performed an immediate, unverified single-step rotation; there is now **no single-step rotation path** in the contract. Every rotation takes two transactions: propose (current admin) and accept (new admin).

Because that downgrade would otherwise be invisible to a caller — a successful transaction that used to mean "rotated" now means "proposed" — both entrypoints report the difference twice over:

**1. Return value.** They return an `AdminRotationReceipt` rather than `void`:

| Field                | Type      | Value                                                                                                                |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `rotation_complete`  | `bool`    | Always `false` — `state.admin` is unchanged.                                                                         |
| `pending_admin`      | `Address` | The address that must accept.                                                                                        |
| `expires_at_ledger`  | `u64`     | Ledger at which the proposal lapses; after this only a new proposal from the current admin can restart the rotation. |
| `required_next_call` | `Symbol`  | `accept_admin`.                                                                                                      |

A client that decodes the old `void` return fails loudly on this value instead of silently reporting success.

**2. Event.** They emit `adm_dep` with `(current_admin, new_admin, expiry_ledger, deprecated_entrypoint)` **in addition to** `adm_prop`. Existing `adm_prop` monitoring is unaffected; `adm_dep` is the distinct signal that some caller is still driving rotations through a pre-two-step entrypoint, which is the condition that precedes an abandoned proposal quietly expiring.

Errors and auth are identical to `propose_admin`.

Operational guidance for completing and monitoring a rotation lives in [`docs/incident-response.md` §2.5](./incident-response.md#25-stale-pending-admin-proposals) and the [mainnet deployment checklist](./mainnet-deployment-checklist.md).

### `propose_upgrade(admin, new_wasm_hash)`

Step 1 of the mandatory two-step upgrade flow (issue #6). Records `new_wasm_hash` as the pending upgrade candidate and sets `pending_upgrade_ready_at` to `current_ledger + UPGRADE_TIMELOCK_LEDGERS` (~17,280 ledgers ≈ 28.8 hours). Emits `upg_prop`. Admin-only.

Issuing a second proposal overwrites the first, resetting the timelock clock.

| Param           | Type          | Description                                     |
| --------------- | ------------- | ----------------------------------------------- |
| `admin`         | `Address`     | Must be the current factory admin; `require_auth` enforced. |
| `new_wasm_hash` | `BytesN<32>`  | Hash of the WASM to swap to.                    |

### `execute_upgrade(admin, new_wasm_hash)`

Step 2 of the upgrade flow. Swaps the contract's executable WASM to `new_wasm_hash`, but only if all of the following are true: (a) a proposal for that exact hash was previously recorded via `propose_upgrade`, (b) the current ledger sequence ≥ `pending_upgrade_ready_at`, and (c) the caller is the factory admin. Emits `upg_exec`. Fails with `Error::NoUpgradePending` (29), `Error::UpgradeNotReady` (28), or `Error::UpgradeHashMismatch` (30) otherwise.

| Param           | Type          | Description                                            |
| --------------- | ------------- | ------------------------------------------------------ |
| `admin`         | `Address`     | Must be the current factory admin; `require_auth` enforced. |
| `new_wasm_hash` | `BytesN<32>`  | Must exactly match the hash passed to `propose_upgrade`. |

### `cancel_upgrade(admin)`

Abort a pending upgrade proposal at any time before execution. Idempotent — calling when nothing is pending is a no-op. Emits `upg_can` when a live proposal is cancelled. Admin-only.

### `migrate(admin)`

Incrementally upgrades state between schema versions. Idempotent — safe to call repeatedly, including mid-migration.

- Version 2: bumps the version marker for the issue #1006 max-supply fix — it does not automatically back-fill any capped token's supply counter (see `backfill_capped_supply` below and "Supply cap accounting" above).
- Version 3: moves `TokenInfo` entries from `instance` to `persistent` storage (issue #1007 — see "Storage architecture" above), walking `token_count` in bounded chunks per call. If `token_count` is large enough that one call can't finish the walk, `schema_version` stays at 2 and a subsequent `migrate` call resumes from where the last one left off; every other affected key (`TokenIndex`, `Metadata`, `owner`, `supply`, `CreatorTokens`) migrates lazily on next access regardless of whether this step has completed.
- Version 4: adds `pending_admin: Option<Address>` and `pending_admin_expiry: Option<u64>` to `FactoryState` for two-step admin rotation. Both fields default to `None` — no behavioral change until `propose_admin` is first called. Call `migrate` once after upgrading to this version; subsequent calls are idempotent.
- Version 5: adds `pending_upgrade_hash: Option<BytesN<32>>` and `pending_upgrade_ready_at: Option<u64>` to `FactoryState` for the two-step upgrade timelock (issue #6). Both fields default to `None` — no behavioral change until `propose_upgrade` is first called. Call `migrate` once after upgrading to this version; subsequent calls are idempotent.

### `backfill_capped_supply(admin, token_address, verified_supply)`

One-time back-fill of the tracked-supply counter for a capped token created before the issue #1006 fix. See "Supply cap accounting" above for the full procedure. Admin-only; fails with `Error::TokenNotFound` if the token doesn't exist, `Error::InvalidParameters` if the token has no `max_supply` or `verified_supply` is outside `[0, max_supply]`, and `Error::AlreadyBackfilled` if already applied to this token.

### `add_to_whitelist(admin, address)` / `remove_from_whitelist(admin, address)`

Add or remove an address from the factory whitelist. Emits `wl_add` / `wl_rm` events. Only the factory admin may call these.

### `set_whitelist_enabled(admin, enabled)`

Toggle whitelist enforcement on or off. When `enabled = true`, only addresses that have been added to the whitelist via `add_to_whitelist` may call `create_token` or `create_tokens_batch` — attempts from non-whitelisted addresses return `Error::NotWhitelisted` (code 20). Emits a `wl_tog` event.

When `enabled = false` (the default after `initialize` and after `migrate`), the factory is open to all creators and the whitelist contents are ignored.

**Decision: mint_tokens and set_metadata are not gated.**  
These operations are only available to existing token creators (the `owner` of a deployed token contract), so they already passed the whitelist gate at creation time. Gating them again would lock out operators who created tokens before whitelisting was enabled.

### `is_whitelisted(address) → bool`

Read-only: returns `true` if `address` is on the whitelist.

| Param     | Type      | Description       |
| --------- | --------- | ----------------- |
| `address` | `Address` | Address to query. |

## Errors

| Code | Symbol                      | When                                                                                   |
| ---- | --------------------------- | -------------------------------------------------------------------------------------- |
| 1    | `InsufficientFee`           | `fee_payment < required_fee`                                                           |
| 2    | `Unauthorized`              | caller is not allowed for this operation                                               |
| 3    | `InvalidParameters`         | argument out of range or malformed                                                     |
| 4    | `TokenNotFound`             | unknown token index or address                                                         |
| 5    | `MetadataAlreadySet`        | _(deprecated — retained for ABI compatibility; no longer returned by `set_metadata`)_  |
| 6    | `AlreadyInitialized`        | double-initialize attempt                                                              |
| 7    | `BurnAmountExceedsBalance`  | `burn` > balance                                                                       |
| 8    | `BurnNotEnabled`            | burning on a token that has been disabled                                              |
| 9    | `InvalidBurnAmount`         | zero or negative burn                                                                  |
| 10   | `ContractPaused`            | operation blocked because factory is paused                                            |
| 11   | `Reentrancy`                | concurrent reentrant call detected                                                     |
| 12   | `ArithmeticOverflow`        | checked-op failed                                                                      |
| 13   | `StateNotFound`             | factory not yet initialized                                                            |
| 14   | `InvalidTokenParams`        | name/symbol validation failed during token creation                                    |
| 15   | `InvalidDecimals`           | decimals outside `[0, 18]`                                                             |
| 16   | `MaxSupplyExceeded`         | mint would exceed cap                                                                  |
| 17   | `InvalidFeeSplit`           | `set_fee_split` map bps do not sum to 10_000                                           |
| 18   | `TooManyFeeSplitRecipients` | `set_fee_split` map has more than `MAX_FEE_SPLIT_RECIPIENTS` (10) recipients           |
| 19   | `AlreadyBackfilled`         | `backfill_capped_supply` already applied for this token                                |
| 20   | `NotWhitelisted`            | creator is not on the whitelist when enforcement is enabled                            |
| 21   | `InvalidMetadataUri`        | URI is empty, missing `ipfs://` prefix, exceeds 128 bytes, or has no CID               |
| 22   | `ZeroFeeSplitEntry`         | `set_fee_split` map contains an entry with `bps == 0`                                  |
| 23   | `MetadataFrozen`            | metadata is frozen (via `freeze_metadata` or auto-freeze after max updates)            |
| 24   | `TreasuryTransferFailed`    | payment/redirect of a fee share to `treasury` itself failed (no further fallback)      |
| 25   | `BatchSizeExceeded`         | `create_tokens_batch` called with more than `MAX_BATCH_SIZE` (20) tokens               |
| 26   | `NoPendingProposal`         | `accept_admin` called with no live proposal, or the caller is not the proposed address |
| 27   | `ProposalExpired`           | the pending proposal's expiry ledger has passed; current admin must re-propose         |
| 28   | `UpgradeNotReady`           | `execute_upgrade` called before `UPGRADE_TIMELOCK_LEDGERS` have elapsed since `propose_upgrade` |
| 29   | `NoUpgradePending`          | `execute_upgrade` called when no upgrade proposal is recorded, or `cancel_upgrade` called with nothing pending |
| 30   | `UpgradeHashMismatch`       | `execute_upgrade` called with a hash that does not match the previously proposed hash  |

## Test/fuzz-only helpers

`fuzz_seed_token` (`src/lib.rs`, gated by `#[cfg(feature = "testutils")]`) is **not** a contract entrypoint — it is a plain associated function in a second, non-`#[contractimpl]` `impl TokenFactory` block, so it is compiled out of the production WASM entirely and never appears in the on-chain ABI. It exists so `contracts/token-factory/fuzz`'s targets (which depend on this crate as an ordinary library and so cannot reach its private `DataKey`/`TokenInfo` types any other way) can register a token in factory storage — mirroring what `create_token` writes — without a real token WASM to install at `token_wasm_hash`, which `cargo test`/fuzzing can't provide (see `mod bench`'s note in `src/lib.rs`). See `contracts/token-factory/fuzz/README.md` for how it's used.

## Events

The contract emits Soroban events on a `(factory, action)` topic. The frontend parses them via `frontend/src/services/stellar-impl.ts`. Events:

| Action      | Payload                                                            | Trigger                                                                            |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `init`      | `(admin)`                                                          | `initialize`                                                                       |
| `init`      | `(admin)`                                                          | `__constructor`                                                                    |
| `created`   | `(token_address, creator, name, symbol)`                           | `create_token` / `create_tokens_batch`                                             |
| `meta`      | `(token_address, metadata_uri, version)`                           | `set_metadata` (every update)                                                      |
| `meta_frz`  | `(token_address, admin)`                                           | `freeze_metadata`                                                                  |
| `mint`      | `(token_address, to, amount)`                                      | `mint_tokens`                                                                      |
| `burn`      | `(token_address, from, amount)`                                    | `burn`                                                                             |
| `fees`      | `(base_fee, metadata_fee)`                                         | `update_fees`                                                                      |
| `split_set` | `(admin, splits)`                                                  | `set_fee_split` (non-empty)                                                        |
| `split_clr` | `(admin)`                                                          | `set_fee_split` (empty — clears split)                                             |
| `fee_redir` | `(recipient, share)`                                               | `distribute_fee` (recipient `try_transfer` failed; share redirected to `treasury`) |
| `pause`     | `(admin)`                                                          | `pause`                                                                            |
| `unpause`   | `(admin)`                                                          | `unpause`                                                                          |
| `adm_prop`  | `(current_admin, new_admin, expiry_ledger)`                        | `propose_admin` / `transfer_admin` / `update_admin`                                |
| `adm_acc`   | `(old_admin, new_admin)`                                           | `accept_admin`                                                                     |
| `adm_can`   | `(current_admin, cancelled_admin)`                                 | `cancel_admin_proposal`                                                            |
| `adm_dep`   | `(current_admin, new_admin, expiry_ledger, deprecated_entrypoint)` | `transfer_admin` / `update_admin` (emitted alongside `adm_prop`)                   |
| `upg_prop`  | `(admin, new_wasm_hash, ready_at_ledger)`                          | `propose_upgrade` — upgrade scheduled; cancellable until `ready_at_ledger`         |
| `upg_exec`  | `(admin, new_wasm_hash)`                                           | `execute_upgrade` — WASM swap completed                                            |
| `upg_can`   | `(admin, cancelled_wasm_hash)`                                     | `cancel_upgrade` — pending upgrade aborted                                         |
| `wl_add`    | `(address)`                                                        | `add_to_whitelist`                                                                 |
| `wl_rm`     | `(address)`                                                        | `remove_from_whitelist`                                                            |
| `wl_tog`    | `(enabled)`                                                        | `set_whitelist_enabled`                                                            |

## Batch creation UI

The `create_tokens_batch` function is exposed in the frontend when a user chooses to deploy multiple tokens in one transaction.

### Client-side soft cap

The frontend enforces a hard cap of **20 tokens per batch** before the transaction is submitted. Attempting to submit more than 20 entries triggers a validation error:

```
Batch size of N exceeds the maximum recommended batch size of 20.
Please split your tokens into multiple batches of ≤ 20 to avoid
a failed on-chain transaction. Each failed submission still costs
the simulation fee.
```

This validation is implemented in `frontend/src/utils/validation.ts` (`validateBatchSize`) and is checked in the batch creation form before the user is allowed to sign with Freighter.

### Keeping resource cost documentation current

Resource numbers in the table above are generated by the benchmark harness in `contracts/token-factory/src/bench.rs`. The CI job in `.github/workflows/benchmarks.yml` runs automatically on every PR that touches `contracts/` and posts a comparison report to the job summary.

To regenerate the numbers locally and compare against the baseline:

```bash
cd contracts/token-factory
cargo test bench_ -- --nocapture 2>/dev/null | python3 ../../scripts/check_benchmarks.py
```

To update the baseline after an intentional resource change (e.g., a new SDK bump or refactor):

```bash
cd contracts/token-factory
cargo test bench_ -- --nocapture 2>/dev/null | \
  python3 ../../scripts/check_benchmarks.py --update-baseline
```

Or trigger it from GitHub Actions: go to **Actions → Contract Benchmarks → Run workflow** and set **Update baseline** to `true`.

The benchmark harness (`.../src/bench.rs`) also includes a sanity-check test (`bench_create_token_within_limits`) that asserts `create_token` stays below 50 % of the mainnet CPU and memory limits in the native test environment, providing an early warning for accidental bloat.
