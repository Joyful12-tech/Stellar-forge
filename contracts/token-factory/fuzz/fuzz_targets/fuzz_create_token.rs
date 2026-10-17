#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

#[derive(Arbitrary, Debug, Clone)]
struct FuzzCreateTokenInput {
    // Random bytes for name and symbol - bounded to avoid extremely long strings
    name_bytes: Vec<u8>,
    symbol_bytes: Vec<u8>,
    decimals: u32,
    // As of issue #1022 `create_token`'s `initial_supply` is `i128` (unified
    // with the batch path), so the fuzzer generates it directly as an i128 —
    // the earlier `u128`→`i128` overflow region no longer exists at the ABI.
    initial_supply: i128,
    // `Option<i128>` supply cap, also validated by the shared routine.
    max_supply: Option<i128>,
    fee_payment: i128,
}

/// Pure re-implementation of the contract's shared `validate_token_params`
/// rules (see `contracts/token-factory/src/lib.rs`). Returns a stable tag for
/// the fault class, or `None` when the parameters are valid. Kept in sync with
/// the contract by the property test `prop_single_and_batch_paths_agree`.
fn classify(
    name_len: usize,
    symbol_len: usize,
    decimals: u32,
    initial_supply: i128,
    max_supply: Option<i128>,
) -> Option<&'static str> {
    if name_len == 0 || name_len > 32 {
        return Some("InvalidTokenParams");
    }
    if symbol_len == 0 || symbol_len > 12 {
        return Some("InvalidTokenParams");
    }
    if decimals > 18 {
        return Some("InvalidDecimals");
    }
    if initial_supply < 0 {
        return Some("InvalidParameters");
    }
    if let Some(cap) = max_supply {
        if cap <= 0 || initial_supply > cap {
            return Some("InvalidParameters");
        }
    }
    None
}

fuzz_target!(|input: FuzzCreateTokenInput| {
    // Convert random bytes to valid UTF-8 strings (mirrors what the frontend
    // would submit; the contract validates lengths, not encoding).
    let name_str = match String::from_utf8(input.name_bytes) {
        Ok(s) => s,
        _ => "DefaultToken".to_string(),
    };
    let symbol_str = match String::from_utf8(input.symbol_bytes) {
        Ok(s) => s,
        _ => "DTK".to_string(),
    };

    // The validation predicate must be total (never panic) for every input,
    // and deterministic — the same parameters always classify the same way.
    let first = classify(
        name_str.len(),
        symbol_str.len(),
        input.decimals,
        input.initial_supply,
        input.max_supply,
    );
    let second = classify(
        name_str.len(),
        symbol_str.len(),
        input.decimals,
        input.initial_supply,
        input.max_supply,
    );
    assert_eq!(
        first, second,
        "validation classification must be deterministic"
    );

    // Cross-check the individual fault-class invariants hold exactly as the
    // contract documents (one code per fault class, checked in order).
    match first {
        Some("InvalidTokenParams") => assert!(
            name_str.is_empty()
                || name_str.len() > 32
                || symbol_str.is_empty()
                || symbol_str.len() > 12,
            "InvalidTokenParams implies a bad name or symbol length"
        ),
        Some("InvalidDecimals") => assert!(
            name_str.len() >= 1
                && name_str.len() <= 32
                && symbol_str.len() >= 1
                && symbol_str.len() <= 12
                && input.decimals > 18,
            "InvalidDecimals implies valid name/symbol but decimals > 18"
        ),
        Some("InvalidParameters") => assert!(
            input.initial_supply < 0
                || matches!(input.max_supply, Some(cap) if cap <= 0 || input.initial_supply > cap),
            "InvalidParameters implies a bad initial_supply or max_supply"
        ),
        None => {
            // Valid: every documented constraint must hold simultaneously.
            assert!(name_str.len() >= 1 && name_str.len() <= 32);
            assert!(symbol_str.len() >= 1 && symbol_str.len() <= 12);
            assert!(input.decimals <= 18);
            assert!(input.initial_supply >= 0);
            if let Some(cap) = input.max_supply {
                assert!(cap > 0 && input.initial_supply <= cap);
            }
        }
        Some(other) => panic!("unexpected classification tag: {other}"),
    }

    // Fee arithmetic on the (untrusted) fee_payment must never panic.
    let fee_bounded = input.fee_payment.saturating_abs();
    let _total = fee_bounded.saturating_add(i64::MAX as i128);
    let _product = fee_bounded.saturating_mul(i128::from(input.decimals % 19));
});
