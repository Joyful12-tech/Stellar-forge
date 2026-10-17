#![no_main]

extern crate std;

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String,
};
use token_factory::{Error, TokenFactory, TokenFactoryArgs, TokenFactoryClient};

/// Fuzz input: the balance to seed the burner with, the amount to burn, and
/// whether burning is enabled for the token. The full `i64` range (rather
/// than `i128`) keeps generated inputs dense around realistic magnitudes
/// while still covering zero/negative amounts and large balances.
#[derive(Arbitrary, Debug, Clone)]
struct FuzzBurnInput {
    initial_balance: i64,
    burn_amount: i64,
    burn_enabled: bool,
}

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

// This target drives the *real* `TokenFactory::burn` entrypoint (via the
// generated `TokenFactoryClient`) against a live `soroban_sdk::testutils`
// `Env`, rather than reimplementing burn's arithmetic inline. The only
// bypass is token *registration*: no real token WASM is available to install
// at a `token_wasm_hash` in a native test/fuzz environment (see the note on
// `mod bench` in `src/lib.rs`), so — exactly like the crate's own
// `seed_token` helper in `src/test.rs` — a real Stellar Asset Contract
// stands in for the deployed token, and `TokenFactory::fuzz_seed_token`
// (a `#[cfg(feature = "testutils")]`-only, non-`#[contractimpl]` associated
// function) records it in factory storage the same way `create_token` would
// have. Everything downstream of that — the `burn` call itself, its
// `TokenNotFound`/`Unauthorized`/`InvalidBurnAmount`/
// `BurnAmountExceedsBalance` gates, its reentrancy lock, and its actual
// cross-contract `token::burn` invocation — runs as real contract code.
fuzz_target!(|input: FuzzBurnInput| {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let creator = Address::generate(&env);
    let burner = Address::generate(&env);
    let fee_token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let factory_id = env.register(
        TokenFactory,
        TokenFactoryArgs::__constructor(&admin, &treasury, &fee_token, &dummy_hash(&env), &1_000, &500),
    );
    let client = TokenFactoryClient::new(&env, &factory_id);

    let token_addr = env
        .register_stellar_asset_contract_v2(creator.clone())
        .address();
    env.as_contract(&factory_id, || {
        TokenFactory::fuzz_seed_token(
            &env,
            &token_addr,
            &creator,
            String::from_str(&env, "FuzzToken"),
            String::from_str(&env, "FUZ"),
            7,
            input.burn_enabled,
            None,
        );
    });

    let initial_balance = (input.initial_balance as i128).saturating_abs();
    if initial_balance > 0 {
        StellarAssetClient::new(&env, &token_addr).mint(&burner, &initial_balance);
    }

    let burn_amount = input.burn_amount as i128;
    let balance_before = TokenClient::new(&env, &token_addr).balance(&burner);

    let result = client.try_burn(&token_addr, &burner, &burn_amount);

    match result {
        Ok(Err(conv)) => panic!("unexpected XDR conversion error from burn: {conv:?}"),
        Ok(Ok(())) => {
            assert!(
                input.burn_enabled,
                "burn succeeded while burn_enabled=false"
            );
            assert!(
                burn_amount > 0,
                "burn succeeded with non-positive amount {burn_amount}"
            );
            assert!(
                burn_amount <= balance_before,
                "burn succeeded burning {burn_amount} against balance {balance_before}"
            );
            let balance_after = TokenClient::new(&env, &token_addr).balance(&burner);
            assert_eq!(
                balance_after,
                balance_before - burn_amount,
                "balance did not decrease by exactly the burned amount \
                 (before={balance_before}, amount={burn_amount}, after={balance_after})"
            );
        }
        Err(Ok(Error::InvalidBurnAmount)) => {
            assert!(
                burn_amount <= 0,
                "InvalidBurnAmount returned for a positive amount {burn_amount}"
            );
        }
        Err(Ok(Error::BurnAmountExceedsBalance)) => {
            assert!(
                burn_amount > balance_before,
                "BurnAmountExceedsBalance returned within balance \
                 ({burn_amount} <= {balance_before})"
            );
        }
        Err(Ok(Error::Unauthorized)) => {
            assert!(
                !input.burn_enabled,
                "Unauthorized returned while burn_enabled=true"
            );
        }
        Err(Ok(other)) => panic!("unexpected contract error from burn: {other:?}"),
        Err(Err(_)) => {
            // Host-level invoke error (e.g. resource exhaustion on a very
            // large seeded balance) — not a contract-logic bug to assert on.
        }
    }
});
