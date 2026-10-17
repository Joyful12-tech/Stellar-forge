//! Soroban resource benchmark harness for the token-factory contract.
//!
//! Measures CPU instructions and memory bytes consumed by each entrypoint
//! using the Soroban test environment's built-in cost metering
//! (`env.cost_estimate().resources()`).  `Env::default()` already enables
//! invocation metering automatically in test builds, so no extra setup is
//! required.
//!
//! Run the benchmarks and emit a JSON report to stdout:
//!
//! ```bash
//! cd contracts/token-factory
//! cargo test --test bench -- --nocapture 2>/dev/null
//! ```
//!
//! Or run through the convenience wrapper that also writes the JSON file:
//!
//! ```bash
//! cd contracts/token-factory
//! cargo test bench_ -- --nocapture 2>/dev/null | \
//!   python3 ../../scripts/collect_benchmarks.py
//! ```
//!
//! The CI job in `.github/workflows/benchmarks.yml` runs this automatically
//! on every PR touching `contracts/` and compares the output against the
//! committed baseline in `bench_snapshots/baseline.json`.

extern crate std;
use std::{format, println};

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, BytesN, Env, Map, String, Vec,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

/// Build a fee-split `Map<Address, u32>` with `n` distinct recipients whose
/// basis points sum to exactly 10_000, for measuring `distribute_fee`'s cost
/// as a function of recipient count.
fn fee_split_with_recipients(env: &Env, n: u32) -> Map<Address, u32> {
    let mut m = Map::new(env);
    let share = 10_000 / n;
    let mut distributed: u32 = 0;
    for i in 0..n {
        // The last recipient absorbs the rounding remainder so the total is
        // always exactly 10_000, matching `set_fee_split`'s validation.
        let bps = if i == n - 1 {
            10_000 - distributed
        } else {
            share
        };
        m.set(Address::generate(env), bps);
        distributed += bps;
    }
    m
}

/// Captured resource numbers for a single entrypoint invocation.
#[derive(Debug, Clone)]
pub struct BenchResult {
    pub label: std::string::String,
    pub cpu_insns: u64,
    pub mem_bytes: u64,
    pub ledger_reads: u32,
    pub ledger_writes: u32,
}

impl BenchResult {
    /// Emit as a single-line JSON object.  The CI script greps these lines
    /// to assemble the full report.
    pub fn print_json(&self) {
        println!(
            "BENCH_RESULT: {{\"label\":\"{}\",\"cpu_insns\":{},\"mem_bytes\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
            self.label,
            self.cpu_insns,
            self.mem_bytes,
            self.ledger_reads,
            self.ledger_writes,
        );
    }
}

/// Collect resource costs from the most recent top-level invocation.
fn capture(env: &Env, label: impl Into<std::string::String>) -> BenchResult {
    let res = env.cost_estimate().resources();
    BenchResult {
        label: label.into(),
        cpu_insns: res.instructions as u64,
        mem_bytes: res.mem_bytes as u64,
        ledger_reads: res.disk_read_entries,
        ledger_writes: res.write_entries,
    }
}

// ─── shared setup ─────────────────────────────────────────────────────────────

struct BenchSetup {
    env: Env,
    contract_id: Address,
    admin: Address,
    treasury: Address,
    fee_token: Address,
    creator: Address,
}

impl BenchSetup {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        // Disable the default mainnet resource-limit enforcement so that
        // multi-token batches aren't killed by the limits we're measuring.
        env.cost_estimate().disable_resource_limits();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let fee_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let creator = Address::generate(&env);

        // Fund creator with enough fee tokens.
        StellarAssetClient::new(&env, &fee_token).mint(&creator, &10_000_000);

        let contract_id = env.register(
            TokenFactory,
            TokenFactoryArgs::__constructor(
                &admin,
                &treasury,
                &fee_token,
                &dummy_hash(&env),
                &1_000,
                &500,
            ),
        );
        let client: TokenFactoryClient = TokenFactoryClient::new(&env, &contract_id);
        // SAFETY: identical lifetime extension used throughout test.rs in this workspace.
        let client: TokenFactoryClient<'static> = unsafe { core::mem::transmute(client) };

        // Avoid 0-timestamp on ledger entries for more realistic conditions.
        env.ledger().with_mut(|li| {
            li.timestamp = 1_700_000_000;
        });

        BenchSetup {
            env,
            contract_id,
            admin,
            treasury,
            fee_token,
            creator,
        }
    }

    fn client(&self) -> TokenFactoryClient<'_> {
        TokenFactoryClient::new(&self.env, &self.contract_id)
    }

    fn salt(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n; 32])
    }

    fn str(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    /// Create one token via `create_token` and return its address.
    fn create_one_token(&self, salt_byte: u8) -> Address {
        self.client().create_token(
            &self.creator,
            &self.salt(salt_byte),
            &self.str("TestToken"),
            &self.str("TST"),
            &7,
            &1_000_000i128,
            &None,
            &1_000,
        )
    }

    /// Register a token in factory storage as if `create_token` had run,
    /// backed by a real SEP-41 asset contract registered directly via
    /// `register_stellar_asset_contract_v2` rather than the factory's own
    /// WASM-deploy path. Mirrors `test.rs`'s `seed_token` helper. Used by the
    /// fee-split benchmarks below, which measure `distribute_fee`'s cost via
    /// `mint_tokens` and only need a mintable token, not a full deploy.
    fn seed_token(&self) -> Address {
        let token_addr = self
            .env
            .register_stellar_asset_contract_v2(self.creator.clone())
            .address();
        self.env.as_contract(&self.contract_id, || {
            let mut state: FactoryState =
                self.env.storage().instance().get(&DataKey::State).unwrap();
            state.token_count = state.token_count.checked_add(1).unwrap();
            let index = state.token_count;
            self.env.storage().instance().set(
                &DataKey::TokenInfo(index),
                &TokenInfo {
                    name: self.str("BenchToken"),
                    symbol: self.str("BNK"),
                    decimals: 7,
                    creator: self.creator.clone(),
                    created_at: 0,
                    burn_enabled: true,
                    max_supply: None,
                },
            );
            self.env.storage().instance().set(&DataKey::State, &state);
            self.env
                .storage()
                .instance()
                .set(&DataKey::TokenIndex(token_addr.clone()), &index);
            self.env
                .storage()
                .instance()
                .set(&(&token_addr, symbol_short!("owner")), &self.creator);
        });
        token_addr
    }

    /// Build a `Vec<BatchTokenParams>` of `n` entries.
    fn batch_params(&self, n: u8) -> Vec<BatchTokenParams> {
        let mut tokens: Vec<BatchTokenParams> = soroban_sdk::vec![&self.env];
        for i in 0..n {
            // Each token needs a unique salt so they deploy to different addresses.
            let mut salt_bytes = [0u8; 32];
            salt_bytes[0] = i.wrapping_add(1);
            salt_bytes[1] = 0xBE; // batch marker to avoid collisions with single-token tests
            let salt = BytesN::from_array(&self.env, &salt_bytes);

            let name = format!("Batch{}", i);
            let sym = format!("B{}", i);

            tokens.push_back(BatchTokenParams {
                salt,
                name: String::from_str(&self.env, &name),
                symbol: String::from_str(&self.env, &sym),
                decimals: 7,
                initial_supply: 1_000_000,
                max_supply: None,
            });
        }
        tokens
    }
}

// ─── benchmarks ───────────────────────────────────────────────────────────────

/// Benchmark `create_token` (single-token path).
#[test]
fn bench_create_token() {
    let s = BenchSetup::new();
    let result = s.client().try_create_token(
        &s.creator,
        &s.salt(1),
        &s.str("BenchToken"),
        &s.str("BNK"),
        &7,
        &500_000i128,
        &None,
        &1_000,
    );
    assert!(result.is_ok(), "bench_create_token failed: {:?}", result);

    let r = capture(&s.env, "create_token");
    r.print_json();

    // Ensure the numbers are non-trivial (sanity check that metering is active).
    assert!(r.cpu_insns > 0, "CPU instructions should be non-zero");
    assert!(r.mem_bytes > 0, "memory bytes should be non-zero");
}

/// Benchmark `create_tokens_batch` at batch size = 1.
#[test]
fn bench_create_tokens_batch_1() {
    let s = BenchSetup::new();
    let params = s.batch_params(1);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &1_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_1 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_1");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `create_tokens_batch` at batch size = 5.
#[test]
fn bench_create_tokens_batch_5() {
    let s = BenchSetup::new();
    let params = s.batch_params(5);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &5_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_5 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_5");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `create_tokens_batch` at batch size = 10.
#[test]
fn bench_create_tokens_batch_10() {
    let s = BenchSetup::new();
    let params = s.batch_params(10);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &10_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_10 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_10");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `create_tokens_batch` at batch size = 15.
#[test]
fn bench_create_tokens_batch_15() {
    let s = BenchSetup::new();
    let params = s.batch_params(15);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &15_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_15 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_15");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `create_tokens_batch` at batch size = 20.
#[test]
fn bench_create_tokens_batch_20() {
    let s = BenchSetup::new();
    let params = s.batch_params(20);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &20_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_20 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_20");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `create_tokens_batch` at batch size = 25.
///
/// At this size we expect to approach or exceed the mainnet `write_entries`
/// limit (50) and `disk_read_entries` limit (100).  The benchmark itself
/// doesn't fail the test — the CI comparison script flags regressions.
#[test]
fn bench_create_tokens_batch_25() {
    let s = BenchSetup::new();
    let params = s.batch_params(25);
    let result = s
        .client()
        .try_create_tokens_batch(&s.creator, &params, &25_000);
    assert!(
        result.is_ok(),
        "bench_create_tokens_batch_25 failed: {:?}",
        result
    );

    let r = capture(&s.env, "create_tokens_batch_25");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `mint_tokens`.
#[test]
fn bench_mint_tokens() {
    let s = BenchSetup::new();
    // First create a token to mint into.
    let token_addr = s.create_one_token(0xAA);

    // Now benchmark the mint call.
    let result = s.client().try_mint_tokens(
        &token_addr,
        &s.creator,
        &s.creator,
        &500_000,
        &1_000, // base_fee
    );
    assert!(result.is_ok(), "bench_mint_tokens failed: {:?}", result);

    let r = capture(&s.env, "mint_tokens");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `burn`.
#[test]
fn bench_burn() {
    let s = BenchSetup::new();
    let token_addr = s.create_one_token(0xBB);

    // Burn half the initial supply.
    let result = s.client().try_burn(&token_addr, &s.creator, &500_000);
    assert!(result.is_ok(), "bench_burn failed: {:?}", result);

    let r = capture(&s.env, "burn");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

/// Benchmark `set_metadata`.
#[test]
fn bench_set_metadata() {
    let s = BenchSetup::new();
    let token_addr = s.create_one_token(0xCC);

    let uri = s.str("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");
    let result = s
        .client()
        .try_set_metadata(&token_addr, &s.creator, &uri, &500);
    assert!(result.is_ok(), "bench_set_metadata failed: {:?}", result);

    let r = capture(&s.env, "set_metadata");
    r.print_json();
    assert!(r.cpu_insns > 0);
}

// ─── fee-split recipient scaling ───────────────────────────────────────────────
//
// `distribute_fee` iterates every configured fee-split recipient on each
// `create_token` / `create_tokens_batch` / `mint_tokens` / `set_metadata`
// call. `set_fee_split` validates that basis points sum to 10_000 but (prior
// to `MAX_FEE_SPLIT_RECIPIENTS`) placed no bound on recipient *count*, so an
// admin-configured split could make every fee-paying call arbitrarily
// expensive. These benchmarks isolate that per-recipient cost by measuring
// `mint_tokens` — the cheapest carrier entrypoint (see `bench_mint_tokens`
// above) — across a range of split sizes up to the enforced
// `MAX_FEE_SPLIT_RECIPIENTS` cap, so the growth curve reflects
// `distribute_fee`'s loop and not entry-point-specific overhead.
//
// `MAX_FEE_SPLIT_RECIPIENTS` was derived by measuring recipient counts up to
// 34 (the highest reachable before an unrelated testutils-only ceiling: the
// SDK's auth-mock layer serializes the authorized-invocation tree to XDR
// after every call under a separate, non-adjustable "shadow" CPU budget that
// this repo doesn't control). That exploratory data showed ledger *writes*
// growing at ~1.03/recipient and crossing 50% of the mainnet write limit at
// n≈20 — see `MAX_FEE_SPLIT_RECIPIENTS`'s doc comment in `lib.rs` for the
// full derivation. Only in-bounds points are kept here since `set_fee_split`
// now rejects anything above the cap.
fn run_fee_split_mint_bench(n: u32, label: &str) -> BenchResult {
    let s = BenchSetup::new();
    s.client()
        .set_fee_split(&s.admin, &fee_split_with_recipients(&s.env, n));
    let token_addr = s.seed_token();

    let result = s
        .client()
        .try_mint_tokens(&token_addr, &s.creator, &s.creator, &500_000, &1_000);
    assert!(result.is_ok(), "{label} failed: {result:?}");

    let r = capture(&s.env, label);
    r.print_json();
    assert!(r.cpu_insns > 0);
    r
}

/// Benchmark `mint_tokens` with a 1-recipient fee split.
#[test]
fn bench_fee_split_mint_1() {
    run_fee_split_mint_bench(1, "fee_split_mint_1");
}

/// Benchmark `mint_tokens` with a 5-recipient fee split.
#[test]
fn bench_fee_split_mint_5() {
    run_fee_split_mint_bench(5, "fee_split_mint_5");
}

/// Benchmark `mint_tokens` with a 10-recipient fee split.
#[test]
fn bench_fee_split_mint_10() {
    run_fee_split_mint_bench(10, "fee_split_mint_10");
}

/// Benchmark `mint_tokens` with a 15-recipient fee split.
#[test]
fn bench_fee_split_mint_15() {
    run_fee_split_mint_bench(15, "fee_split_mint_15");
}

/// Benchmark `mint_tokens` with a 20-recipient fee split — the chosen
/// `MAX_FEE_SPLIT_RECIPIENTS` value. See `bench_fee_split_at_max_within_limits`
/// below for the assertion that this stays within margin of mainnet limits.
#[test]
fn bench_fee_split_mint_20() {
    run_fee_split_mint_bench(20, "fee_split_mint_20");
}

// ─── resource-limit sanity checks ─────────────────────────────────────────────

/// Verify that a single `create_token` stays comfortably below Soroban
/// mainnet per-transaction resource limits.  The margins below are 50 % of
/// the published mainnet limits, giving a large safety band in the native
/// test environment (which underestimates real WASM costs).
///
/// Mainnet limits (Protocol 21+):
///   CPU instructions: 600 000 000
///   Memory bytes:      41 943 040  (40 MB)
///   Ledger reads:             100
///   Ledger writes:             50
#[test]
fn bench_create_token_within_limits() {
    let s = BenchSetup::new();
    s.client().create_token(
        &s.creator,
        &s.salt(0xDD),
        &s.str("LimitCheck"),
        &s.str("LCK"),
        &7,
        &100_000i128,
        &None,
        &1_000,
    );

    let res = s.env.cost_estimate().resources();
    // 50% of mainnet CPU limit
    assert!(
        res.instructions < 300_000_000,
        "create_token CPU ({}) exceeds 50% of mainnet limit (300M)",
        res.instructions
    );
    // 50% of mainnet mem limit
    assert!(
        res.mem_bytes < 20_971_520,
        "create_token memory ({} bytes) exceeds 50% of mainnet limit (20 MB)",
        res.mem_bytes
    );
}

/// Verify that `distribute_fee`'s cost at `MAX_FEE_SPLIT_RECIPIENTS` (the
/// maximum allowed `set_fee_split` size) stays comfortably within Soroban
/// mainnet per-transaction resource limits. Unlike `bench_create_token_within_limits`
/// above, the binding resource here is *ledger writes*, not CPU or memory —
/// each non-zero-share recipient writes a new SEP-41 balance entry, so
/// writes grow with recipient count while CPU/memory barely move (see the
/// measurement table in `MAX_FEE_SPLIT_RECIPIENTS`'s doc comment in
/// `lib.rs`). This is the test that keeps the constant honest: if someone
/// raises `MAX_FEE_SPLIT_RECIPIENTS` without re-measuring, this fails once
/// the write count crosses the asserted margin.
///
/// Mainnet limits (Protocol 21+):
///   CPU instructions: 600 000 000
///   Memory bytes:      41 943 040  (40 MB)
///   Ledger reads:             100
///   Ledger writes:             50
#[test]
fn bench_fee_split_at_max_within_limits() {
    let s = BenchSetup::new();
    s.client().set_fee_split(
        &s.admin,
        &fee_split_with_recipients(&s.env, MAX_FEE_SPLIT_RECIPIENTS),
    );
    let token_addr = s.seed_token();
    s.client()
        .mint_tokens(&token_addr, &s.creator, &s.creator, &500_000, &1_000);

    let res = s.env.cost_estimate().resources();

    // 50% of mainnet CPU limit — ample headroom in practice (~0.7% used).
    assert!(
        res.instructions < 300_000_000,
        "fee split at max ({} recipients) CPU ({}) exceeds 50% of mainnet limit (300M)",
        MAX_FEE_SPLIT_RECIPIENTS,
        res.instructions
    );
    // 50% of mainnet mem limit — likewise ample headroom (~1.4% used).
    assert!(
        res.mem_bytes < 20_971_520,
        "fee split at max ({} recipients) memory ({} bytes) exceeds 50% of mainnet limit (20 MB)",
        MAX_FEE_SPLIT_RECIPIENTS,
        res.mem_bytes
    );
    // The binding resource: 50% of mainnet's 50-write-entry limit. Measured
    // at 24/50 (48%) — this is the constraint that actually determined
    // MAX_FEE_SPLIT_RECIPIENTS's value.
    assert!(
        res.write_entries < 25,
        "fee split at max ({} recipients) ledger writes ({}) exceeds 50% of the mainnet \
         write-entry limit (25 of 50) — re-measure and reconsider MAX_FEE_SPLIT_RECIPIENTS \
         before raising it",
        MAX_FEE_SPLIT_RECIPIENTS,
        res.write_entries
    );
}
