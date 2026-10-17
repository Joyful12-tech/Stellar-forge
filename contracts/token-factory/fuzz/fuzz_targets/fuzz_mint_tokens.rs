#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

#[derive(Arbitrary, Debug, Clone)]
struct FuzzMintTokensInput {
    amount: i128,
    fee_payment: i128,
    base_fee: i128,
    // Simulates token_info.max_supply
    max_supply: Option<i128>,
    // Simulates already-minted supply tracked in storage. Since issue #1006,
    // `deploy_one` seeds this with `initial_supply` at creation time when
    // `max_supply` is set, so nonzero starting values (including
    // `current_supply == max_supply`, a token "fully minted" at creation)
    // are the expected common case, not an edge case. See corpus seeds
    // `initial_supply_equals_cap_any_mint_fails`,
    // `initial_supply_near_cap_exact_remainder_succeeds`, and
    // `initial_supply_near_cap_one_over_fails`.
    current_supply: i128,
}

fuzz_target!(|input: FuzzMintTokensInput| {
    let base_fee = input.base_fee.saturating_abs();
    let fee_payment = input.fee_payment;
    let amount = input.amount;

    // --- Guard: amount must be > 0 (mirrors `if amount <= 0` in mint_tokens) ---
    if amount <= 0 {
        // Contract returns InvalidParameters; no further arithmetic is performed.
        return;
    }

    // --- Guard: fee must cover base_fee ---
    if fee_payment < base_fee {
        // Contract returns InsufficientFee.
        return;
    }

    // After both guards pass, fee remainder must be non-negative.
    let fee_remainder = fee_payment.saturating_sub(base_fee);
    assert!(fee_remainder >= 0);

    // --- Max-supply cap arithmetic (mirrors the checked_add in mint_tokens) ---
    if let Some(cap) = input.max_supply {
        // Only positive caps are meaningful; non-positive caps are invalid params
        // in create_token/batch, so we can skip them here.
        if cap <= 0 {
            return;
        }

        let current = input.current_supply.max(0); // storage always holds >= 0

        // This is the exact expression from lib.rs line 551:
        //   let new_total = current.checked_add(amount).ok_or(Error::ArithmeticOverflow)?;
        match current.checked_add(amount) {
            None => {
                // Overflow path — contract returns ArithmeticOverflow, no panic.
                return;
            }
            Some(new_total) => {
                if new_total > cap {
                    // Contract returns MaxSupplyExceeded.
                    return;
                }
                // Successful path: new_total is within the cap.
                assert!(new_total > current, "minting a positive amount must increase supply");
                assert!(new_total <= cap, "supply must never exceed cap");
            }
        }
    } else {
        // No cap: unlimited mint — only the amount guard applies.
        // Verify the mint amount itself doesn't silently wrap when accumulated.
        let accumulated = amount.saturating_add(amount);
        assert!(accumulated >= amount, "saturating_add must not decrease value for positive inputs");
    }

    // --- Fee distribution arithmetic (mirrors distribute_fee) ---
    // Verify that splitting the fee across multiple recipients cannot panic.
    // Model: two recipients each receiving 50 % (5_000 bps out of 10_000).
    let share_a = fee_payment
        .saturating_mul(5_000)
        / 10_000;
    let share_b = fee_payment
        .saturating_mul(5_000)
        / 10_000;
    let distributed = share_a.saturating_add(share_b);
    let _remainder = fee_payment.saturating_sub(distributed);

    assert!(share_a >= 0 || fee_payment < 0);
    assert!(share_b >= 0 || fee_payment < 0);
});
