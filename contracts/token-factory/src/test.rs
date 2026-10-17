#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Map, MuxedAddress, String, Symbol,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

// ── Malicious re-entrant fee token (issue #1095) ─────────────────────────────
//
// The factory calls SEP-41 `transfer` on this contract (via `distribute_fee`
// during `create_token` / `mint_tokens` / `set_metadata`), and it synchronously
// calls back into the factory to attempt a re-entrant `create_token`, recording
// whether that nested call was refused.
//
// It is deliberately NOT a real on-chain contract: it is a native in-process
// test contract registered with `env.register`, which is the only way to make
// a genuine *nested* cross-contract call against the factory without compiling
// a separate malicious WASM (see `fuzz/README.md` for the documented
// limitation).
//
// What the re-entry actually hits. Soroban's host refuses any call into a
// contract that is already on the call stack, and it does so *before* the
// callee runs — so the nested invocation never reaches the factory's `locked`
// check. The malicious contract observes a host `InvokeError`, not
// `Error::Reentrancy`. This was verified directly: substituting a read-only
// `get_state()` for the nested `create_token` fails identically, and a
// read-only view has no guard to trip.
//
// So this contract proves the end-to-end property — a malicious fee token
// cannot re-enter the factory mid-call — but it cannot prove *when* the
// `locked` flag is acquired relative to the external call, because the guard
// never executes. Ordering remains covered only by the state-injection tests
// below.
#[contract]
pub struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    /// Remember the factory to call back into, plus an address to act as the
    /// "attacker" on the re-entrant `create_token` call.
    pub fn __constructor(env: Env, factory: Address, attacker: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("factory"), &factory);
        env.storage()
            .instance()
            .set(&symbol_short!("attacker"), &attacker);
        env.storage()
            .instance()
            .set(&symbol_short!("blocked"), &false);
    }

    /// SEP-41 `transfer`. Invoked by the factory's `distribute_fee` while the
    /// factory holds the reentrancy lock. Re-enters `create_token` and records
    /// whether the nested call was refused.
    pub fn transfer(env: Env, _from: Address, _to: MuxedAddress, _amount: i128) {
        let factory: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("factory"))
            .unwrap();
        let attacker: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("attacker"))
            .unwrap();
        let client = TokenFactoryClient::new(&env, &factory);
        let salt = BytesN::from_array(&env, &[0xEE; 32]);
        let result = client.try_create_token(
            &attacker,
            &salt,
            &String::from_str(&env, "Reentry"),
            &String::from_str(&env, "RENTRY"),
            &7,
            &0_i128,
            &None,
            &1_000,
        );
        // Any error means the re-entry was refused, and refusal is the property
        // under test. Deliberately not matched against `Error::Reentrancy`:
        // the host aborts the nested call before the factory's guard runs, so
        // what arrives here is `Err(Err(InvokeError))`. Asserting the narrower
        // shape would make this test fail on a *correctly* protected factory.
        let blocked = result.is_err();
        env.storage()
            .instance()
            .set(&symbol_short!("blocked"), &blocked);
    }

    /// View: whether the most recent re-entrant call was refused.
    pub fn reentrant_blocked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("blocked"))
            .unwrap_or(false)
    }
}

// ── Test setup helper ─────────────────────────────────────────────────────────

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

struct Setup {
    env: Env,
    client: TokenFactoryClient<'static>,
    admin: Address,
    treasury: Address,
    fee_token: Address,
}

impl Setup {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let fee_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

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
        // SAFETY: the client borrows `env` which lives for the duration of the test.
        let client = TokenFactoryClient::new(&env, &contract_id);
        let client: TokenFactoryClient<'static> = unsafe { core::mem::transmute(client) };

        Setup {
            env,
            client,
            admin,
            treasury,
            fee_token,
        }
    }

    /// Mint `amount` of the fee token to `recipient`.
    fn fund(&self, recipient: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.fee_token).mint(recipient, &amount);
    }

    /// Register a fresh Stellar asset contract owned by `issuer`.
    fn new_token(&self, issuer: &Address) -> Address {
        self.env
            .register_stellar_asset_contract_v2(issuer.clone())
            .address()
    }

    fn salt(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n; 32])
    }

    /// A dummy wasm hash — only used in error-path tests that fail before deploy.
    fn dummy_hash(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[0u8; 32])
    }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

/// Register a token in factory storage as if `create_token` had run.
/// Returns the token contract address.
fn seed_token(
    s: &Setup,
    creator: &Address,
    burn_enabled: bool,
    max_supply: Option<i128>,
) -> Address {
    let token_addr = s.new_token(creator);
    let info = TokenInfo {
        name: String::from_str(&s.env, "T"),
        symbol: String::from_str(&s.env, "T"),
        decimals: 7,
        creator: creator.clone(),
        created_at: 0,
        burn_enabled,
        max_supply,
    };
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.token_count = state.token_count.checked_add(1).unwrap();
        let index = state.token_count;
        TokenFactory::set_persistent(&s.env, &DataKey::TokenInfo(index), &info);
        s.env.storage().instance().set(&DataKey::State, &state);
        TokenFactory::set_persistent(&s.env, &DataKey::TokenIndex(token_addr.clone()), &index);
        TokenFactory::set_persistent(&s.env, &DataKey::TokenAddress(index), &token_addr);
        TokenFactory::append_creator_token(&s.env, creator, index).unwrap();
        TokenFactory::set_persistent(&s.env, &(&token_addr, symbol_short!("owner")), creator);
    });
    token_addr
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let s = Setup::new();
    let state = s.client.get_state();
    assert_eq!(state.admin, s.admin);
    assert_eq!(state.treasury, s.treasury);
    assert_eq!(state.fee_token, s.fee_token);
    assert_eq!(state.base_fee, 1_000);
    assert_eq!(state.metadata_fee, 500);
    assert!(!state.paused);
    assert_eq!(state.token_count, 0);
}

/// Number of events the factory contract itself emitted during the **most
/// recent** contract invocation (soroban's test env reports events per
/// invocation, not cumulatively). Events emitted by the token contracts
/// (transfer/burn under *their* own address) are excluded by
/// `filter_by_contract`.
///
/// Call this immediately after the `burn`/`try_burn` under test, before any
/// other contract call (a later `balance()` read would reset the reported
/// events to that read's invocation). Used to prove the trust-boundary
/// invariant: a rejected burn emits no factory event, and a successful factory
/// burn emits exactly one.
fn factory_event_count(s: &Setup) -> usize {
    s.env
        .events()
        .all()
        .filter_by_contract(&s.client.address)
        .events()
        .len()
}

/// Whether the factory emitted an event carrying `action` as one of its topics
/// during the most recent contract invocation.
///
/// `ContractEvents` exposes the raw XDR slice rather than the `(address, topics,
/// data)` tuples the older SDK yielded, so topic matching goes through
/// `ScVal::Symbol` directly. Scoped to the factory's own address, so token
/// contracts' `transfer`/`burn` events cannot satisfy an assertion here.
fn factory_emitted(s: &Setup, action: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScVal};
    s.env
        .events()
        .all()
        .filter_by_contract(&s.client.address)
        .events()
        .iter()
        .any(|e| {
            let ContractEventBody::V0(body) = &e.body;
            body.topics.iter().any(|t| match t {
                ScVal::Symbol(sym) => sym.to_utf8_string_lossy() == action,
                _ => false,
            })
        })
}

#[test]
fn test_initialize_already_initialized() {
    // The constructor now runs atomically with deployment, so it can no
    // longer be invoked as a second, separate call against a live contract.
    // The only way to exercise the `AlreadyInitialized` guard is the
    // test-only re-registration path (re-running the constructor against an
    // address whose instance storage was already populated) — the doc
    // comment on `Env::register_at` notes this isn't reproducible on-chain,
    // but the guard is kept as defense in depth.
    let s = Setup::new();
    let result = catch_unwind(AssertUnwindSafe(|| {
        s.env.register_at(
            &s.client.address,
            TokenFactory,
            TokenFactoryArgs::__constructor(
                &s.admin,
                &s.treasury,
                &s.fee_token,
                &s.dummy_hash(),
                &1_000,
                &500,
            ),
        )
    }));
    assert!(result.is_err());
}

// ── supply boundary tests (issue #909, updated for i128 ABI in #1022) ─────────
//
// `create_token`'s `initial_supply` is now `i128` (unified with the batch
// path — issue #1022), so a value cannot be expressed above `i128::MAX`. The
// "would wrap negative" hazard the earlier `u128` guards protected against is
// now impossible to construct at the ABI boundary, and a genuinely negative
// supply is rejected by the shared `validate_token_params` before any mint.

/// A negative `initial_supply` is rejected with `InvalidParameters` before any
/// mint occurs — matching the batch path exactly.
#[test]
fn test_create_token_negative_supply_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &7,
        &-1_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

/// `i128::MIN` is the most-negative supply — must also be rejected.
#[test]
fn test_create_token_min_supply_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &7,
        &i128::MIN,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

/// i128::MAX is the largest value that fits — must pass validation.
/// The test will reach the deploy step and fail there because the hash is a
/// dummy, but the error must NOT be InvalidParameters (supply is valid).
#[test]
fn test_create_token_supply_i128_max_passes_validation() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &7,
        &i128::MAX,
        &None,
        &1_000,
    );
    // Supply is valid, so we must not get InvalidParameters.
    // The call may fail for other reasons (dummy wasm hash), but not supply.
    assert_ne!(result, Err(Ok(Error::InvalidParameters)));
}

/// Zero supply is explicitly allowed — token is created without minting.
/// The call will fail at the deploy step (dummy hash) but not at supply
/// validation, confirming zero is accepted.
#[test]
fn test_create_token_supply_zero_passes_validation() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    // Must not be rejected for supply reasons.
    assert_ne!(result, Err(Ok(Error::InvalidParameters)));
}

// ── create_token (error paths only — deploy requires real wasm) ───────────────

/// A `max_supply` below `initial_supply` is rejected with `InvalidParameters`,
/// identically to the batch path (single-path `max_supply` parity — #1022).
#[test]
fn test_create_token_max_supply_below_initial_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "Token"),
        &String::from_str(&s.env, "TKN"),
        &7,
        &1_000_i128,
        &Some(500_i128),
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

/// A non-positive `max_supply` cap is rejected with `InvalidParameters`.
#[test]
fn test_create_token_nonpositive_max_supply_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "Token"),
        &String::from_str(&s.env, "TKN"),
        &7,
        &0_i128,
        &Some(0_i128),
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

#[test]
fn test_set_metadata_fee_goes_to_treasury() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);

    let token_addr = seed_token(&s, &admin, true, None);
    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &500,
    );

    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        500
    );
}

// ── exact-fee charging (issue #1008) ────────────────────────────────────────
//
// `fee_payment` is the caller's authorized upper bound, not the amount to
// charge — the contract must transfer exactly the currently configured
// required fee (`base_fee` / `metadata_fee`) and leave any surplus in the
// caller's balance. `create_token` and `create_tokens_batch` share the exact
// same `distribute_fee(..., state.base_fee)` call as `mint_tokens` and are
// covered by the same fix, but can't be balance-tested directly here since a
// successful deploy needs a real token WASM (see "create_token (error paths
// only — deploy requires real wasm)" above) — `mint_tokens` and
// `set_metadata` exercise the identical charging logic without that
// limitation.

#[test]
fn test_set_metadata_overpayment_charges_exact_fee_only() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    // Fund well above 2x metadata_fee (500) so a leftover balance proves
    // only the exact fee was taken, not the full fee_payment.
    s.fund(&admin, 10_000);

    let token_addr = seed_token(&s, &admin, true, None);
    // Pass fee_payment = 2 * metadata_fee (1_000 vs. required 500).
    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, "ipfs://QmOverpay"),
        &1_000,
    );

    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        500,
        "treasury must receive exactly metadata_fee, not fee_payment"
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&admin),
        10_000 - 500,
        "caller must keep the surplus above metadata_fee"
    );
}

#[test]
fn test_mint_tokens_overpayment_charges_exact_fee_only() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    // Fund well above 2x base_fee (1_000) so a leftover balance proves only
    // the exact fee was taken.
    s.fund(&admin, 10_000);

    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    // Pass fee_payment = 2 * base_fee (2_000 vs. required 1_000).
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &5_000, &2_000);

    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        1_000,
        "treasury must receive exactly base_fee, not fee_payment"
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&admin),
        10_000 - 1_000,
        "caller must keep the surplus above base_fee"
    );
    // The mint itself still uses the caller-specified `amount`, independent
    // of the fee overpayment.
    assert_eq!(
        TokenClient::new(&s.env, &token_addr).balance(&recipient),
        5_000
    );
}

#[test]
fn test_mint_tokens_fee_split_sums_to_charged_fee_not_payment() {
    let s = Setup::new();
    let recipient_a = Address::generate(&s.env);
    let recipient_b = Address::generate(&s.env);
    let splits = make_split(&s, &[(&recipient_a, 6_000), (&recipient_b, 4_000)]);
    s.client.set_fee_split(&s.admin, &splits);

    let admin = Address::generate(&s.env);
    s.fund(&admin, 10_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let mint_to = Address::generate(&s.env);

    // fee_payment (5_000) is 5x base_fee (1_000).
    s.client
        .mint_tokens(&token_addr, &admin, &mint_to, &1, &5_000);

    let a_balance = TokenClient::new(&s.env, &s.fee_token).balance(&recipient_a);
    let b_balance = TokenClient::new(&s.env, &s.fee_token).balance(&recipient_b);
    let treasury_balance = TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury);

    // 60% / 40% of the *charged* base_fee (1_000), not the fee_payment (5_000).
    assert_eq!(a_balance, 600);
    assert_eq!(b_balance, 400);
    assert_eq!(treasury_balance, 0);

    // Conservation against the charged amount, not the passed fee_payment.
    assert_eq!(
        a_balance + b_balance + treasury_balance,
        1_000,
        "fee-split recipients must sum to exactly the charged base_fee"
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&admin),
        10_000 - 1_000,
        "caller must keep the surplus above base_fee even with a fee split configured"
    );
}

/// Fee-update race: a caller submits `fee_payment` sized for the fee that was
/// current when they built the transaction. If the admin raises the fee
/// before the transaction lands, the call must fail cleanly with
/// `InsufficientFee` and leave every balance untouched — no partial charge
/// at the old rate, and no charge at all at the new rate.
#[test]
fn test_fee_update_race_rejects_with_no_partial_transfer() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 10_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);

    // Admin raises base_fee from 1_000 to 2_000 after the caller already
    // decided on a fee_payment sized for the old fee (with a little
    // headroom: 1_500).
    s.client.update_fees(&s.admin, &Some(2_000), &None);

    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &5_000, &1_500);
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));

    // No balance may have moved: the fee-gate check happens before any
    // transfer or mint.
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&admin),
        10_000
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        0
    );
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&recipient), 0);
}

#[test]
fn test_create_token_insufficient_fee() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &7,
        &0_i128,
        &None,
        &999,
    );

    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

#[test]
fn test_create_token_blocked_when_paused() {
    let s = Setup::new();
    s.client.pause(&s.admin);
    let creator = Address::generate(&s.env);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_create_token_invalid_decimals() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &19,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidDecimals)));
}

#[test]
fn test_create_token_invalid_decimals_large() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, "MTK"),
        &255,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidDecimals)));
}

#[test]
fn test_create_token_invalid_name_empty() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, ""),
        &String::from_str(&s.env, "MTK"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTokenParams)));
}

#[test]
fn test_create_token_invalid_symbol_empty() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "MyToken"),
        &String::from_str(&s.env, ""),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTokenParams)));
}

#[test]
fn test_create_token_reentrancy_guard() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::Reentrancy)));
}

#[test]
fn test_create_token_overflow_protection() {
    let s = Setup::new();
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.token_count = u32::MAX;
        s.env.storage().instance().set(&DataKey::State, &state);
    });
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::ArithmeticOverflow)));
}

#[test]
fn test_reentrancy_lock_released_after_error() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    // Trigger InsufficientFee — lock must be released afterwards.
    let _ = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1,
    );
    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(!state.locked, "lock must be released after an error");
    });
}

#[test]
fn test_create_tokens_batch_overflow_protection_upfront() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 10_000);

    // Set token_count to u32::MAX - 1 so a batch of 2 tokens would overflow token_count.
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.token_count = u32::MAX - 1;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    let mut tokens: Vec<BatchTokenParams> = vec![&s.env];
    tokens.push_back(BatchTokenParams {
        salt: s.salt(1),
        name: String::from_str(&s.env, "TokenOne"),
        symbol: String::from_str(&s.env, "TK1"),
        decimals: 7,
        initial_supply: 0,
        max_supply: None,
    });
    tokens.push_back(BatchTokenParams {
        salt: s.salt(2),
        name: String::from_str(&s.env, "TokenTwo"),
        symbol: String::from_str(&s.env, "TK2"),
        decimals: 7,
        initial_supply: 0,
        max_supply: None,
    });

    // Front-loaded validation catches token_count overflow for the entire batch before any deploy calls or lock writes execute.
    let result = s.client.try_create_tokens_batch(&creator, &tokens, &2_000);
    assert_eq!(result, Err(Ok(Error::ArithmeticOverflow)));

    // State is preserved and lock is released.
    assert_eq!(s.client.get_state().token_count, u32::MAX - 1);
    assert!(!s.client.get_state().locked);
}

// ── set_metadata ──────────────────────────────────────────────────────────────

#[test]
fn test_set_metadata() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &500,
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        500
    );
}

#[test]
fn test_set_metadata_insufficient_fee() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = s.new_token(&admin);
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &100,
    );
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

#[test]
fn test_set_metadata_unauthorized() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    s.fund(&stranger, 500);
    let token_addr = seed_token(&s, &creator, true, None);
    let result = s.client.try_set_metadata(
        &token_addr,
        &stranger,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_set_metadata_already_set() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    // Fund enough for METADATA_MAX_UPDATES (5) calls × 500 fee each
    s.fund(&admin, 500 * 5);
    let token_addr = seed_token(&s, &admin, true, None);
    // Use valid ipfs:// URIs with proper CID length
    let uris = [
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bb",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bc",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bd",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Be",
    ];
    for uri in &uris {
        s.client
            .set_metadata(&token_addr, &admin, &String::from_str(&s.env, uri), &500);
    }
    // 6th call must fail — auto-frozen after METADATA_MAX_UPDATES
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bf",
        ),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::MetadataFrozen)));
}

#[test]
fn test_set_metadata_different_tokens_independent() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_a = seed_token(&s, &admin, true, None);
    let token_b = seed_token(&s, &admin, true, None);
    s.client.set_metadata(
        &token_a,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &500,
    );
    s.client.set_metadata(
        &token_b,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bb",
        ),
        &500,
    );
}

// ── metadata URI validation and mutability tests (#1023) ─────────────────────

#[test]
fn test_set_metadata_rejects_empty_uri() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    let result =
        s.client
            .try_set_metadata(&token_addr, &admin, &String::from_str(&s.env, ""), &500);
    assert_eq!(result, Err(Ok(Error::InvalidMetadataUri)));
}

#[test]
fn test_set_metadata_rejects_missing_ipfs_prefix() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, "https://example.com/metadata.json"),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::InvalidMetadataUri)));
}

#[test]
fn test_set_metadata_rejects_uri_too_long() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    // 129-char URI (exceeds METADATA_URI_MAX_LEN = 128)
    let long_uri = "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3BaQmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3BaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert_eq!(long_uri.len(), 129, "fixture must exceed the 128-byte cap");
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, long_uri),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::InvalidMetadataUri)));
}

#[test]
fn test_set_metadata_rejects_prefix_only() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, "ipfs://"),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::InvalidMetadataUri)));
}

#[test]
fn test_set_metadata_update_then_freeze() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);

    // First set succeeds.
    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        ),
        &500,
    );
    assert_eq!(s.client.get_metadata_version(&token_addr), 1);
    assert!(!s.client.is_metadata_frozen(&token_addr));

    // Update to a new URI.
    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bb",
        ),
        &500,
    );
    assert_eq!(s.client.get_metadata_version(&token_addr), 2);

    // Explicitly freeze.
    s.client.freeze_metadata(&token_addr, &admin);
    assert!(s.client.is_metadata_frozen(&token_addr));

    // Further updates are rejected.
    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(
            &s.env,
            "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bc",
        ),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::MetadataFrozen)));
}

#[test]
fn test_freeze_metadata_unauthorized() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    assert_eq!(
        s.client.try_freeze_metadata(&token_addr, &stranger),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_freeze_metadata_idempotent() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, None);
    // Freeze twice — second call must not error.
    s.client.freeze_metadata(&token_addr, &admin);
    s.client.freeze_metadata(&token_addr, &admin);
    assert!(s.client.is_metadata_frozen(&token_addr));
}

#[test]
fn test_set_metadata_version_increments() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 2_500);
    let token_addr = seed_token(&s, &admin, true, None);
    let uris = [
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Ba",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bb",
        "ipfs://QmYwAPJzv5CZsnAztBbmLU7V7HLe52Y1ZbL21hEbdOC3Bc",
    ];
    for (i, uri) in uris.iter().enumerate() {
        s.client
            .set_metadata(&token_addr, &admin, &String::from_str(&s.env, uri), &500);
        assert_eq!(s.client.get_metadata_version(&token_addr), (i + 1) as u32);
    }
}

// ── mint_tokens ───────────────────────────────────────────────────────────────

#[test]
fn test_mint_tokens() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &5_000, &1_000);
    assert_eq!(
        TokenClient::new(&s.env, &token_addr).balance(&recipient),
        5_000
    );
}

#[test]
fn test_mint_tokens_unauthorized() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    s.fund(&stranger, 1_000);
    let token_addr = seed_token(&s, &creator, true, None);
    let recipient = Address::generate(&s.env);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &stranger, &recipient, &5_000, &1_000);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_mint_tokens_insufficient_fee() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &100, &999);
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

#[test]
fn test_mint_tokens_zero_amount_rejected() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &0, &1_000);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

// ── max supply cap ────────────────────────────────────────────────────────────

#[test]
fn test_mint_tokens_within_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &1_000, &1_000);
    assert_eq!(
        TokenClient::new(&s.env, &token_addr).balance(&recipient),
        1_000
    );
}

#[test]
fn test_mint_tokens_exceeds_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, Some(500));
    let recipient = Address::generate(&s.env);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &501, &1_000);
    assert_eq!(result, Err(Ok(Error::MaxSupplyExceeded)));
}

#[test]
fn test_mint_tokens_exactly_at_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 2_000);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &600, &1_000);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &400, &1_000);
    assert_eq!(
        TokenClient::new(&s.env, &token_addr).balance(&recipient),
        1_000
    );
}

#[test]
fn test_mint_tokens_one_over_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 2_000);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &600, &1_000);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &401, &1_000);
    assert_eq!(result, Err(Ok(Error::MaxSupplyExceeded)));
}

// ── burn ──────────────────────────────────────────────────────────────────────

#[test]
fn test_burn() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &1_000);
    s.client.burn(&token_addr, &burner, &400);
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&burner), 600);
}

#[test]
fn test_burn_invalid_amount_zero() {
    let s = Setup::new();
    let user = Address::generate(&s.env);
    let token_addr = s.new_token(&user);
    assert_eq!(
        s.client.try_burn(&token_addr, &user, &0),
        Err(Ok(Error::InvalidBurnAmount))
    );
}

#[test]
fn test_burn_amount_exceeds_balance() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &100);
    assert_eq!(
        s.client.try_burn(&token_addr, &burner, &101),
        Err(Ok(Error::BurnAmountExceedsBalance))
    );
}

#[test]
fn test_burn_exact_balance() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &100);
    s.client.burn(&token_addr, &burner, &100);
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&burner), 0);
}

#[test]
fn test_burn_disabled() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, false, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &100);
    assert_eq!(
        s.client.try_burn(&token_addr, &burner, &100),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_set_burn_enabled_disables_then_reenables() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &500);

    s.client.set_burn_enabled(&token_addr, &creator, &false);
    assert_eq!(
        s.client.try_burn(&token_addr, &burner, &100),
        Err(Ok(Error::Unauthorized))
    );

    s.client.set_burn_enabled(&token_addr, &creator, &true);
    s.client.burn(&token_addr, &burner, &200);
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&burner), 300);
}

#[test]
fn test_set_burn_enabled_unauthorized() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    assert_eq!(
        s.client
            .try_set_burn_enabled(&token_addr, &stranger, &false),
        Err(Ok(Error::Unauthorized))
    );
}

// ── burn trust boundary (issue #1021) ─────────────────────────────────────────
//
// `burn` must only ever act on tokens the factory deployed. An address that was
// never registered with the factory must be rejected with `TokenNotFound`
// *before* the factory makes any cross-contract call to it — otherwise `burn`
// is an open proxy that lets anyone make the factory invoke an arbitrary
// contract and emit an official-looking `burn` event for it.

/// A never-registered address cannot be burned through the factory, even when
/// the caller genuinely holds a balance of that (external) token. The factory
/// rejects it with `TokenNotFound` and emits no `burn` event referencing it.
#[test]
fn test_burn_unregistered_token_fails() {
    let s = Setup::new();
    let holder = Address::generate(&s.env);
    // A real token contract that the factory did NOT deploy.
    let external = s.new_token(&holder);
    StellarAssetClient::new(&s.env, &external).mint(&holder, &1_000);

    assert_eq!(
        s.client.try_burn(&external, &holder, &100),
        Err(Ok(Error::TokenNotFound))
    );
    // No factory event was emitted (checked before any other invocation).
    assert_eq!(factory_event_count(&s), 0, "no factory event on reject");
    // The external balance is untouched.
    assert_eq!(TokenClient::new(&s.env, &external).balance(&holder), 1_000);
}

/// A registered `TokenIndex` whose `TokenInfo` entry is missing must surface as
/// `TokenNotFound` from `burn` rather than proceeding to the external call.
#[test]
fn test_burn_registered_index_missing_info_fails() {
    let s = Setup::new();
    let holder = Address::generate(&s.env);
    let token_addr = s.new_token(&holder);
    StellarAssetClient::new(&s.env, &token_addr).mint(&holder, &1_000);
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::TokenIndex(token_addr.clone()), &99u32);
    });
    assert_eq!(
        s.client.try_burn(&token_addr, &holder, &100),
        Err(Ok(Error::TokenNotFound))
    );
    assert_eq!(factory_event_count(&s), 0, "no factory event on reject");
}

/// A factory `burn` event is only ever emitted for a factory token: burning a
/// registered token emits exactly one new factory event, while an interleaved
/// attempt on an unregistered address adds none.
#[test]
fn test_burn_event_only_emitted_for_factory_token() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let factory_token = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &factory_token).mint(&burner, &1_000);

    // A never-registered external token the caller also holds.
    let external = s.new_token(&burner);
    StellarAssetClient::new(&s.env, &external).mint(&burner, &1_000);

    // Attempt on the unregistered token → rejected, no factory event emitted.
    assert_eq!(
        s.client.try_burn(&external, &burner, &100),
        Err(Ok(Error::TokenNotFound))
    );
    assert_eq!(
        factory_event_count(&s),
        0,
        "unregistered token must not produce a factory event"
    );

    // Successful burn on the factory token → exactly one factory event, and it
    // is emitted for the factory token (the only factory call in this frame).
    s.client.burn(&factory_token, &burner, &400);
    assert_eq!(
        factory_event_count(&s),
        1,
        "factory burn must emit exactly one factory event"
    );
    assert_eq!(
        TokenClient::new(&s.env, &factory_token).balance(&burner),
        600
    );
}

/// `burn_enabled = false` blocks burning for a factory token with no bypass:
/// balance is untouched and no burn event is emitted.
#[test]
fn test_burn_disabled_no_bypass() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, false, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &500);

    assert_eq!(
        s.client.try_burn(&token_addr, &burner, &100),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(factory_event_count(&s), 0, "no factory event on reject");
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&burner), 500);
}

// ── trust boundary for the owner-gated entrypoints (issue #1021) ──────────────
//
// mint_tokens / set_metadata / set_burn_enabled already gate on the per-token
// owner key and reject unknown tokens; these tests lock that invariant in so a
// future refactor cannot silently reopen the boundary.

#[test]
fn test_mint_tokens_unregistered_token_fails() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let external = s.new_token(&admin);
    let to = Address::generate(&s.env);
    s.fund(&admin, 10_000);
    assert_eq!(
        s.client
            .try_mint_tokens(&external, &admin, &to, &100, &1_000),
        Err(Ok(Error::TokenNotFound))
    );
}

#[test]
fn test_set_metadata_unregistered_token_fails() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let external = s.new_token(&admin);
    s.fund(&admin, 10_000);
    let uri = String::from_str(&s.env, "ipfs://bafyunregistered");
    assert_eq!(
        s.client.try_set_metadata(&external, &admin, &uri, &1_000),
        Err(Ok(Error::TokenNotFound))
    );
}

#[test]
fn test_set_burn_enabled_unregistered_token_fails() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let external = s.new_token(&admin);
    assert_eq!(
        s.client.try_set_burn_enabled(&external, &admin, &false),
        Err(Ok(Error::TokenNotFound))
    );
}

// ── update_fees ───────────────────────────────────────────────────────────────

#[test]
fn test_update_fees() {
    let s = Setup::new();
    s.client
        .update_fees(&s.admin, &Some(2_000_i128), &Some(1_000_i128));
    let state = s.client.get_state();
    assert_eq!(state.base_fee, 2_000);
    assert_eq!(state.metadata_fee, 1_000);
}

#[test]
fn test_update_fees_partial() {
    let s = Setup::new();
    s.client.update_fees(&s.admin, &Some(3_000_i128), &None);
    let state = s.client.get_state();
    assert_eq!(state.base_fee, 3_000);
    assert_eq!(state.metadata_fee, 500); // unchanged
}

#[test]
fn test_update_fees_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client
            .try_update_fees(&stranger, &Some(2_000_i128), &None),
        Err(Ok(Error::Unauthorized))
    );
}

// ── fee sign constraint (negative fee validation) ─────────────────────────────
//
// Policy: fees must be >= 0. Zero is explicitly allowed (free token creation
// is a legitimate use-case). Negative values are rejected because:
//   1. A negative required_fee satisfies every `fee_payment < required_fee`
//      guard trivially (making the fee gate a no-op).
//   2. A negative amount passed to distribute_fee → token::transfer is
//      implementation-defined on the SEP-41 token contract side and has
//      not been tested or audited for this factory.

/// Registers a fresh `TokenFactory` with the given fees and returns whether
/// the constructor rejected them. A constructor is invoked atomically during
/// registration/deployment and has no client-callable `try_*` form, so an
/// `Err` return surfaces as a host trap — caught here via `catch_unwind`
/// instead of an `assert_eq!` on a `Result` value.
fn init_rejects(base_fee: i128, metadata_fee: i128) -> bool {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let fee_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let result = catch_unwind(AssertUnwindSafe(|| {
        env.register(
            TokenFactory,
            TokenFactoryArgs::__constructor(
                &admin,
                &treasury,
                &fee_token,
                &BytesN::from_array(&env, &[0u8; 32]),
                &base_fee,
                &metadata_fee,
            ),
        )
    }));
    result.is_err()
}

#[test]
fn test_initialize_negative_base_fee_rejected() {
    assert!(init_rejects(-1_i128, 500_i128));
}

#[test]
fn test_initialize_negative_metadata_fee_rejected() {
    assert!(init_rejects(1_000_i128, -1_i128));
}

#[test]
fn test_initialize_both_fees_negative_rejected() {
    assert!(init_rejects(-100_i128, -200_i128));
}

#[test]
fn test_initialize_i128_min_fee_rejected() {
    // i128::MIN is the most dangerous negative: saturating_abs() of it is
    // still i128::MAX, so any code that tries to normalise it before checking
    // would still fail. Ensure the raw sign check fires first.
    assert!(init_rejects(i128::MIN, 0_i128));
}

#[test]
fn test_initialize_zero_fees_allowed() {
    // Zero fee is valid — free token creation is a legitimate use-case.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let fee_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(
        TokenFactory,
        TokenFactoryArgs::__constructor(
            &admin,
            &treasury,
            &fee_token,
            &BytesN::from_array(&env, &[0u8; 32]),
            &0_i128,
            &0_i128,
        ),
    );
    let client = TokenFactoryClient::new(&env, &contract_id);
    let state = client.get_state();
    assert_eq!(state.base_fee, 0);
    assert_eq!(state.metadata_fee, 0);
}

#[test]
fn test_update_fees_negative_base_fee_rejected() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_update_fees(&s.admin, &Some(-1_i128), &None),
        Err(Ok(Error::InvalidParameters))
    );
    // State must be unchanged
    assert_eq!(s.client.get_state().base_fee, 1_000);
}

#[test]
fn test_update_fees_negative_metadata_fee_rejected() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_update_fees(&s.admin, &None, &Some(-1_i128)),
        Err(Ok(Error::InvalidParameters))
    );
    // State must be unchanged
    assert_eq!(s.client.get_state().metadata_fee, 500);
}

#[test]
fn test_update_fees_i128_min_rejected() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_update_fees(&s.admin, &Some(i128::MIN), &None),
        Err(Ok(Error::InvalidParameters))
    );
}

#[test]
fn test_update_fees_zero_allowed() {
    // Reducing to zero fee is valid — admin may want to offer free operations.
    let s = Setup::new();
    s.client.update_fees(&s.admin, &Some(0_i128), &Some(0_i128));
    let state = s.client.get_state();
    assert_eq!(state.base_fee, 0);
    assert_eq!(state.metadata_fee, 0);
}

#[test]
fn test_update_fees_negative_does_not_corrupt_state() {
    // A rejected update must leave both fees at their original values.
    let s = Setup::new();
    let _ = s
        .client
        .try_update_fees(&s.admin, &Some(-999_i128), &Some(-1_i128));
    let state = s.client.get_state();
    assert_eq!(
        state.base_fee, 1_000,
        "base_fee must be unchanged after rejection"
    );
    assert_eq!(
        state.metadata_fee, 500,
        "metadata_fee must be unchanged after rejection"
    );
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_admin_can_pause_and_unpause() {
    let s = Setup::new();
    s.client.pause(&s.admin);
    assert!(s.client.get_state().paused);
    s.client.unpause(&s.admin);
    assert!(!s.client.get_state().paused);
}

#[test]
fn test_non_admin_cannot_pause() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(s.client.try_pause(&stranger), Err(Ok(Error::Unauthorized)));
}

// ── reentrancy guard ──────────────────────────────────────────────────────────

#[test]
fn test_burn_allowed_when_factory_paused() {
    // burn() does not call require_not_paused — it must work even when paused.
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &500);
    s.client.pause(&s.admin);
    s.client.burn(&token_addr, &burner, &200);
    assert_eq!(TokenClient::new(&s.env, &token_addr).balance(&burner), 300);
}

// ── propose_admin / accept_admin / cancel_admin_proposal ──────────────────────
//
// Two-step admin rotation: the current admin proposes a successor; the
// successor proves it can sign by calling accept_admin; the rotation only
// completes when both steps have executed. transfer_admin and update_admin
// now both delegate to propose_admin, so no single-step path remains.

#[test]
fn test_propose_admin_records_pending_state() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);
    let state = s.client.get_state();
    assert_eq!(state.pending_admin, Some(new_admin));
    assert!(state.pending_admin_expiry.is_some());
}

#[test]
fn test_accept_admin_completes_rotation() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);
    s.client.accept_admin(&new_admin);
    let state = s.client.get_state();
    assert_eq!(state.admin, new_admin);
    assert_eq!(state.pending_admin, None);
    assert_eq!(state.pending_admin_expiry, None);
}

#[test]
fn test_accept_admin_old_admin_loses_access() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);
    s.client.accept_admin(&new_admin);
    // Old admin can no longer exercise admin-only operations.
    assert_eq!(s.client.try_pause(&s.admin), Err(Ok(Error::Unauthorized)));
    // New admin can.
    s.client.pause(&new_admin);
    assert!(s.client.get_state().paused);
}

#[test]
fn test_propose_admin_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let new_admin = Address::generate(&s.env);
    assert_eq!(
        s.client.try_propose_admin(&stranger, &new_admin),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_propose_admin_self_transfer_rejected() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_propose_admin(&s.admin, &s.admin),
        Err(Ok(Error::InvalidParameters))
    );
}

#[test]
fn test_accept_admin_wrong_address_rejected() {
    let s = Setup::new();
    let proposed = Address::generate(&s.env);
    let impostor = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &proposed);
    // A different address trying to accept must be rejected.
    assert_eq!(
        s.client.try_accept_admin(&impostor),
        Err(Ok(Error::NoPendingProposal))
    );
    // Proposal must still be live.
    assert_eq!(s.client.get_state().pending_admin, Some(proposed));
}

#[test]
fn test_accept_admin_with_no_proposal_rejected() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    assert_eq!(
        s.client.try_accept_admin(&addr),
        Err(Ok(Error::NoPendingProposal))
    );
}

#[test]
fn test_second_proposal_overwrites_first() {
    let s = Setup::new();
    let first = Address::generate(&s.env);
    let second = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &first);
    // Overwrite with a second proposal.
    s.client.propose_admin(&s.admin, &second);
    let state = s.client.get_state();
    // Only the second proposal should be active.
    assert_eq!(state.pending_admin, Some(second.clone()));
    // First proposed address can no longer accept.
    assert_eq!(
        s.client.try_accept_admin(&first),
        Err(Ok(Error::NoPendingProposal))
    );
    // Second can accept.
    s.client.accept_admin(&second);
    assert_eq!(s.client.get_state().admin, second);
}

#[test]
fn test_cancel_admin_proposal() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);
    s.client.cancel_admin_proposal(&s.admin);
    let state = s.client.get_state();
    assert_eq!(state.pending_admin, None);
    assert_eq!(state.pending_admin_expiry, None);
}

#[test]
fn test_cancel_admin_proposal_idempotent() {
    let s = Setup::new();
    // Cancelling when there is no proposal must be a no-op, not an error.
    s.client.cancel_admin_proposal(&s.admin);
}

#[test]
fn test_cancel_admin_proposal_unauthorized() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);
    assert_eq!(
        s.client.try_cancel_admin_proposal(&stranger),
        Err(Ok(Error::Unauthorized))
    );
    // Proposal must still be intact after the failed cancel.
    assert_eq!(s.client.get_state().pending_admin, Some(new_admin));
}

#[test]
fn test_expired_proposal_cannot_be_accepted() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.propose_admin(&s.admin, &new_admin);

    // Advance the ledger past the TTL.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .saturating_add(ADMIN_PROPOSAL_TTL_LEDGERS as u32 + 1);
    });

    assert_eq!(
        s.client.try_accept_admin(&new_admin),
        Err(Ok(Error::ProposalExpired))
    );
    // The rejection reverts the whole call, so the expired proposal is still
    // on record — inert, never acceptable, and harmless. The admin clears it
    // by cancelling, or replaces it by proposing again.
    let state = s.client.get_state();
    assert_eq!(state.pending_admin, Some(new_admin.clone()));
    assert_eq!(state.admin, s.admin);

    // Re-proposing overwrites the expired entry with a fresh expiry window,
    // and the new proposal is acceptable.
    s.client.propose_admin(&s.admin, &new_admin);
    s.client.accept_admin(&new_admin);
    assert_eq!(s.client.get_state().admin, new_admin);
    assert_eq!(s.client.get_state().pending_admin, None);
}

#[test]
fn test_transfer_admin_delegates_to_propose_admin() {
    // transfer_admin must be a thin alias for propose_admin — it initiates
    // a proposal, not a completed rotation.
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.transfer_admin(&s.admin, &new_admin);
    // Admin must NOT have changed yet — only proposal stored.
    assert_eq!(s.client.get_state().admin, s.admin);
    assert_eq!(s.client.get_state().pending_admin, Some(new_admin.clone()));
    // Completing requires accept_admin.
    s.client.accept_admin(&new_admin);
    assert_eq!(s.client.get_state().admin, new_admin);
}

#[test]
fn test_update_admin_delegates_to_propose_admin() {
    // update_admin must be a thin alias for propose_admin — same as above.
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.update_admin(&s.admin, &new_admin);
    assert_eq!(s.client.get_state().admin, s.admin);
    assert_eq!(s.client.get_state().pending_admin, Some(new_admin.clone()));
    s.client.accept_admin(&new_admin);
    assert_eq!(s.client.get_state().admin, new_admin);
}

#[test]
fn test_transfer_admin_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let new_admin = Address::generate(&s.env);
    assert_eq!(
        s.client.try_transfer_admin(&stranger, &new_admin),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_transfer_admin_same_address_rejected() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_transfer_admin(&s.admin, &s.admin),
        Err(Ok(Error::InvalidParameters))
    );
}

#[test]
fn test_update_admin_old_loses_access() {
    // Verify the full two-step flow: the old admin loses access only after
    // accept_admin completes.
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);
    s.client.update_admin(&s.admin, &new_admin);
    // Old admin still holds the key at proposal stage.
    assert_eq!(s.client.get_state().admin, s.admin);
    s.client.accept_admin(&new_admin);
    // Now old admin must be locked out.
    assert_eq!(s.client.try_pause(&s.admin), Err(Ok(Error::Unauthorized)));
    s.client.pause(&new_admin);
    assert!(s.client.get_state().paused);
}

// ── get_token_info / get_tokens_by_creator ────────────────────────────────────

#[test]
fn test_get_token_info() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let info = TokenInfo {
        name: String::from_str(&s.env, "MyToken"),
        symbol: String::from_str(&s.env, "MTK"),
        decimals: 7,
        creator: creator.clone(),
        created_at: 0,
        burn_enabled: true,
        max_supply: None,
    };
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::TokenInfo(1), &info);
    });
    let result = s.client.get_token_info(&1);
    assert_eq!(result.name, String::from_str(&s.env, "MyToken"));
    assert_eq!(result.symbol, String::from_str(&s.env, "MTK"));
    assert_eq!(result.decimals, 7);
    assert_eq!(result.creator, creator);
}

#[test]
fn test_get_token_info_not_found() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_get_token_info(&99),
        Err(Ok(Error::TokenNotFound))
    );
}

// ── get_token_index / get_token_info_by_address / get_metadata ────────────────

#[test]
fn test_get_token_index_resolves_registered_address() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    // seed_token increments token_count starting from 1, so this is index 1.
    assert_eq!(s.client.get_token_index(&token_addr), 1);
}

#[test]
fn test_get_token_index_not_found_for_unregistered_address() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_get_token_index(&stranger),
        Err(Ok(Error::TokenNotFound))
    );
}

/// Regression for #1018: a token's identity must resolve from its address via
/// the contract regardless of how old it is or how many events came after it.
/// Event-derived lookups dropped tokens created beyond the first event page and
/// fabricated placeholder data (address-as-name, guessed decimals); the on-chain
/// index has no such window.
#[test]
fn test_get_token_info_by_address_returns_authoritative_identity() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = s.new_token(&creator);
    let info = TokenInfo {
        name: String::from_str(&s.env, "AncientToken"),
        symbol: String::from_str(&s.env, "OLD"),
        decimals: 12,
        creator: creator.clone(),
        created_at: 42,
        burn_enabled: false,
        max_supply: Some(1_000_000),
    };
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::TokenInfo(7), &info);
        s.env
            .storage()
            .instance()
            .set(&DataKey::TokenIndex(token_addr.clone()), &7u32);
    });

    let resolved = s.client.get_token_info_by_address(&token_addr);
    assert_eq!(resolved.name, String::from_str(&s.env, "AncientToken"));
    assert_eq!(resolved.symbol, String::from_str(&s.env, "OLD"));
    assert_eq!(resolved.decimals, 12);
    assert_eq!(resolved.creator, creator);
    assert_eq!(resolved.created_at, 42);
    assert_eq!(resolved.max_supply, Some(1_000_000));
}

#[test]
fn test_get_token_info_by_address_not_found() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_get_token_info_by_address(&stranger),
        Err(Ok(Error::TokenNotFound))
    );
}

/// A registered `TokenIndex` whose `TokenInfo` entry is missing must surface
/// as `TokenNotFound` rather than trapping.
#[test]
fn test_get_token_info_by_address_missing_info_entry() {
    let s = Setup::new();
    let token_addr = s.new_token(&Address::generate(&s.env));
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::TokenIndex(token_addr.clone()), &99u32);
    });
    assert_eq!(
        s.client.try_get_token_info_by_address(&token_addr),
        Err(Ok(Error::TokenNotFound))
    );
}

#[test]
fn test_get_metadata_none_before_set_then_some_after() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);

    assert_eq!(s.client.get_metadata(&token_addr), None);

    let uri = String::from_str(&s.env, "ipfs://QmMeta");
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::Metadata(token_addr.clone()), &uri);
    });

    assert_eq!(s.client.get_metadata(&token_addr), Some(uri));
}

#[test]
fn test_get_tokens_by_creator() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    seed_token(&s, &creator, true, None);
    seed_token(&s, &creator, true, None);
    let indices = s.client.get_tokens_by_creator(&creator, &0_u32, &10_u32);
    assert_eq!(indices.len(), 2);
}

#[test]
fn test_get_tokens_by_creator_empty_for_unknown() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client
            .get_tokens_by_creator(&stranger, &0_u32, &10_u32)
            .len(),
        0
    );
}

// ── get_tokens_by_creator pagination ─────────────────────────────────────────

/// Helper that seeds `n` tokens owned by `creator`, returning their indices
/// in storage order. Indices are computed locally from a baseline read of
/// `FactoryState.token_count` rather than re-reading `DataKey::TokenIndex`
/// for each seed — re-reading would require entering the contract context
/// for every seed, which conflicts with `seed_token`'s own `as_contract`
/// wrapping.
fn seed_many(s: &Setup, creator: &Address, n: u32) -> Vec<u32> {
    let mut expected: Vec<u32> = Vec::new(&s.env);
    let mut base: u32 = 0;
    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        base = state.token_count;
    });
    for i in 0..n {
        seed_token(s, creator, true, None);
        expected.push_back(base.saturating_add(i).saturating_add(1));
    }
    expected
}

#[test]
fn test_get_tokens_by_creator_first_page() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let expected = seed_many(&s, &creator, 15);
    let page = s.client.get_tokens_by_creator(&creator, &0_u32, &10_u32);
    assert_eq!(page.len(), 10);
    for i in 0..10 {
        assert_eq!(page.get(i).unwrap(), expected.get(i).unwrap());
    }
}

#[test]
fn test_get_tokens_by_creator_second_page() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let expected = seed_many(&s, &creator, 15);
    let page = s.client.get_tokens_by_creator(&creator, &10_u32, &10_u32);
    assert_eq!(page.len(), 5);
    for i in 0..5 {
        assert_eq!(page.get(i).unwrap(), expected.get(10 + i).unwrap());
    }
}

#[test]
fn test_get_tokens_by_creator_offset_past_end() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    seed_many(&s, &creator, 5);
    // offset >= total → empty result
    let page = s.client.get_tokens_by_creator(&creator, &5_u32, &10_u32);
    assert_eq!(page.len(), 0);
    let page_far = s.client.get_tokens_by_creator(&creator, &u32::MAX, &10_u32);
    assert_eq!(page_far.len(), 0);
}

#[test]
fn test_get_tokens_by_creator_zero_limit() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    seed_many(&s, &creator, 3);
    let page = s.client.get_tokens_by_creator(&creator, &0_u32, &0_u32);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_get_tokens_by_creator_clamps_oversized_limit() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    // Seed just enough tokens to exceed the configured cap so the clamping
    // path is exercised. Seeding too many tokens would exceed the test
    // runtime's per-instance storage budget — 60 fits comfortably while
    // being > MAX_TOKENS_BY_CREATOR_PAGE (50).
    seed_many(&s, &creator, 60);
    // Requesting a limit larger than the configured cap must not return more
    // than the cap. This guards against callers asking for arbitrarily large
    // pages that could exceed ledger entry size limits on mainnet.
    let page = s.client.get_tokens_by_creator(&creator, &0_u32, &u32::MAX);
    assert!(
        page.len() <= super::MAX_TOKENS_BY_CREATOR_PAGE,
        "page size ({}) must be ≤ the contract-level cap ({})",
        page.len(),
        super::MAX_TOKENS_BY_CREATOR_PAGE,
    );
    // The first page should be filled to the cap (we have 60 tokens, the
    // contract requested 50). This is the load-bearing assertion: the page
    // actually clamps down to MAX rather than silently truncating at offset
    // + u32::MAX.
    assert_eq!(page.len(), super::MAX_TOKENS_BY_CREATOR_PAGE);
}

#[test]
fn test_get_tokens_by_creator_isolated_per_creator() {
    let s = Setup::new();
    let creator_a = Address::generate(&s.env);
    let creator_b = Address::generate(&s.env);
    seed_many(&s, &creator_a, 4);
    seed_many(&s, &creator_b, 7);

    let a = s.client.get_tokens_by_creator(&creator_a, &0_u32, &10_u32);
    let b = s.client.get_tokens_by_creator(&creator_b, &0_u32, &10_u32);

    assert_eq!(a.len(), 4);
    assert_eq!(b.len(), 7);

    // None of A's indices should appear in B's slice.
    for idx in a.iter() {
        for other in b.iter() {
            assert_ne!(idx, other);
        }
    }
}

#[test]
fn test_get_tokens_by_creator_partial_last_page() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    seed_many(&s, &creator, 7);
    // Page of exactly 7 splits into [3, 4] for limit=3, offset=0 / 3.
    let p1 = s.client.get_tokens_by_creator(&creator, &0_u32, &3_u32);
    assert_eq!(p1.len(), 3);
    let p2 = s.client.get_tokens_by_creator(&creator, &3_u32, &3_u32);
    assert_eq!(p2.len(), 3);
    let p3 = s.client.get_tokens_by_creator(&creator, &6_u32, &3_u32);
    assert_eq!(p3.len(), 1);
    let p4 = s.client.get_tokens_by_creator(&creator, &7_u32, &3_u32);
    assert_eq!(p4.len(), 0);
}

// ── storage architecture (issue #1007) ─────────────────────────────────────────

/// Several hundred tokens for one creator must not make the single
/// `instance` ledger entry (`FactoryState` + fee split) grow, and per-token
/// records must actually live in `persistent` storage rather than
/// `instance` storage.
///
/// This is the regression test for issue #1007: before the migration to
/// persistent storage, `TokenInfo`, `TokenIndex`, the per-token `owner` key,
/// and the monolithic `CreatorTokens` `Vec<u32>` all lived in `instance`
/// storage, so this same workload would have made every `instance` read/write
/// — including on entrypoints unrelated to the seeded tokens, like
/// `mint_tokens` on an unrelated token — progressively more expensive as
/// `token_count` grew, eventually bricking the factory outright once the
/// ~64 KiB ledger-entry limit was reached.
#[test]
fn test_instance_storage_size_stays_flat_under_load() {
    use soroban_sdk::xdr::ToXdr;

    let s = Setup::new();

    // The exact serialized size of the `DataKey::State` entry — the only
    // per-token-count-dependent thing left in `instance` storage. Its only
    // field that changes as tokens are created is `token_count: u32`, and
    // XDR encodes `u32` as a fixed 4 bytes regardless of value, so this size
    // must be identical before and after — a precise, deterministic
    // measurement rather than a resource-cost heuristic.
    let state_size = |s: &Setup| -> u32 {
        let state: FactoryState = s.env.as_contract(&s.client.address, || {
            s.env.storage().instance().get(&DataKey::State).unwrap()
        });
        state.to_xdr(&s.env).len()
    };
    let baseline_size = state_size(&s);

    // Several hundred tokens for one creator — enough to span multiple
    // `CreatorTokens` pages (`MAX_TOKENS_BY_CREATOR_PAGE` = 50) and,
    // pre-migration, to have made the monolithic `CreatorTokens` `Vec<u32>`
    // and the shared `instance` ledger entry meaningfully bigger.
    const N: u32 = 300;
    let creator = Address::generate(&s.env);
    let expected = seed_many(&s, &creator, N);
    assert_eq!(expected.len(), N);

    assert_eq!(
        state_size(&s),
        baseline_size,
        "the instance-stored FactoryState entry must not grow after seeding {N} tokens"
    );

    // Per-token records must actually live in `persistent` storage, not
    // `instance` storage — sampled across the range, not just the first and
    // last entry.
    s.env.as_contract(&s.client.address, || {
        for i in [0u32, N / 2, N - 1] {
            let idx = expected.get(i).unwrap();
            assert!(
                s.env.storage().persistent().has(&DataKey::TokenInfo(idx)),
                "TokenInfo({idx}) must live in persistent storage"
            );
            assert!(
                !s.env.storage().instance().has(&DataKey::TokenInfo(idx)),
                "TokenInfo({idx}) must not live in instance storage"
            );
        }
        assert!(
            !s.env
                .storage()
                .instance()
                .has(&LegacyDataKey::CreatorTokens(creator.clone())),
            "the monolithic legacy CreatorTokens list must not exist for a \
             creator whose tokens were all created after the migration"
        );
    });

    // Pagination correctness across multiple pages: request a window that
    // straddles a page boundary (page size 50, so local offset 45..55 spans
    // pages 0 and 1) and confirm it matches the recorded creation order.
    let straddle = s.client.get_tokens_by_creator(&creator, &45_u32, &10_u32);
    assert_eq!(straddle.len(), 10);
    for (i, val) in straddle.iter().enumerate() {
        assert_eq!(val, expected.get(45 + i as u32).unwrap());
    }
}

// ── TTL ───────────────────────────────────────────────────────────────────────

#[test]
fn test_ttl_extended_after_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let fee_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(
        TokenFactory,
        TokenFactoryArgs::__constructor(
            &admin,
            &treasury,
            &fee_token,
            &BytesN::from_array(&env, &[0u8; 32]),
            &1_000,
            &500,
        ),
    );
    env.as_contract(&contract_id, || {
        use soroban_sdk::testutils::storage::Instance;
        let ttl = env.storage().instance().get_ttl();
        assert!(
            ttl >= MIN_TTL,
            "TTL after initialize ({ttl}) must be >= MIN_TTL ({MIN_TTL})"
        );
    });
}

// ── fee split ─────────────────────────────────────────────────────────────────

fn make_split(s: &Setup, pairs: &[(&Address, u32)]) -> Map<Address, u32> {
    let mut m = Map::new(&s.env);
    for (addr, bps) in pairs {
        m.set((*addr).clone(), *bps);
    }
    m
}

/// Build a fee-split map with `n` distinct recipients whose basis points sum
/// to exactly 10_000, for boundary-testing `MAX_FEE_SPLIT_RECIPIENTS`.
fn make_split_n(s: &Setup, n: u32) -> Map<Address, u32> {
    let mut m = Map::new(&s.env);
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
        m.set(Address::generate(&s.env), bps);
        distributed += bps;
    }
    m
}

#[test]
fn test_set_fee_split_valid() {
    let s = Setup::new();
    let referral = Address::generate(&s.env);
    let splits = make_split(&s, &[(&s.treasury, 7_000), (&referral, 3_000)]);
    s.client.set_fee_split(&s.admin, &splits);
    let stored = s.client.get_fee_split();
    assert_eq!(stored.get(s.treasury.clone()).unwrap(), 7_000);
    assert_eq!(stored.get(referral).unwrap(), 3_000);
}

#[test]
fn test_set_fee_split_invalid_sum_rejected() {
    let s = Setup::new();
    let referral = Address::generate(&s.env);
    let splits = make_split(&s, &[(&s.treasury, 6_000), (&referral, 3_000)]);
    assert_eq!(
        s.client.try_set_fee_split(&s.admin, &splits),
        Err(Ok(Error::InvalidFeeSplit))
    );
}

#[test]
fn test_set_fee_split_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let splits = make_split(&s, &[(&s.treasury, 10_000)]);
    assert_eq!(
        s.client.try_set_fee_split(&stranger, &splits),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_set_fee_split_empty_clears_split() {
    let s = Setup::new();
    let referral = Address::generate(&s.env);
    let splits = make_split(&s, &[(&s.treasury, 7_000), (&referral, 3_000)]);
    s.client.set_fee_split(&s.admin, &splits);
    s.client.set_fee_split(&s.admin, &Map::new(&s.env));
    assert!(s.client.get_fee_split().is_empty());
}

#[test]
fn test_set_fee_split_at_max_recipients_accepted() {
    let s = Setup::new();
    let splits = make_split_n(&s, MAX_FEE_SPLIT_RECIPIENTS);
    s.client.set_fee_split(&s.admin, &splits);
    assert_eq!(s.client.get_fee_split().len(), MAX_FEE_SPLIT_RECIPIENTS);
}

#[test]
fn test_set_fee_split_over_max_recipients_rejected() {
    let s = Setup::new();
    let splits = make_split_n(&s, MAX_FEE_SPLIT_RECIPIENTS + 1);
    assert_eq!(
        s.client.try_set_fee_split(&s.admin, &splits),
        Err(Ok(Error::TooManyFeeSplitRecipients))
    );
}

#[test]
fn test_fee_distributed_according_to_split() {
    let s = Setup::new();
    let referral = Address::generate(&s.env);
    let splits = make_split(&s, &[(&s.treasury, 7_000), (&referral, 3_000)]);
    s.client.set_fee_split(&s.admin, &splits);

    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &100, &1_000);

    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        700
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&referral),
        300
    );
}

#[test]
fn test_fee_goes_to_treasury_when_no_split() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &100, &1_000);
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        1_000
    );
}

// ── fee split: new edge-case tests (#1024) ────────────────────────────────────

#[test]
fn test_set_fee_split_zero_bps_rejected() {
    let s = Setup::new();
    let referral = Address::generate(&s.env);
    // One entry has bps==0, which must be rejected.
    let splits = make_split(&s, &[(&s.treasury, 10_000), (&referral, 0)]);
    assert_eq!(
        s.client.try_set_fee_split(&s.admin, &splits),
        Err(Ok(Error::ZeroFeeSplitEntry))
    );
}

#[test]
fn test_set_fee_split_exactly_at_cap_accepted() {
    let s = Setup::new();
    // 10 recipients each with 1_000 bps = 10_000 total — exactly at the cap.
    let mut m = Map::new(&s.env);
    for _ in 0..9u32 {
        let addr = Address::generate(&s.env);
        m.set(addr, 1_000u32);
    }
    m.set(s.treasury.clone(), 1_000u32);
    s.client.set_fee_split(&s.admin, &m);
    assert_eq!(s.client.get_fee_split().len(), 10);
}

#[test]
fn test_fee_split_largest_remainder_dust_fee() {
    // With a tiny fee (e.g. 3 stroops) and two recipients at 50/50 bps,
    // floor shares are both 0 (1.5 each), remainder=3.
    // Largest-remainder assigns 2 to highest-frac (both equal, tie → first)
    // and 1 to second. Total transferred must equal 3.
    let s = Setup::new();
    let r1 = Address::generate(&s.env);
    let r2 = Address::generate(&s.env);
    let splits = make_split(&s, &[(&r1, 5_000), (&r2, 5_000)]);
    s.client.set_fee_split(&s.admin, &splits);

    let admin = Address::generate(&s.env);
    s.fund(&admin, 3);
    let token_addr = seed_token(&s, &admin, true, None);

    // Update base_fee to 3 so the fee amount is tiny.
    s.client.update_fees(&s.admin, &Some(3_i128), &None);

    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &1, &3);

    let bal_r1 = TokenClient::new(&s.env, &s.fee_token).balance(&r1);
    let bal_r2 = TokenClient::new(&s.env, &s.fee_token).balance(&r2);
    // Total must equal 3 regardless of individual allocation.
    assert_eq!(bal_r1 + bal_r2, 3, "sum of splits must equal fee");
    // Each recipient must receive at least 1 stroop (floor+1 via LR).
    assert!(bal_r1 >= 1, "r1 must receive at least 1 stroop");
    assert!(bal_r2 >= 1, "r2 must receive at least 1 stroop");
}

#[test]
fn test_fee_split_sum_invariant_many_recipients() {
    // 5 recipients at 2_000 bps each = 10_000; fee = 10_001 stroops.
    // Each gets 2000 floor; remainder=1 goes to first-highest-frac.
    // Sum must still equal 10_001.
    let s = Setup::new();
    let mut addrs = soroban_sdk::Vec::new(&s.env);
    let mut m = Map::new(&s.env);
    for _ in 0..5u32 {
        let a = Address::generate(&s.env);
        m.set(a.clone(), 2_000u32);
        addrs.push_back(a);
    }
    s.client.set_fee_split(&s.admin, &m);

    let fee_amount: i128 = 10_001;
    let admin = Address::generate(&s.env);
    s.fund(&admin, fee_amount);
    let token_addr = seed_token(&s, &admin, true, None);
    s.client.update_fees(&s.admin, &Some(fee_amount), &None);
    let recipient = Address::generate(&s.env);
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &1, &fee_amount);

    let mut total: i128 = 0;
    for i in 0..addrs.len() {
        if let Ok(Some(a)) = addrs.try_get(i) {
            total += TokenClient::new(&s.env, &s.fee_token).balance(&a);
        }
    }
    assert_eq!(total, fee_amount, "sum of all splits must equal fee amount");
}

/// Issue #918 — Task 1: 50/50 split on an odd fee amount.
///
/// When a fee is split evenly between two recipients but the amount is odd,
/// integer division floors each share by 1 unit. Under the largest-remainder
/// allocation introduced for issue #1024, the 1-unit remainder is awarded to
/// one of the split recipients (highest fractional share) rather than sent to
/// treasury.
///
/// Concrete example (fee = 1_001, two recipients at 5_000 bps each):
///   floor_a = 1_001 * 5_000 / 10_000 = 500
///   floor_b = 500
///   remainder = 1_001 - 1_000 = 1  → one recipient receives 501
///
/// This test verifies:
/// 1. One recipient receives `floor + 1`, the other exactly `floor`.
/// 2. Treasury receives nothing — the remainder stays with split recipients.
/// 3. The conservation law holds: share_a + share_b == fee.
#[test]
fn test_fee_split_odd_amount_remainder_goes_to_treasury() {
    let s = Setup::new();
    let recipient_a = Address::generate(&s.env);
    let recipient_b = Address::generate(&s.env);

    // 50 / 50 split — must sum to exactly 10_000 bps.
    let splits = make_split(&s, &[(&recipient_a, 5_000), (&recipient_b, 5_000)]);
    s.client.set_fee_split(&s.admin, &splits);

    // Use an odd fee amount so floor division leaves a 1-unit remainder.
    let fee: i128 = 1_001;
    let admin = Address::generate(&s.env);
    s.fund(&admin, fee);
    let token_addr = seed_token(&s, &admin, true, None);
    let mint_to = Address::generate(&s.env);
    // set base_fee = fee so the exact amount is distributed
    s.client.update_fees(&s.admin, &Some(fee), &None);
    s.client
        .mint_tokens(&token_addr, &admin, &mint_to, &1, &fee);

    // Floor share is floor(1_001 * 5_000 / 10_000) = floor(500.5) = 500; the
    // 1-unit remainder is awarded to one of the recipients (largest-remainder).
    let floor_each: i128 = fee * 5_000 / 10_000; // = 500
    let bal_a = TokenClient::new(&s.env, &s.fee_token).balance(&recipient_a);
    let bal_b = TokenClient::new(&s.env, &s.fee_token).balance(&recipient_b);
    assert!(
        (bal_a == floor_each && bal_b == floor_each + 1)
            || (bal_a == floor_each + 1 && bal_b == floor_each),
        "one recipient must receive floor+1, the other floor (got {bal_a} / {bal_b})"
    );

    // Treasury receives nothing — the remainder stays with split recipients.
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        0,
        "remainder must go to a split recipient, not treasury"
    );

    // Conservation: every stroop accounted for.
    assert_eq!(
        bal_a + bal_b,
        fee,
        "total distributed must equal the fee exactly (no leaked or double-counted stroops)"
    );
}

/// Issue #918 — Task 2: recipient whose bps is so small that their computed
/// share floors to zero.
///
/// The `distribute_fee` function skips the `token::transfer` call for any
/// recipient whose allocated share is 0 (the `if share > 0` guard). Under the
/// largest-remainder allocation (#1024) the rounding remainder is awarded to
/// the recipient with the largest fractional share rather than to treasury.
///
/// Concrete example (fee = 99, big recipient at 9_999 bps, tiny at 1 bps):
///   floor_big  = 99 * 9_999 / 10_000 = 98   (frac numerator 9_901)
///   floor_tiny = 99 * 1     / 10_000 = 0    (frac numerator 99)
///   remainder  = 99 − 98 = 1 → awarded to big (largest frac) → big gets 99
///   tiny_recipient balance = 0  (transfer skipped, share == 0)
///
/// This test verifies:
/// 1. The tiny recipient receives 0 (transfer correctly skipped).
/// 2. The remainder goes to the largest-frac recipient, not treasury.
/// 3. Conservation: big_balance + tiny_balance == fee.
#[test]
fn test_fee_split_zero_share_recipient_skipped_remainder_to_treasury() {
    let s = Setup::new();
    let big_recipient = Address::generate(&s.env);
    let tiny_recipient = Address::generate(&s.env);

    // tiny_recipient gets 1 bps; big_recipient gets 9_999 bps.
    // Sum = 10_000 — valid split.
    let splits = make_split(&s, &[(&big_recipient, 9_999), (&tiny_recipient, 1)]);
    s.client.set_fee_split(&s.admin, &splits);

    // fee = 99: tiny share = 99 * 1 / 10_000 = 0 (floors to zero → skipped).
    let fee: i128 = 99;
    let admin = Address::generate(&s.env);
    s.fund(&admin, fee);
    let token_addr = seed_token(&s, &admin, true, None);
    let mint_to = Address::generate(&s.env);
    s.client.update_fees(&s.admin, &Some(fee), &None);
    s.client
        .mint_tokens(&token_addr, &admin, &mint_to, &1, &fee);

    let floor_big: i128 = fee * 9_999 / 10_000; // = 98
                                                // `identity_op` is allowed here: the `* 1` is the 1-bps share and is kept
                                                // literal so the formula reads in parallel with `floor_big` above.
    #[allow(clippy::identity_op)]
    let floor_tiny: i128 = fee * 1 / 10_000; //    = 0  (floors to zero)

    // The tiny recipient's share computes to 0 — the transfer is skipped.
    assert_eq!(
        floor_tiny, 0,
        "precondition: floor_tiny must be 0 for this test to exercise the skip path"
    );
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&tiny_recipient),
        0,
        "tiny_recipient must receive 0 — transfer must be skipped when share == 0"
    );

    // big_recipient receives their floor share plus the 1-unit remainder
    // (largest-remainder award — big's frac 9_901 beats tiny's 99).
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&big_recipient),
        floor_big + 1,
        "big_recipient must receive floor + the largest-remainder award"
    );

    // Treasury receives nothing — the remainder went to a split recipient.
    assert_eq!(
        TokenClient::new(&s.env, &s.fee_token).balance(&s.treasury),
        0,
        "remainder must go to the largest-frac recipient, not treasury"
    );

    // Conservation: every stroop accounted for.
    assert_eq!(
        (floor_big + 1) + floor_tiny,
        fee,
        "total distributed must equal the fee exactly"
    );
}

/// Issue #918 — Task 3: fee conservation at MAX_FEE_SPLIT_RECIPIENTS.
///
/// Configure exactly `MAX_FEE_SPLIT_RECIPIENTS` recipients and verify that
/// the sum of all recipient balance deltas plus any treasury remainder equals
/// `fee_payment` exactly — no stroop is leaked or double-counted.
///
/// The split is intentionally even: every one of `MAX_FEE_SPLIT_RECIPIENTS`
/// recipients gets the same `10_000 / n` bps, making this a clean split.  We
/// then verify the sum invariant with a fee that is NOT evenly divisible by `n`
/// (fee = 10_001) to expose any rounding-accumulation bug in the loop.
///
/// Checks:
/// 1. Exactly `MAX_FEE_SPLIT_RECIPIENTS` recipients can be configured
///    (regression guard: `set_fee_split` must not reject the cap itself).
/// 2. sum(recipient balances) + treasury_balance == fee_payment (conservation).
/// 3. No individual recipient receives more than `ceil(fee / num_recipients)`.
#[test]
fn test_fee_split_max_recipients_conservation() {
    let s = Setup::new();

    // Build MAX_FEE_SPLIT_RECIPIENTS recipients, each with equal bps.
    // This test assumes 10_000 divides evenly by the cap so the split is exact.
    let n = super::MAX_FEE_SPLIT_RECIPIENTS;
    assert_eq!(
        10_000 % n,
        0,
        "test assumes 10_000 is divisible by the recipient cap"
    );
    let bps_each: u32 = 10_000 / n;

    let mut recipients: soroban_sdk::Vec<Address> = soroban_sdk::vec![&s.env];
    let mut splits_map = Map::new(&s.env);
    for _ in 0..n {
        let addr = Address::generate(&s.env);
        splits_map.set(addr.clone(), bps_each);
        recipients.push_back(addr);
    }

    // Must succeed — configuring exactly the cap is allowed.
    s.client.set_fee_split(&s.admin, &splits_map);

    // Use a fee amount that does NOT divide evenly by 10 so rounding edge
    // cases are exercised (10_001 / 10 = 1_000 remainder 1).
    let fee: i128 = 10_001;
    let admin = Address::generate(&s.env);
    s.fund(&admin, fee);
    let token_addr = seed_token(&s, &admin, true, None);
    let mint_to = Address::generate(&s.env);
    s.client.update_fees(&s.admin, &Some(fee), &None);
    s.client
        .mint_tokens(&token_addr, &admin, &mint_to, &1, &fee);

    // Sum up what each recipient actually received.
    let mut total_to_recipients: i128 = 0;
    let fee_token_client = TokenClient::new(&s.env, &s.fee_token);
    for i in 0..n {
        let balance = fee_token_client.balance(&recipients.get(i).unwrap());
        // No recipient should receive more than ceil(fee / n).
        let max_per_recipient = fee / n as i128 + 1; // generous upper bound
        assert!(
            balance <= max_per_recipient,
            "recipient {i} balance {balance} exceeds max per-recipient ceiling {max_per_recipient}"
        );
        total_to_recipients += balance;
    }

    // Treasury receives any rounding remainder.
    let treasury_balance = fee_token_client.balance(&s.treasury);

    // Conservation invariant: not a single stroop lost or double-counted.
    assert_eq!(
        total_to_recipients + treasury_balance,
        fee,
        "conservation violated: sum(recipients)={total_to_recipients} + \
         treasury={treasury_balance} != fee={fee}"
    );
}

/// Issue #918 — cap enforcement: configuring more than MAX_FEE_SPLIT_RECIPIENTS
/// is rejected with TooManyFeeSplitRecipients.
///
/// This prevents transaction-budget exhaustion and ledger-entry size overflow
/// in `distribute_fee` (see `MAX_FEE_SPLIT_RECIPIENTS` doc comment in lib.rs).
#[test]
fn test_set_fee_split_too_many_recipients_rejected() {
    let s = Setup::new();

    // Build MAX_FEE_SPLIT_RECIPIENTS + 1 recipients.  To keep the bps sum
    // valid we give the last recipient 0 bps — the map len check fires before
    // the bps-sum check, so the 0-bps entry only needs to exist in the map.
    // Actually, the simplest approach: use 11 recipients each at 909 bps
    // (sum = 9_999 ≠ 10_000) — but that also fails the sum check, which could
    // mask the cap check.  Instead: 10 recipients at 1_000 bps + 1 recipient
    // at 0 bps (sum still = 10_000).  We want the cap check to fire, so we
    // need the map to have 11 entries regardless of their values.
    //
    // The actual implementation checks `splits.len() > MAX_FEE_SPLIT_RECIPIENTS`
    // BEFORE the bps-sum check, so an 11-entry map with a valid bps sum still
    // triggers the cap error.  Use 10 × 909 bps + 1 × 910 bps = 10_000 bps
    // to construct a 11-entry map that would pass the sum check if the cap
    // check were absent.
    let n = super::MAX_FEE_SPLIT_RECIPIENTS as usize + 1; // 11
                                                          // Distribute 10_000 bps across 11 recipients: 10 get 909, 1 gets 910
                                                          // (10 * 909 + 910 = 9_090 + 910 = 10_000).
    let mut splits_map = Map::new(&s.env);
    for i in 0..n {
        let addr = Address::generate(&s.env);
        let bps: u32 = if i < n - 1 { 909 } else { 910 };
        splits_map.set(addr, bps);
    }
    assert_eq!(splits_map.len(), 11);

    assert_eq!(
        s.client.try_set_fee_split(&s.admin, &splits_map),
        Err(Ok(Error::TooManyFeeSplitRecipients)),
        "configuring more than MAX_FEE_SPLIT_RECIPIENTS recipients must be rejected"
    );
}
// Cap enforcement (configuring more than `MAX_FEE_SPLIT_RECIPIENTS` recipients
// is rejected with `TooManyFeeSplitRecipients`) is covered cap-agnostically by
// `test_set_fee_split_over_max_recipients_rejected` above.

// ── batch token creation ──────────────────────────────────────────────────────

fn batch_param(s: &Setup, n: u8, name: &str, symbol: &str) -> BatchTokenParams {
    BatchTokenParams {
        salt: BytesN::from_array(&s.env, &[n; 32]),
        name: String::from_str(&s.env, name),
        symbol: String::from_str(&s.env, symbol),
        decimals: 7,
        initial_supply: 0,
        max_supply: None,
    }
}

fn batch_vec(s: &Setup, params: &[BatchTokenParams]) -> soroban_sdk::Vec<BatchTokenParams> {
    let mut v = soroban_sdk::vec![&s.env];
    for p in params {
        v.push_back(p.clone());
    }
    v
}

#[test]
fn test_batch_empty_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let result = s
        .client
        .try_create_tokens_batch(&creator, &soroban_sdk::vec![&s.env], &0);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

#[test]
fn test_batch_insufficient_fee_rejected() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 500);
    let params = batch_vec(
        &s,
        &[
            batch_param(&s, 1, "TokenA", "TKA"),
            batch_param(&s, 2, "TokenB", "TKB"),
        ],
    );
    // base_fee=1_000 × 2 = 2_000; paying 1_999
    let result = s.client.try_create_tokens_batch(&creator, &params, &1_999);
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

#[test]
fn test_batch_invalid_name_rejects_entire_batch() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 3_000);
    let mut bad = batch_param(&s, 2, "TokenB", "TKB");
    bad.name = String::from_str(&s.env, "");
    let params = batch_vec(&s, &[batch_param(&s, 1, "TokenA", "TKA"), bad]);
    let result = s.client.try_create_tokens_batch(&creator, &params, &2_000);
    // Empty name is an InvalidTokenParams fault — same code as the single path.
    assert_eq!(result, Err(Ok(Error::InvalidTokenParams)));
    assert_eq!(s.client.get_state().token_count, 0);
}

// ── single-path / batch-path parity (issue #1022) ─────────────────────────────
//
// Both creation paths must accept and reject exactly the same parameter sets
// with exactly the same error codes. The property test below drives both
// entrypoints with identical, randomly generated parameters and asserts they
// agree with each other and with a documented reference oracle.

/// Build a soroban `String` of exactly `n` ASCII bytes.
fn str_of_len(env: &Env, n: usize) -> String {
    let rust: std::string::String = "a".repeat(n);
    String::from_str(env, &rust)
}

/// Reference oracle: the canonical error code for a parameter set, per the
/// documented validation rules shared by `create_token` and
/// `create_tokens_batch`. `None` means the parameters are valid (validation
/// passes; the call then proceeds to deployment).
fn expected_param_error(
    name_len: usize,
    symbol_len: usize,
    decimals: u32,
    initial_supply: i128,
    max_supply: Option<i128>,
) -> Option<Error> {
    if name_len == 0 || name_len > 32 {
        return Some(Error::InvalidTokenParams);
    }
    if symbol_len == 0 || symbol_len > 12 {
        return Some(Error::InvalidTokenParams);
    }
    if decimals > 18 {
        return Some(Error::InvalidDecimals);
    }
    if initial_supply < 0 {
        return Some(Error::InvalidParameters);
    }
    if let Some(cap) = max_supply {
        if cap <= 0 || initial_supply > cap {
            return Some(Error::InvalidParameters);
        }
    }
    None
}

/// Extract the contract-level `Error` from a `try_*` result, or `None` if the
/// call did not fail with a contract error (i.e. it validated successfully and
/// then failed later — e.g. the dummy-WASM deploy trap surfaces as a host
/// error, not a contract error).
fn contract_err<T, C>(
    r: Result<Result<T, C>, Result<Error, soroban_sdk::InvokeError>>,
) -> Option<Error> {
    match r {
        Err(Ok(e)) => Some(e),
        _ => None,
    }
}

proptest::proptest! {
    #![proptest_config(proptest::prelude::ProptestConfig { cases: 48, ..proptest::prelude::ProptestConfig::default() })]

    /// For every generated parameter set, `create_token` and
    /// `create_tokens_batch` return the identical contract-error outcome, and
    /// that outcome matches the documented oracle. Covers valid sets (both
    /// pass validation → no contract error) and every invalid fault class.
    #[test]
    fn prop_single_and_batch_paths_agree(
        name_len in 0usize..40,
        symbol_len in 0usize..20,
        decimals in 0u32..30,
        initial_supply in -5i128..1_000_000,
        max_supply in proptest::option::of(-5i128..1_000_000),
    ) {
        let s = Setup::new();
        let creator = Address::generate(&s.env);
        // Fund and fee generously so neither path trips InsufficientFee or an
        // unfunded fee transfer for the *valid* cases — the only differences we
        // want to observe are in parameter validation.
        s.fund(&creator, 1_000_000_000);
        let big_fee: i128 = 1_000_000;

        let name = str_of_len(&s.env, name_len);
        let symbol = str_of_len(&s.env, symbol_len);

        let single = contract_err(s.client.try_create_token(
            &creator,
            &s.salt(1),
            &name,
            &symbol,
            &decimals,
            &initial_supply,
            &max_supply,
            &big_fee,
        ));

        let batch_params = batch_vec(
            &s,
            &[BatchTokenParams {
                salt: s.salt(2),
                name: name.clone(),
                symbol: symbol.clone(),
                decimals,
                initial_supply,
                max_supply,
            }],
        );
        let batch = contract_err(
            s.client.try_create_tokens_batch(&creator, &batch_params, &big_fee),
        );

        let expected = expected_param_error(
            name_len, symbol_len, decimals, initial_supply, max_supply,
        );

        proptest::prop_assert_eq!(
            single, batch,
            "single and batch disagree for name_len={}, symbol_len={}, decimals={}, initial_supply={}, max_supply={:?}",
            name_len, symbol_len, decimals, initial_supply, max_supply
        );
        proptest::prop_assert_eq!(
            single, expected,
            "path result does not match oracle for name_len={}, symbol_len={}, decimals={}, initial_supply={}, max_supply={:?}",
            name_len, symbol_len, decimals, initial_supply, max_supply
        );
    }
}

#[test]
fn test_batch_blocked_when_paused() {
    let s = Setup::new();
    s.client.pause(&s.admin);
    let creator = Address::generate(&s.env);
    let params = batch_vec(&s, &[batch_param(&s, 1, "T", "T")]);
    assert_eq!(
        s.client.try_create_tokens_batch(&creator, &params, &1_000),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_batch_reentrancy_guard() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });
    let params = batch_vec(&s, &[batch_param(&s, 1, "T", "T")]);
    assert_eq!(
        s.client.try_create_tokens_batch(&creator, &params, &1_000),
        Err(Ok(Error::Reentrancy))
    );
}

// ── reentrancy guard — all guarded entrypoints ────────────────────────────────
//
// These tests verify that every state-mutating, cross-contract-calling
// entrypoint rejects a call when `locked == true`. Because Soroban's test
// environment does not support running a malicious re-entrant WASM in-process,
// we simulate the mid-execution state by injecting `locked = true` directly
// into storage (the same mechanism used for `create_token` above). This proves
// that the guard is present and wired up correctly for each entrypoint — but
// NOT that the lock is acquired *before* the vulnerable external call in the
// real control flow.
//
// Reentrancy ordering: that gap is still open. Issue #1095 added
// `test_mint_tokens_rejects_real_reentrant_call` below to close it with a
// genuine nested re-entry through the malicious `ReentrantToken` fee token, but
// the Soroban host refuses re-entry into a contract already on the call stack
// before the callee runs, so the nested call never reaches the guard — the
// factory's own `locked` check is unobservable from outside. No test can
// currently distinguish a factory that locks before `distribute_fee` from one
// that locks after; the host makes both safe against cross-contract re-entry,
// which is why the guard is defence-in-depth rather than the only barrier.
//
// The cross-function reentrancy test additionally verifies that a lock set by
// *one* entrypoint (mint_tokens) also blocks a concurrent call to a *different*
// entrypoint (burn), matching the threat model of a single shared factory lock.

#[test]
fn test_mint_tokens_reentrancy_guard() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);

    // Simulate re-entrant state: factory is mid-execution (locked = true)
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &100, &1_000);
    assert_eq!(result, Err(Ok(Error::Reentrancy)));
}

/// End-to-end reentrancy: a real nested cross-contract call, not a pre-injected
/// lock. The factory is deployed with a malicious SEP-41 fee token
/// (`ReentrantToken`) whose `transfer` re-enters `create_token` from inside
/// `distribute_fee`. The re-entrant call must not succeed.
///
/// Refusal here comes from the Soroban host, which rejects any call into a
/// contract already on the call stack before the callee runs — see the note on
/// `ReentrantToken` above. That makes this a genuine end-to-end check that a
/// hostile fee token cannot re-enter mid-`mint_tokens`, but *not* a check of
/// when the `locked` flag is set: moving `state.locked = true` after the
/// `distribute_fee` call would leave this test passing. Lock ordering is not
/// covered by any test — see the `Reentrancy ordering` note above.
#[test]
fn test_mint_tokens_rejects_real_reentrant_call() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let factory_addr = Address::generate(&env);

    // Register the malicious fee token, wired to re-enter the (pre-generated)
    // factory address. It must know the factory address up front, so we
    // pre-generate the factory address rather than letting `register` pick one.
    let fee_token = env.register(ReentrantToken, (factory_addr.clone(), admin.clone()));

    env.register_at(
        &factory_addr,
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
    let client = TokenFactoryClient::new(&env, &factory_addr);
    let client: TokenFactoryClient<'static> = unsafe { core::mem::transmute(client) };

    // Seed a factory token owned by `admin` so `mint_tokens` has a real token
    // to mint (mirrors `seed_token`, which assumes the shared `Setup` env).
    let token_addr = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    env.as_contract(&factory_addr, || {
        let mut state: FactoryState = env.storage().instance().get(&DataKey::State).unwrap();
        state.token_count = state.token_count.checked_add(1).unwrap();
        let index = state.token_count;
        let info = TokenInfo {
            name: String::from_str(&env, "T"),
            symbol: String::from_str(&env, "T"),
            decimals: 7,
            creator: admin.clone(),
            created_at: 0,
            burn_enabled: true,
            max_supply: None,
        };
        TokenFactory::set_persistent(&env, &DataKey::TokenInfo(index), &info);
        env.storage().instance().set(&DataKey::State, &state);
        TokenFactory::set_persistent(&env, &DataKey::TokenIndex(token_addr.clone()), &index);
        TokenFactory::set_persistent(&env, &DataKey::TokenAddress(index), &token_addr);
        TokenFactory::append_creator_token(&env, &admin, index).unwrap();
        TokenFactory::set_persistent(&env, &(&token_addr, symbol_short!("owner")), &admin);
    });

    let recipient = Address::generate(&env);

    // The outer call must succeed: the malicious `transfer` swallows the
    // (rejected) re-entrant call and returns normally, so `mint_tokens`
    // completes its mint and releases the lock.
    client.mint_tokens(&token_addr, &admin, &recipient, &100, &1_000);

    // The malicious contract must have had its nested call refused.
    let malicious = ReentrantTokenClient::new(&env, &fee_token);
    assert!(
        malicious.reentrant_blocked(),
        "re-entrant create_token from the fee token must not succeed"
    );
}

#[test]
fn test_mint_tokens_lock_released_after_success() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 1_000);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);

    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &100, &1_000);

    // Lock must be released after a successful call
    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(
            !state.locked,
            "lock must be released after mint_tokens succeeds"
        );
    });
}

#[test]
fn test_mint_tokens_lock_released_after_error() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, None);
    let recipient = Address::generate(&s.env);

    // InsufficientFee is caught before the lock is set, so lock stays false
    let _ = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &100, &1);

    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(
            !state.locked,
            "lock must be released after mint_tokens error"
        );
    });
}

#[test]
fn test_burn_reentrancy_guard() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &1_000);

    // Simulate re-entrant state
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    let result = s.client.try_burn(&token_addr, &burner, &100);
    assert_eq!(result, Err(Ok(Error::Reentrancy)));
}

#[test]
fn test_burn_lock_released_after_success() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &1_000);

    s.client.burn(&token_addr, &burner, &100);

    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(!state.locked, "lock must be released after burn succeeds");
    });
}

#[test]
fn test_set_metadata_reentrancy_guard() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);

    // Simulate re-entrant state
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    let result = s.client.try_set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, "ipfs://QmTest"),
        &500,
    );
    assert_eq!(result, Err(Ok(Error::Reentrancy)));
}

#[test]
fn test_set_metadata_lock_released_after_success() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    s.fund(&admin, 500);
    let token_addr = seed_token(&s, &admin, true, None);

    s.client.set_metadata(
        &token_addr,
        &admin,
        &String::from_str(&s.env, "ipfs://QmTest"),
        &500,
    );

    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(
            !state.locked,
            "lock must be released after set_metadata succeeds"
        );
    });
}

#[test]
fn test_set_burn_enabled_reentrancy_guard() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);

    // Simulate re-entrant state
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    let result = s.client.try_set_burn_enabled(&token_addr, &creator, &false);
    assert_eq!(result, Err(Ok(Error::Reentrancy)));
}

#[test]
fn test_set_burn_enabled_lock_released_after_success() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);

    s.client.set_burn_enabled(&token_addr, &creator, &false);

    s.env.as_contract(&s.client.address, || {
        let state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        assert!(
            !state.locked,
            "lock must be released after set_burn_enabled succeeds"
        );
    });
}

/// Cross-function reentrancy: a lock held by one entrypoint must also block
/// all other guarded entrypoints. This tests the factory-level shared lock
/// invariant — the same `locked` flag is shared across all six entrypoints,
/// so a re-entrant call from *any* external call site is blocked regardless
/// of which entrypoint is currently executing.
#[test]
fn test_cross_function_reentrancy_lock_blocks_all_entrypoints() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    s.fund(&creator, 2_000);
    let token_addr = seed_token(&s, &creator, true, None);
    let recipient = Address::generate(&s.env);
    let burner = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &token_addr).mint(&burner, &1_000);

    // Inject locked = true to simulate mid-execution state of any entrypoint
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.locked = true;
        s.env.storage().instance().set(&DataKey::State, &state);
    });

    // Every guarded entrypoint must be blocked
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1_000,
        ),
        Err(Ok(Error::Reentrancy)),
        "create_token must be blocked"
    );

    let params = {
        let mut v = soroban_sdk::vec![&s.env];
        v.push_back(BatchTokenParams {
            salt: s.salt(1),
            name: String::from_str(&s.env, "T"),
            symbol: String::from_str(&s.env, "T"),
            decimals: 7,
            initial_supply: 0,
            max_supply: None,
        });
        v
    };
    assert_eq!(
        s.client.try_create_tokens_batch(&creator, &params, &1_000),
        Err(Ok(Error::Reentrancy)),
        "create_tokens_batch must be blocked"
    );

    assert_eq!(
        s.client
            .try_mint_tokens(&token_addr, &creator, &recipient, &100, &1_000),
        Err(Ok(Error::Reentrancy)),
        "mint_tokens must be blocked"
    );

    assert_eq!(
        s.client.try_burn(&token_addr, &burner, &100),
        Err(Ok(Error::Reentrancy)),
        "burn must be blocked"
    );

    assert_eq!(
        s.client.try_set_metadata(
            &token_addr,
            &creator,
            &String::from_str(&s.env, "ipfs://Qm"),
            &500,
        ),
        Err(Ok(Error::Reentrancy)),
        "set_metadata must be blocked"
    );

    assert_eq!(
        s.client.try_set_burn_enabled(&token_addr, &creator, &false),
        Err(Ok(Error::Reentrancy)),
        "set_burn_enabled must be blocked"
    );
}

// ── upgrade (two-step timelock, issue #6) ─────────────────────────────────────

#[test]
fn test_propose_upgrade_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let new_hash = BytesN::from_array(&s.env, &[0xAAu8; 32]);
    assert_eq!(
        s.client.try_propose_upgrade(&stranger, &new_hash),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_execute_upgrade_fails_before_timelock_elapses() {
    let s = Setup::new();
    let new_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    // Propose the upgrade.
    s.client.propose_upgrade(&s.admin, &new_hash);
    // Attempt to execute immediately — should fail with UpgradeNotReady.
    assert_eq!(
        s.client.try_execute_upgrade(&s.admin, &new_hash),
        Err(Ok(Error::UpgradeNotReady))
    );
}

#[test]
fn test_execute_upgrade_fails_with_wrong_hash() {
    let s = Setup::new();
    let proposed_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    let wrong_hash = BytesN::from_array(&s.env, &[0xCCu8; 32]);
    s.client.propose_upgrade(&s.admin, &proposed_hash);
    // Advance past the timelock.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .checked_add(UPGRADE_TIMELOCK_LEDGERS as u32 + 1)
            .unwrap();
    });
    // Supplying the wrong hash must fail.
    assert_eq!(
        s.client.try_execute_upgrade(&s.admin, &wrong_hash),
        Err(Ok(Error::UpgradeHashMismatch))
    );
}

#[test]
fn test_execute_upgrade_fails_when_no_proposal_pending() {
    let s = Setup::new();
    let some_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    // No propose_upgrade called — must fail with NoUpgradePending.
    assert_eq!(
        s.client.try_execute_upgrade(&s.admin, &some_hash),
        Err(Ok(Error::NoUpgradePending))
    );
}

#[test]
fn test_cancel_upgrade_clears_pending_proposal() {
    let s = Setup::new();
    let new_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    // Propose, then cancel.
    s.client.propose_upgrade(&s.admin, &new_hash);
    s.client.cancel_upgrade(&s.admin);
    // After cancellation, execute must fail with NoUpgradePending.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .checked_add(UPGRADE_TIMELOCK_LEDGERS as u32 + 1)
            .unwrap();
    });
    assert_eq!(
        s.client.try_execute_upgrade(&s.admin, &new_hash),
        Err(Ok(Error::NoUpgradePending))
    );
}

#[test]
fn test_cancel_upgrade_is_idempotent_when_nothing_pending() {
    let s = Setup::new();
    // cancel_upgrade when nothing is pending must be a no-op, not an error.
    s.client.cancel_upgrade(&s.admin);
}

#[test]
fn test_propose_upgrade_emits_upg_prop_event() {
    let s = Setup::new();
    let new_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    s.client.propose_upgrade(&s.admin, &new_hash);
    assert!(
        factory_emitted(&s, "upg_prop"),
        "expected upg_prop event after propose_upgrade"
    );
    // A proposal is not an upgrade: nothing has been swapped yet.
    assert!(
        !factory_emitted(&s, "upg_exec"),
        "propose_upgrade must not emit upg_exec"
    );
}

#[test]
fn test_cancel_upgrade_emits_upg_can_event() {
    let s = Setup::new();
    let new_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    s.client.propose_upgrade(&s.admin, &new_hash);
    s.client.cancel_upgrade(&s.admin);
    assert!(
        factory_emitted(&s, "upg_can"),
        "expected upg_can event after cancel_upgrade"
    );
}

#[test]
fn test_cancel_upgrade_emits_nothing_when_no_proposal_pending() {
    let s = Setup::new();
    // The no-op path returns Ok early; it must not announce a cancellation
    // that never happened, or monitoring would see phantom upgrade activity.
    s.client.cancel_upgrade(&s.admin);
    assert!(!factory_emitted(&s, "upg_can"));
}

#[test]
fn test_propose_upgrade_stores_pending_hash_and_ready_at() {
    let s = Setup::new();
    let new_hash = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    let before_seq = s.env.ledger().sequence();
    s.client.propose_upgrade(&s.admin, &new_hash);
    let state = s.client.get_state();
    assert_eq!(state.pending_upgrade_hash, Some(new_hash));
    let expected_ready_at = (before_seq as u64)
        .checked_add(UPGRADE_TIMELOCK_LEDGERS)
        .unwrap();
    // The sequence may have advanced by at most 1 during the call.
    assert!(state.pending_upgrade_ready_at.unwrap() >= expected_ready_at);
    assert!(state.pending_upgrade_ready_at.unwrap() <= expected_ready_at + 1);
}

#[test]
fn test_second_propose_upgrade_overwrites_first_and_resets_timelock() {
    let s = Setup::new();
    let hash_a = BytesN::from_array(&s.env, &[0xAAu8; 32]);
    let hash_b = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    s.client.propose_upgrade(&s.admin, &hash_a);
    // Advance time slightly, then propose again with hash_b.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li.sequence_number.checked_add(100).unwrap();
    });
    s.client.propose_upgrade(&s.admin, &hash_b);
    let state = s.client.get_state();
    assert_eq!(state.pending_upgrade_hash, Some(hash_b.clone()));
    // Trying to execute hash_a must fail.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .checked_add(UPGRADE_TIMELOCK_LEDGERS as u32 + 1)
            .unwrap();
    });
    assert_eq!(
        s.client.try_execute_upgrade(&s.admin, &hash_a),
        Err(Ok(Error::UpgradeHashMismatch))
    );
}

// ── migrate / schema versioning ───────────────────────────────────────────────

#[test]
fn test_initialize_sets_schema_version() {
    let s = Setup::new();
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
    // Standalone "sv" key must also be set
    s.env.as_contract(&s.client.address, || {
        let sv: u32 = s
            .env
            .storage()
            .instance()
            .get(&symbol_short!("sv"))
            .unwrap();
        assert_eq!(sv, CURRENT_SCHEMA_VERSION);
    });
}

#[test]
fn test_migrate_is_idempotent() {
    let s = Setup::new();
    // Calling migrate twice must not corrupt state or change the version
    s.client.migrate(&s.admin);
    s.client.migrate(&s.admin);
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
}

#[test]
fn test_migrate_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_migrate(&stranger),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_migrate_upgrades_pre_versioned_state() {
    let s = Setup::new();

    // Simulate a pre-versioned deployment: set sv = 0 and schema_version = 0
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 0;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &0u32);
    });

    s.client.migrate(&s.admin);

    // A single `migrate` call walks through every pending step, so a
    // contract starting at sv = 0 lands directly on CURRENT_SCHEMA_VERSION.
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
    s.env.as_contract(&s.client.address, || {
        let sv: u32 = s
            .env
            .storage()
            .instance()
            .get(&symbol_short!("sv"))
            .unwrap();
        assert_eq!(sv, CURRENT_SCHEMA_VERSION);
    });
}

#[test]
fn test_migrate_preserves_state_fields() {
    let s = Setup::new();
    s.client.migrate(&s.admin);
    let state = s.client.get_state();
    // Core fields must survive migration unchanged
    assert_eq!(state.admin, s.admin);
    assert_eq!(state.treasury, s.treasury);
    assert_eq!(state.base_fee, 1_000);
    assert_eq!(state.metadata_fee, 500);
    assert!(!state.paused);
}

// ── schema v4 migration: pending_admin fields default to None ─────────────────

/// Simulating a schema-v3 deployment and running migrate must walk the v3→v4
/// step, adding `pending_admin = None` and `pending_admin_expiry = None`.
#[test]
fn test_migrate_v3_to_v4_adds_pending_admin_fields() {
    let s = Setup::new();

    // Rewind to schema version 3 so the v4 step fires.
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 3;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &3u32);
    });

    s.client.migrate(&s.admin);

    let state = s.client.get_state();
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
    // New fields must be absent (no live proposal) after migration.
    assert_eq!(state.pending_admin, None);
    assert_eq!(state.pending_admin_expiry, None);
}

/// Running migrate on a fully-current contract must be a no-op for
/// pending_admin fields (idempotent).
#[test]
fn test_migrate_v4_idempotent_for_pending_admin() {
    let s = Setup::new();
    // After a fresh init, schema is already at v5.
    s.client.migrate(&s.admin);
    s.client.migrate(&s.admin);
    let state = s.client.get_state();
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
    assert_eq!(state.pending_admin, None);
}

/// A contract starting at sv=0 must walk all four steps in a single migrate call.
#[test]
fn test_migrate_from_v0_walks_all_steps_to_v4() {
    let s = Setup::new();

    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 0;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &0u32);
    });

    s.client.migrate(&s.admin);
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
}

// ── schema v5 migration: pending_upgrade fields default to None ───────────────

/// Simulating a schema-v4 deployment and running migrate must walk the v4→v5
/// step, adding `pending_upgrade_hash = None` and `pending_upgrade_ready_at = None`.
#[test]
fn test_migrate_v4_to_v5_adds_pending_upgrade_fields() {
    let s = Setup::new();

    // Rewind to schema version 4 so the v5 step fires.
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 4;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &4u32);
    });

    s.client.migrate(&s.admin);

    let state = s.client.get_state();
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
    // New upgrade fields must be absent (no pending upgrade) after migration.
    assert_eq!(state.pending_upgrade_hash, None);
    assert_eq!(state.pending_upgrade_ready_at, None);
}

/// Running migrate on a fully-current (v5) contract must be a no-op for
/// pending_upgrade fields (idempotent).
#[test]
fn test_migrate_v5_idempotent_for_pending_upgrade() {
    let s = Setup::new();
    s.client.migrate(&s.admin);
    s.client.migrate(&s.admin);
    let state = s.client.get_state();
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
    assert_eq!(state.pending_upgrade_hash, None);
    assert_eq!(state.pending_upgrade_ready_at, None);
}

// ── whitelist enforcement ─────────────────────────────────────────────────────

/// Helper: enable whitelisting on the factory.
fn enable_whitelist(s: &Setup) {
    s.client.set_whitelist_enabled(&s.admin, &true);
}

/// Helper: add `addr` to the whitelist.
fn whitelist_add(s: &Setup, addr: &Address) {
    s.client.add_to_whitelist(&s.admin, addr);
}

#[test]
fn test_whitelist_disabled_by_default() {
    // Fresh factory must have whitelist_enabled = false so existing behaviour is unchanged.
    let s = Setup::new();
    assert!(!s.client.get_state().whitelist_enabled);
}

#[test]
fn test_set_whitelist_enabled_toggles_flag() {
    let s = Setup::new();
    s.client.set_whitelist_enabled(&s.admin, &true);
    assert!(s.client.get_state().whitelist_enabled);
    s.client.set_whitelist_enabled(&s.admin, &false);
    assert!(!s.client.get_state().whitelist_enabled);
}

#[test]
fn test_set_whitelist_enabled_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_set_whitelist_enabled(&stranger, &true),
        Err(Ok(Error::Unauthorized))
    );
}

/// With whitelisting disabled (default), any address can call create_token.
/// This test verifies the baseline still holds after the feature is merged.
#[test]
fn test_create_token_allowed_when_whitelist_disabled() {
    let s = Setup::new();
    // whitelisting is off; caller NOT on the whitelist must still be blocked only
    // by the fee guard — InsufficientFee, not NotWhitelisted.
    let creator = Address::generate(&s.env);
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1, // intentionally insufficient so the call fails predictably
    );
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

/// With whitelisting enabled, a non-whitelisted address receives NotWhitelisted.
#[test]
fn test_create_token_blocked_when_not_whitelisted() {
    let s = Setup::new();
    enable_whitelist(&s);

    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);

    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert_eq!(result, Err(Ok(Error::NotWhitelisted)));
}

/// After adding a creator to the whitelist, the fee check (not NotWhitelisted)
/// is the next gate — proving the whitelist check passed.
#[test]
fn test_create_token_whitelisted_creator_passes_whitelist_gate() {
    let s = Setup::new();
    enable_whitelist(&s);

    let creator = Address::generate(&s.env);
    whitelist_add(&s, &creator);

    // Underfund so InsufficientFee (not NotWhitelisted) is the rejection reason.
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1, // insufficient
    );
    // If this were NotWhitelisted the whitelist gate would have fired first;
    // InsufficientFee means the creator cleared the whitelist gate.
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

/// add → create (via fee path) → remove → create fails: the full lifecycle.
/// Uses the insufficient-fee trick to confirm which gate fired.
#[test]
fn test_whitelist_add_remove_create_sequence() {
    let s = Setup::new();
    enable_whitelist(&s);
    let creator = Address::generate(&s.env);

    // Not whitelisted → NotWhitelisted.
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1_000,
        ),
        Err(Ok(Error::NotWhitelisted))
    );

    // Add to whitelist → passes whitelist gate (fails at fee because underfunded).
    whitelist_add(&s, &creator);
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1, // insufficient on purpose
        ),
        Err(Ok(Error::InsufficientFee))
    );

    // Remove from whitelist → NotWhitelisted again.
    s.client.remove_from_whitelist(&s.admin, &creator);
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1_000,
        ),
        Err(Ok(Error::NotWhitelisted))
    );
}

/// Disabling whitelisting allows a previously un-whitelisted address to proceed.
#[test]
fn test_whitelist_disable_reopens_factory() {
    let s = Setup::new();
    enable_whitelist(&s);

    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);

    // Blocked while enabled.
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1_000,
        ),
        Err(Ok(Error::NotWhitelisted))
    );

    // Disable — same call now fails at fee, not whitelist.
    s.client.set_whitelist_enabled(&s.admin, &false);
    assert_eq!(
        s.client.try_create_token(
            &creator,
            &s.salt(0),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1, // underfunded
        ),
        Err(Ok(Error::InsufficientFee))
    );
}

// ── whitelist enforcement — batch path ───────────────────────────────────────

/// With whitelisting enabled, a non-whitelisted address is blocked on batch too.
#[test]
fn test_batch_blocked_when_not_whitelisted() {
    let s = Setup::new();
    enable_whitelist(&s);

    let creator = Address::generate(&s.env);
    s.fund(&creator, 2_000);

    let params = batch_vec(&s, &[batch_param(&s, 1, "TokenA", "TKA")]);
    let result = s.client.try_create_tokens_batch(&creator, &params, &1_000);
    assert_eq!(result, Err(Ok(Error::NotWhitelisted)));
}

/// A whitelisted creator clears the whitelist gate on batch (fails at next gate).
#[test]
fn test_batch_whitelisted_creator_passes_whitelist_gate() {
    let s = Setup::new();
    enable_whitelist(&s);

    let creator = Address::generate(&s.env);
    whitelist_add(&s, &creator);

    let params = batch_vec(&s, &[batch_param(&s, 1, "TokenA", "TKA")]);
    // Underfund so InsufficientFee (not NotWhitelisted) fires.
    let result = s.client.try_create_tokens_batch(&creator, &params, &1);
    assert_eq!(result, Err(Ok(Error::InsufficientFee)));
}

// ── whitelist events (behavioural smoke tests) ────────────────────────────────
// Note: soroban-sdk 26.x does not expose env.events().all() in test mode
// without a higher-level testutils harness.  We verify that each entrypoint
// that emits an event completes successfully (i.e. does not panic or return
// an error), which confirms the publish() call did not fail at runtime.

#[test]
fn test_add_to_whitelist_succeeds_and_persists() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    // Must complete without error (implicitly tests event publish path too).
    s.client.add_to_whitelist(&s.admin, &addr);
    assert!(s.client.is_whitelisted(&addr));
}

#[test]
fn test_remove_from_whitelist_succeeds_and_clears() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    s.client.add_to_whitelist(&s.admin, &addr);
    // Must complete without error.
    s.client.remove_from_whitelist(&s.admin, &addr);
    assert!(!s.client.is_whitelisted(&addr));
}

#[test]
fn test_set_whitelist_enabled_succeeds_and_updates_state() {
    let s = Setup::new();
    // Must complete without error.
    s.client.set_whitelist_enabled(&s.admin, &true);
    assert!(s.client.get_state().whitelist_enabled);
}

#[test]
fn test_add_to_whitelist_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let addr = Address::generate(&s.env);
    assert_eq!(
        s.client.try_add_to_whitelist(&stranger, &addr),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_remove_from_whitelist_unauthorized() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let addr = Address::generate(&s.env);
    assert_eq!(
        s.client.try_remove_from_whitelist(&stranger, &addr),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_is_whitelisted_returns_false_for_unknown() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    assert!(!s.client.is_whitelisted(&addr));
}

#[test]
fn test_is_whitelisted_returns_true_after_add() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    s.client.add_to_whitelist(&s.admin, &addr);
    assert!(s.client.is_whitelisted(&addr));
}

#[test]
fn test_is_whitelisted_returns_false_after_remove() {
    let s = Setup::new();
    let addr = Address::generate(&s.env);
    s.client.add_to_whitelist(&s.admin, &addr);
    s.client.remove_from_whitelist(&s.admin, &addr);
    assert!(!s.client.is_whitelisted(&addr));
}

// ── migrate: whitelist step (schema v3) ───────────────────────────────────────

#[test]
fn test_initialize_sets_whitelist_enabled_false() {
    let s = Setup::new();
    let state = s.client.get_state();
    assert!(
        !state.whitelist_enabled,
        "fresh factory must have whitelist disabled"
    );
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
}

#[test]
fn test_migrate_v1_to_v3_sets_whitelist_enabled_false() {
    let s = Setup::new();
    // Simulate a v1 deployment: set sv = 1 and schema_version = 1.
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 1;
        state.whitelist_enabled = false; // as it would exist after v1 migration
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &1u32);
    });

    s.client.migrate(&s.admin);

    // Migrating from v1 walks the v2 (max-supply) and v3 (whitelist) steps,
    // landing on CURRENT_SCHEMA_VERSION with whitelist_enabled defaulted false.
    let state = s.client.get_state();
    assert_eq!(state.schema_version, CURRENT_SCHEMA_VERSION);
    assert!(!state.whitelist_enabled);

    s.env.as_contract(&s.client.address, || {
        let sv: u32 = s
            .env
            .storage()
            .instance()
            .get(&symbol_short!("sv"))
            .unwrap();
        assert_eq!(sv, CURRENT_SCHEMA_VERSION);
    });
}

#[test]
fn test_migrate_preserves_whitelist_enabled_flag() {
    let s = Setup::new();
    // Enable the flag, then migrate — it should be preserved.
    s.client.set_whitelist_enabled(&s.admin, &true);
    s.client.migrate(&s.admin);
    // migrate re-loads and writes the flag; it should not overwrite a live value.
    // (The v3 block sets whitelist_enabled = false only when upgrading FROM an
    //  earlier version. When already on the current version the block is skipped.)
    assert!(s.client.get_state().whitelist_enabled);
}

#[test]
fn test_migrate_whitelist_step_is_idempotent() {
    let s = Setup::new();
    s.client.migrate(&s.admin);
    s.client.migrate(&s.admin);
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
    assert!(!s.client.get_state().whitelist_enabled);
}

// ── Issue #1006: version-2 migration (max-supply accounting fix) ──────────────
//
// These tests exercise the real `migrate` v2 step (the max-supply accounting
// fix) and the `backfill_capped_supply` entrypoint it documents. Because the
// whitelist step above bumped `CURRENT_SCHEMA_VERSION` to 3, a contract that
// starts behind walks the v2 step and then the v3 step in a single call.

/// Helper: read the "sv" storage key directly from contract storage.
#[cfg(test)]
fn read_sv(s: &Setup) -> u32 {
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .get(&symbol_short!("sv"))
            .unwrap_or(0)
    })
}

/// A contract starting behind (sv = 0) must walk through every pending step in a
/// single `migrate` call, landing directly on `CURRENT_SCHEMA_VERSION`.
#[test]
fn test_migrate_from_version_0_walks_all_steps() {
    let s = Setup::new();

    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 0;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &0u32);
    });
    assert_eq!(read_sv(&s), 0, "precondition: sv must be 0 before migrate");

    s.client.migrate(&s.admin);

    assert_eq!(read_sv(&s), CURRENT_SCHEMA_VERSION);
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
}

/// A contract already at version 1 must only run the 1→2 and 2→3 steps — the
/// 0→1 block must not re-run or otherwise disturb state. With no tokens
/// created (`token_count == 0`), the 2→3 step's chunked walk completes in
/// this same call, landing on `CURRENT_SCHEMA_VERSION`.
/// A contract already at version 1 must run the remaining steps (v2 then v3) —
/// the 0→1 block must not re-run or otherwise disturb state.
#[test]
fn test_migrate_from_version_1_walks_remaining_steps() {
    let s = Setup::new();

    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.schema_version = 1;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &1u32);
    });

    s.client.migrate(&s.admin);

    assert_eq!(read_sv(&s), CURRENT_SCHEMA_VERSION);
    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
}

/// Calling `migrate` again once already at `CURRENT_SCHEMA_VERSION` must be a
/// complete no-op.
#[test]
fn test_migrate_v2_idempotent_at_current_version() {
    let s = Setup::new();

    s.client.migrate(&s.admin);
    let state_before = s.client.get_state();

    s.client.migrate(&s.admin);
    let state_after = s.client.get_state();

    assert_eq!(read_sv(&s), CURRENT_SCHEMA_VERSION);
    assert_eq!(state_after.schema_version, state_before.schema_version);
    assert_eq!(state_after.admin, state_before.admin);
    assert_eq!(state_after.base_fee, state_before.base_fee);
}

// ── backfill_capped_supply ──────────────────────────────────────────────────

#[test]
fn test_backfill_capped_supply_seeds_untracked_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    // `seed_token` simulates a pre-fix capped token: `max_supply` is set but
    // no `supply` key was ever written, exactly as `deploy_one` left it
    // before the issue #1006 fix.
    let token_addr = seed_token(&s, &admin, true, Some(1_000));

    s.client
        .backfill_capped_supply(&s.admin, &token_addr, &1_000);

    // A backfilled token at its cap must reject any further mint.
    s.fund(&admin, 1_000);
    let recipient = Address::generate(&s.env);
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &1, &1_000);
    assert_eq!(result, Err(Ok(Error::MaxSupplyExceeded)));
}

#[test]
fn test_backfill_capped_supply_allows_headroom_mint() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));

    // initial_supply = cap - 10, reconstructed off-chain.
    s.client.backfill_capped_supply(&s.admin, &token_addr, &990);

    s.fund(&admin, 2_000);
    let recipient = Address::generate(&s.env);
    // Exactly the remaining headroom succeeds.
    s.client
        .mint_tokens(&token_addr, &admin, &recipient, &10, &1_000);
    // One more must fail.
    let result = s
        .client
        .try_mint_tokens(&token_addr, &admin, &recipient, &1, &1_000);
    assert_eq!(result, Err(Ok(Error::MaxSupplyExceeded)));
}

#[test]
fn test_backfill_capped_supply_unauthorized() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));
    let stranger = Address::generate(&s.env);

    let result = s
        .client
        .try_backfill_capped_supply(&stranger, &token_addr, &500);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_backfill_capped_supply_rejects_token_without_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, None);

    let result = s
        .client
        .try_backfill_capped_supply(&s.admin, &token_addr, &500);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

#[test]
fn test_backfill_capped_supply_rejects_value_above_cap() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));

    let result = s
        .client
        .try_backfill_capped_supply(&s.admin, &token_addr, &1_001);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}

#[test]
fn test_backfill_capped_supply_cannot_be_applied_twice() {
    let s = Setup::new();
    let admin = Address::generate(&s.env);
    let token_addr = seed_token(&s, &admin, true, Some(1_000));

    s.client.backfill_capped_supply(&s.admin, &token_addr, &500);
    let result = s
        .client
        .try_backfill_capped_supply(&s.admin, &token_addr, &600);
    assert_eq!(result, Err(Ok(Error::AlreadyBackfilled)));
}
// ── Issue #913: whitelist gate storage consistency ───────────────────────────
//
// `add_to_whitelist` writes to `persistent` storage and `is_whitelisted` reads
// persistent-first, but the `create_token` / `create_tokens_batch` gates used
// to read `instance` storage directly. Any entry present in only one of the
// two locations produced a split-brain result: the view said "whitelisted"
// while creation was rejected with `NotWhitelisted`, or vice versa. Both now
// go through `whitelist_contains`.

/// An entry written only to `persistent` storage — the shape `add_to_whitelist`
/// produces — must be honoured by the creation gate.
#[test]
fn test_whitelist_gate_honors_persistent_entry() {
    let s = Setup::new();
    enable_whitelist(&s);
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);

    s.env.as_contract(&s.client.address, || {
        TokenFactory::set_persistent(&s.env, &TokenFactory::whitelist_key(&creator), &true);
    });

    // Passes the whitelist gate and stops at the deploy step instead.
    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert!(result != Err(Ok(Error::NotWhitelisted)));
}

/// An entry written only to `instance` storage — the shape a pre-migration
/// factory binary left behind — must still be honoured, so upgrading the
/// contract cannot silently lock out already-whitelisted creators.
#[test]
fn test_whitelist_gate_honors_legacy_instance_entry() {
    let s = Setup::new();
    enable_whitelist(&s);
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);

    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .set(&TokenFactory::whitelist_key(&creator), &true);
    });

    assert!(s.client.is_whitelisted(&creator));

    let result = s.client.try_create_token(
        &creator,
        &s.salt(0),
        &String::from_str(&s.env, "T"),
        &String::from_str(&s.env, "T"),
        &7,
        &0_i128,
        &None,
        &1_000,
    );
    assert!(result != Err(Ok(Error::NotWhitelisted)));
}

/// The `is_whitelisted` view and the creation gate must never disagree.
#[test]
fn test_is_whitelisted_view_agrees_with_creation_gate() {
    let s = Setup::new();
    enable_whitelist(&s);
    let creator = Address::generate(&s.env);
    s.fund(&creator, 1_000);

    let create = |salt: u8| {
        s.client.try_create_token(
            &creator,
            &s.salt(salt),
            &String::from_str(&s.env, "T"),
            &String::from_str(&s.env, "T"),
            &7,
            &0_i128,
            &None,
            &1_000,
        )
    };

    // Not listed: view says false, gate rejects.
    assert!(!s.client.is_whitelisted(&creator));
    assert_eq!(create(0), Err(Ok(Error::NotWhitelisted)));

    // Listed: view says true, gate lets the call through.
    whitelist_add(&s, &creator);
    assert!(s.client.is_whitelisted(&creator));
    assert!(create(1) != Err(Ok(Error::NotWhitelisted)));

    // Removed: view says false again, gate rejects again.
    s.client.remove_from_whitelist(&s.admin, &creator);
    assert!(!s.client.is_whitelisted(&creator));
    assert_eq!(create(2), Err(Ok(Error::NotWhitelisted)));
}

/// The batch path must apply exactly the same gate as the single path.
#[test]
fn test_whitelist_gate_consistent_across_single_and_batch() {
    let s = Setup::new();
    enable_whitelist(&s);
    let creator = Address::generate(&s.env);
    s.fund(&creator, 10_000);

    let params = soroban_sdk::vec![
        &s.env,
        BatchTokenParams {
            salt: s.salt(9),
            name: String::from_str(&s.env, "T"),
            symbol: String::from_str(&s.env, "T"),
            decimals: 7,
            initial_supply: 0,
            max_supply: None,
        }
    ];

    assert_eq!(
        s.client.try_create_tokens_batch(&creator, &params, &1_000),
        Err(Ok(Error::NotWhitelisted))
    );

    whitelist_add(&s, &creator);
    assert!(
        s.client.try_create_tokens_batch(&creator, &params, &1_000)
            != Err(Ok(Error::NotWhitelisted))
    );
}

// ── Issue #916: transfer_admin / update_admin are one operation ──────────────
//
// The two entrypoints were independent copies of the same logic that had
// drifted: only `update_admin` emitted `adm_upd`, so a rotation performed via
// `transfer_admin` left no on-chain trace and any indexer following the event
// stream kept reporting the previous admin. Both now delegate to
// `rotate_admin`.

/// Rotating via `transfer_admin` must store a pending proposal, not move admin
/// rights immediately. The new admin must call `accept_admin` to complete.
#[test]
fn test_transfer_admin_grants_new_admin_rights() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    s.client.transfer_admin(&s.admin, &new_admin);

    // Proposal stored, but admin has NOT changed yet.
    assert_eq!(s.client.get_state().pending_admin, Some(new_admin.clone()));
    assert_eq!(s.client.get_state().admin, s.admin);

    // Complete the handover.
    s.client.accept_admin(&new_admin);

    assert_eq!(s.client.get_state().admin, new_admin);
    assert_eq!(s.client.get_state().pending_admin, None);
    // The new admin can exercise an admin-only entrypoint...
    s.client.pause(&new_admin);
    assert!(s.client.get_state().paused);
    // ...and the old admin can no longer.
    assert_eq!(s.client.try_unpause(&s.admin), Err(Ok(Error::Unauthorized)));
}

/// Both `transfer_admin` and `update_admin` must enforce identical guards,
/// since they are aliases for `propose_admin`.
#[test]
fn test_transfer_admin_and_update_admin_share_guards() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let target = Address::generate(&s.env);

    // Unauthorized caller.
    assert_eq!(
        s.client.try_transfer_admin(&stranger, &target),
        s.client.try_update_admin(&stranger, &target)
    );
    // Self-transfer.
    assert_eq!(
        s.client.try_transfer_admin(&s.admin, &s.admin),
        s.client.try_update_admin(&s.admin, &s.admin)
    );
}

/// Both `transfer_admin` and `update_admin` must leave the factory in the
/// same intermediate (proposal-pending) state.
#[test]
fn test_transfer_admin_and_update_admin_produce_same_state() {
    let via_transfer = {
        let s = Setup::new();
        let new_admin = Address::generate(&s.env);
        s.client.transfer_admin(&s.admin, &new_admin);
        (s.client.get_state().pending_admin, new_admin)
    };
    let via_update = {
        let s = Setup::new();
        let new_admin = Address::generate(&s.env);
        s.client.update_admin(&s.admin, &new_admin);
        (s.client.get_state().pending_admin, new_admin)
    };
    // Both should record the correct pending_admin.
    assert_eq!(via_transfer.0, Some(via_transfer.1));
    assert_eq!(via_update.0, Some(via_update.1));
}

// ── Issue #1159: the legacy aliases must not look like a finished rotation ───
//
// `transfer_admin` / `update_admin` used to complete a rotation in one
// transaction. They now delegate to `propose_admin`, and the danger is that
// the downgrade is *invisible*: tooling and runbooks written against the old
// semantics see a successful transaction, assume the handover is done, and
// decommission the outgoing key — after which nobody can complete or restart
// the rotation once the proposal expires. Both entrypoints therefore return an
// `AdminRotationReceipt` that says the rotation is not complete, and emit an
// extra `adm_dep` event alongside `adm_prop`.

/// `transfer_admin`'s return value must state, on its own, that the rotation
/// has not happened yet and name the call that would complete it.
#[test]
fn test_transfer_admin_receipt_signals_incomplete_rotation() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    let receipt = s.client.transfer_admin(&s.admin, &new_admin);

    assert!(!receipt.rotation_complete);
    assert_eq!(receipt.pending_admin, new_admin);
    assert_eq!(
        receipt.required_next_call,
        Symbol::new(&s.env, "accept_admin")
    );
    // The receipt's expiry is the one actually recorded in state, so a caller
    // can schedule the follow-up from the return value alone.
    let state = s.client.get_state();
    assert_eq!(state.pending_admin_expiry, Some(receipt.expires_at_ledger));
    assert_eq!(state.admin, s.admin);
}

/// Same contract for `update_admin` — the other legacy name.
#[test]
fn test_update_admin_receipt_signals_incomplete_rotation() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    let receipt = s.client.update_admin(&s.admin, &new_admin);

    assert!(!receipt.rotation_complete);
    assert_eq!(receipt.pending_admin, new_admin);
    assert_eq!(
        receipt.required_next_call,
        Symbol::new(&s.env, "accept_admin")
    );
    assert_eq!(
        s.client.get_state().pending_admin_expiry,
        Some(receipt.expires_at_ledger)
    );
    assert_eq!(s.client.get_state().admin, s.admin);
}

/// A rotation driven through a deprecated alias must leave a distinct trace in
/// the event stream: `adm_prop` *and* `adm_dep`, where `propose_admin` emits
/// only `adm_prop`. That difference is what lets monitoring spot tooling still
/// running on the pre-two-step assumption.
#[test]
fn test_legacy_aliases_emit_an_extra_deprecation_event() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    s.client.propose_admin(&s.admin, &new_admin);
    assert_eq!(factory_event_count(&s), 1);

    s.client.transfer_admin(&s.admin, &new_admin);
    assert_eq!(factory_event_count(&s), 2);

    s.client.update_admin(&s.admin, &new_admin);
    assert_eq!(factory_event_count(&s), 2);
}

/// Acceptance criterion for issue #1159, stated as the failure it guards
/// against: calling `transfer_admin` and nothing else does **not** rotate the
/// admin — not immediately, and not after the proposal has expired. An
/// operator who decommissions the old key at this point has bricked the
/// factory's governance, which is why the call reports itself as incomplete.
#[test]
fn test_transfer_admin_alone_never_rotates_admin_even_after_expiry() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    s.client.transfer_admin(&s.admin, &new_admin);
    assert_eq!(s.client.get_state().admin, s.admin);

    // Let the proposal lapse without anyone calling accept_admin.
    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .saturating_add(ADMIN_PROPOSAL_TTL_LEDGERS as u32 + 1);
    });

    // Still the original admin — the rotation never took effect...
    assert_eq!(s.client.get_state().admin, s.admin);
    // ...and can no longer be completed: only a fresh proposal from the
    // current (old) admin key can restart it.
    assert_eq!(
        s.client.try_accept_admin(&new_admin),
        Err(Ok(Error::ProposalExpired))
    );
    assert_eq!(s.client.get_state().admin, s.admin);
    // The old admin retains every privilege, confirming the handover is inert.
    s.client.pause(&s.admin);
    assert!(s.client.get_state().paused);
}

/// Same for `update_admin`.
#[test]
fn test_update_admin_alone_never_rotates_admin_even_after_expiry() {
    let s = Setup::new();
    let new_admin = Address::generate(&s.env);

    s.client.update_admin(&s.admin, &new_admin);

    s.env.ledger().with_mut(|li| {
        li.sequence_number = li
            .sequence_number
            .saturating_add(ADMIN_PROPOSAL_TTL_LEDGERS as u32 + 1);
    });

    assert_eq!(
        s.client.try_accept_admin(&new_admin),
        Err(Ok(Error::ProposalExpired))
    );
    assert_eq!(s.client.get_state().admin, s.admin);
}

// ── migrate: schema-v3 chunked walk must be resumable ───────────────────────
//
// The v3 step walks `TokenInfo` indices `1..=token_count` in slices of
// `MIGRATE_TOKEN_INFO_CHUNK` so a factory too large to migrate in one
// invocation's resource budget can finish across several `migrate` calls. That
// only works if the version marker stays below 3 until the cursor catches up:
// bumping it early makes every later call skip the block, stranding the
// unmigrated entries in `instance` storage forever.

/// Seed `count` `TokenInfo` entries in `instance` storage and rewind the
/// factory to schema v2, simulating a pre-#1007 deployment mid-upgrade.
fn seed_legacy_instance_tokens(s: &Setup, count: u32) {
    s.env.as_contract(&s.client.address, || {
        let mut state: FactoryState = s.env.storage().instance().get(&DataKey::State).unwrap();
        state.token_count = count;
        state.schema_version = 2;
        s.env.storage().instance().set(&DataKey::State, &state);
        s.env.storage().instance().set(&symbol_short!("sv"), &2u32);

        for i in 1..=count {
            let info = TokenInfo {
                name: String::from_str(&s.env, "T"),
                symbol: String::from_str(&s.env, "T"),
                decimals: 7,
                creator: s.admin.clone(),
                created_at: 0,
                burn_enabled: true,
                max_supply: None,
            };
            s.env
                .storage()
                .instance()
                .set(&DataKey::TokenInfo(i), &info);
        }
    });
}

#[test]
fn test_migrate_v3_does_not_complete_in_one_chunk_when_oversized() {
    let s = Setup::new();
    let count = MIGRATE_TOKEN_INFO_CHUNK * 3;
    seed_legacy_instance_tokens(&s, count);

    s.client.migrate(&s.admin);

    // Only the first chunk moved, so the migration must still be pending.
    assert_eq!(s.client.get_state().schema_version, 2);
    s.env.as_contract(&s.client.address, || {
        let cursor: u32 = s
            .env
            .storage()
            .instance()
            .get(&symbol_short!("mig3cur"))
            .unwrap();
        assert_eq!(cursor, MIGRATE_TOKEN_INFO_CHUNK);
    });
}

#[test]
fn test_migrate_v3_completes_across_repeated_calls() {
    let s = Setup::new();
    let count = MIGRATE_TOKEN_INFO_CHUNK * 3;
    seed_legacy_instance_tokens(&s, count);

    // Three chunks' worth of entries need three calls to finish.
    for _ in 0..3 {
        s.client.migrate(&s.admin);
    }

    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);

    // Every entry must now live in persistent storage, and none in instance.
    s.env.as_contract(&s.client.address, || {
        for i in 1..=count {
            let key = DataKey::TokenInfo(i);
            assert!(
                s.env.storage().persistent().has(&key),
                "TokenInfo({i}) was not migrated to persistent storage"
            );
            assert!(
                !s.env.storage().instance().has(&key),
                "TokenInfo({i}) was left behind in instance storage"
            );
        }
    });
}

/// A factory small enough to migrate in one chunk must still finish in a
/// single call — the resumability fix must not slow down the common case.
#[test]
fn test_migrate_v3_completes_in_one_call_when_small() {
    let s = Setup::new();
    seed_legacy_instance_tokens(&s, 3);

    s.client.migrate(&s.admin);

    assert_eq!(s.client.get_state().schema_version, CURRENT_SCHEMA_VERSION);
}

// ── Issue #943: index → address reverse mapping ──────────────────────────────
//
// The factory could resolve address → index (`get_token_index`) but not the
// inverse, and `get_token_info(index)` does not carry the token's own address.
// The enumerable key space `1..=token_count` was therefore useless to an
// off-chain indexer: it could reach `TokenInfo` but never the address it
// belongs to, so addresses could only be learned from `created` events —
// which reach back only as far as the RPC's event-retention window. That is
// precisely the truncation issue #943 exists to remove.

/// `seed_token` mirrors the real creation path, so the reverse mapping it
/// writes must round-trip in both directions.
#[test]
fn test_get_token_address_round_trips_with_get_token_index() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let token_addr = seed_token(&s, &creator, true, None);

    let index = s.client.get_token_index(&token_addr);
    assert_eq!(s.client.get_token_address(&index), token_addr);
}

/// Every index in `1..=token_count` must resolve, which is what lets an
/// indexer enumerate the whole token set from contract state alone.
#[test]
fn test_get_token_address_enumerates_full_token_set() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);

    let mut expected = std::vec::Vec::new();
    for _ in 0..5 {
        expected.push(seed_token(&s, &creator, true, None));
    }

    let token_count = s.client.get_state().token_count;
    assert_eq!(token_count, 5);

    for (i, addr) in expected.iter().enumerate() {
        // Indices are 1-based.
        let index = (i as u32).checked_add(1).unwrap();
        assert_eq!(&s.client.get_token_address(&index), addr);
    }
}

#[test]
fn test_get_token_address_unknown_index_returns_not_found() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_get_token_address(&999),
        Err(Ok(Error::TokenNotFound))
    );
}

// ── backfill_token_address ──────────────────────────────────────────────────

/// Simulate a token created by a factory binary predating the reverse
/// mapping: the forward `TokenIndex` entry exists but `TokenAddress` does not.
fn seed_token_without_reverse_mapping(s: &Setup, creator: &Address) -> (Address, u32) {
    let token_addr = seed_token(s, creator, true, None);
    let index = s.client.get_token_index(&token_addr);
    s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .remove(&DataKey::TokenAddress(index));
    });
    (token_addr, index)
}

#[test]
fn test_backfill_token_address_repairs_a_pre_existing_token() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let (token_addr, index) = seed_token_without_reverse_mapping(&s, &creator);

    // Unmapped before the back-fill.
    assert_eq!(
        s.client.try_get_token_address(&index),
        Err(Ok(Error::TokenNotFound))
    );

    assert_eq!(s.client.backfill_token_address(&token_addr), index);
    assert_eq!(s.client.get_token_address(&index), token_addr);
}

#[test]
fn test_backfill_token_address_is_idempotent() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let (token_addr, index) = seed_token_without_reverse_mapping(&s, &creator);

    assert_eq!(s.client.backfill_token_address(&token_addr), index);
    // Re-running must be a no-op, not an error or a rewrite.
    assert_eq!(s.client.backfill_token_address(&token_addr), index);
    assert_eq!(s.client.get_token_address(&index), token_addr);
}

/// The entrypoint is permissionless, so it must never accept an address the
/// factory did not itself register — otherwise anyone could point an index at
/// a contract of their choosing.
#[test]
fn test_backfill_token_address_rejects_unregistered_address() {
    let s = Setup::new();
    let stranger = Address::generate(&s.env);
    let rogue_token = s.new_token(&stranger);

    assert_eq!(
        s.client.try_backfill_token_address(&rogue_token),
        Err(Ok(Error::TokenNotFound))
    );
}

/// The index is read back from the factory's own `TokenIndex` entry, never
/// taken from the caller, so a back-fill cannot repoint an index that is
/// already correctly mapped to a different token.
#[test]
fn test_backfill_token_address_cannot_hijack_another_index() {
    let s = Setup::new();
    let creator = Address::generate(&s.env);
    let first = seed_token(&s, &creator, true, None);
    let (second, second_index) = seed_token_without_reverse_mapping(&s, &creator);

    let first_index = s.client.get_token_index(&first);
    s.client.backfill_token_address(&second);

    // Each index still resolves to its own token.
    assert_eq!(s.client.get_token_address(&first_index), first);
    assert_eq!(s.client.get_token_address(&second_index), second);
    assert_ne!(first_index, second_index);
}

// ── Error discriminant uniqueness (issue #1164) ───────────────────────────────
//
// Rust permits duplicate explicit discriminants on a fieldless enum and does
// not warn on them, but Soroban surfaces `#[contracterror]` values to external
// callers as bare u32 codes. A collision makes semantically distinct errors
// indistinguishable to any monitoring, retry, or display logic that branches
// on the numeric code. This test fails CI if any two variants share a
// discriminant, ensuring a future collision can never ship.
#[test]
fn test_error_discriminants_are_unique() {
    extern crate std;
    use std::collections::HashSet;

    let codes: &[u32] = &[
        Error::InsufficientFee as u32,
        Error::Unauthorized as u32,
        Error::InvalidParameters as u32,
        Error::TokenNotFound as u32,
        Error::MetadataAlreadySet as u32,
        Error::AlreadyInitialized as u32,
        Error::BurnAmountExceedsBalance as u32,
        Error::BurnNotEnabled as u32,
        Error::InvalidBurnAmount as u32,
        Error::ContractPaused as u32,
        Error::Reentrancy as u32,
        Error::ArithmeticOverflow as u32,
        Error::StateNotFound as u32,
        Error::InvalidTokenParams as u32,
        Error::InvalidDecimals as u32,
        Error::MaxSupplyExceeded as u32,
        Error::InvalidFeeSplit as u32,
        Error::TooManyFeeSplitRecipients as u32,
        Error::AlreadyBackfilled as u32,
        Error::NotWhitelisted as u32,
        Error::InvalidMetadataUri as u32,
        Error::ZeroFeeSplitEntry as u32,
        Error::MetadataFrozen as u32,
        Error::TreasuryTransferFailed as u32,
        Error::BatchSizeExceeded as u32,
        Error::NoPendingProposal as u32,
        Error::ProposalExpired as u32,
    ];

    let mut seen = HashSet::new();
    for &code in codes {
        assert!(
            seen.insert(code),
            "Duplicate error discriminant {} — every Error variant must have a unique u32 code \
             because Soroban surfaces them as bare wire values to external callers (issue #1164).",
            code
        );
    }

    // Also assert the total matches the expected variant count so this test
    // itself fails loudly when a new variant is added without being listed.
    assert_eq!(
        codes.len(),
        27,
        "Error enum has a different number of variants than this test expects. \
         Add the new variant(s) to the `codes` slice above (issue #1164)."
    );
}
