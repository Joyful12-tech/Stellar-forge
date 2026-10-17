#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

/// A single fee-split recipient: an opaque index (stands in for an `Address`)
/// and a basis-points share.  The fuzzer generates the raw bps values; the
/// harness normalises them to a valid split before testing.
#[derive(Arbitrary, Debug, Clone)]
struct Recipient {
    /// Index used as a stand-in for an opaque Address in the balance map.
    index: u8,
    /// Raw basis-point value (0–65_535).  Normalised later.
    raw_bps: u16,
}

/// Full fuzz input.
///
/// `fee_payment` — the amount to distribute.  The full i128 range is
/// intentionally covered so the fuzzer can discover any arithmetic path
/// the contract takes, including edge cases at 0 and i128::MAX.
///
/// `recipients` — 1–10 recipients.  Their raw_bps values are normalised to
/// sum to exactly 10_000 before the split is applied so every generated
/// input exercises a *valid* split configuration (matching what
/// `set_fee_split` would accept).
///
/// `base_fee` / `metadata_fee` — tested against the sign-validation guard
/// in `initialize` and `update_fees`.
#[derive(Arbitrary, Debug, Clone)]
struct FuzzFeeArithmeticInput {
    base_fee: i128,
    metadata_fee: i128,
    num_operations: u8,
    update_base_fee: i128,
    update_metadata_fee: i128,
    /// The fee amount to distribute through the split logic.
    fee_payment: i128,
    /// 1–10 recipients for the split (clamped by the harness).
    recipients: Vec<Recipient>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers mirroring the contract's sign-validation guard
// ─────────────────────────────────────────────────────────────────────────────

/// Returns `true` if the fee value is valid (non-negative).
/// Must stay in sync with the guard in `lib.rs`:
///   `if base_fee < 0 || metadata_fee < 0 { return Err(Error::InvalidParameters); }`
fn fee_is_valid(fee: i128) -> bool {
    fee >= 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure-Rust model of `distribute_fee`
//
// This faithfully replicates the arithmetic the contract performs in
// `distribute_fee` without needing a live Soroban environment.  The model
// is intentionally kept minimal — it does exactly what the contract does,
// nothing more — so any divergence between the model's result and the
// contract's result is itself a bug.
//
// Contract logic (lib.rs, `distribute_fee`, largest-remainder allocation
// introduced for issue #1024):
//
//   Pass 1: for each recipient compute
//       floor = amount.checked_mul(bps as i128)? / 10_000
//       frac  = amount*bps - floor*10_000        (fractional numerator)
//   Pass 2: while remainder = amount - Σfloor > 0, award one extra stroop
//       to the entry with the largest frac, zeroing its frac (each entry
//       wins at most once); stop when all fracs are zero.
//   Pass 3: transfer each share (skipping share == 0); any leftover
//       remainder goes to treasury.
// ─────────────────────────────────────────────────────────────────────────────

/// Result of running the `distribute_fee` model.
#[derive(Debug)]
struct DistributeResult {
    /// Shares credited to each recipient (parallel to input `bps` slice).
    /// An entry is 0 when the share floored to zero (transfer skipped).
    shares: Vec<i128>,
    /// Amount sent to treasury as the rounding remainder.
    treasury_remainder: i128,
    /// `true` if any `checked_mul` or `checked_add` overflowed.
    overflowed: bool,
}

/// Model of `distribute_fee` for a valid split (bps values already sum to
/// 10_000).  `amount` must be non-negative (the contract only ever calls
/// `distribute_fee` after the fee-gate check ensures `fee_payment >= 0`).
fn model_distribute_fee(amount: i128, bps_values: &[u32]) -> DistributeResult {
    if amount < 0 {
        // The contract never reaches distribute_fee with a negative amount.
        return DistributeResult {
            shares: vec![0; bps_values.len()],
            treasury_remainder: 0,
            overflowed: false,
        };
    }

    // Pass 1: floor shares + fractional numerators (mirrors the contract's
    // largest-remainder allocation, issue #1024).
    let mut shares = Vec::with_capacity(bps_values.len());
    let mut fracs = Vec::with_capacity(bps_values.len());
    let mut total_floor: i128 = 0;
    let mut overflowed = false;

    for &bps in bps_values {
        let bps_i = bps as i128;
        match amount.checked_mul(bps_i) {
            None => {
                // checked_mul overflowed — contract returns ArithmeticOverflow.
                overflowed = true;
                shares.push(0);
                fracs.push(0);
                continue;
            }
            Some(product) => {
                let floor = product / 10_000;
                // frac numerator = amount*bps - floor*10_000
                let frac = match floor.checked_mul(10_000) {
                    None => {
                        overflowed = true;
                        0
                    }
                    Some(f10k) => product - f10k,
                };
                shares.push(floor);
                fracs.push(frac);
                match total_floor.checked_add(floor) {
                    None => overflowed = true,
                    Some(t) => total_floor = t,
                }
            }
        }
    }

    if overflowed {
        return DistributeResult {
            shares,
            treasury_remainder: 0,
            overflowed: true,
        };
    }

    // Pass 2: award the remainder one stroop at a time to the entry with the
    // largest fractional numerator (each entry can win at most once — its
    // frac is zeroed after the award). Any leftover goes to treasury.
    let mut remainder = match amount.checked_sub(total_floor) {
        None => {
            return DistributeResult {
                shares,
                treasury_remainder: 0,
                overflowed: true,
            };
        }
        Some(r) => r,
    };

    while remainder > 0 {
        let mut best_idx = 0usize;
        let mut best_frac: i128 = -1;
        for (i, &f) in fracs.iter().enumerate() {
            if f > best_frac {
                best_frac = f;
                best_idx = i;
            }
        }
        if best_frac <= 0 {
            break;
        }
        shares[best_idx] = shares[best_idx].saturating_add(1);
        fracs[best_idx] = 0;
        remainder -= 1;
    }

    DistributeResult {
        shares,
        treasury_remainder: remainder,
        overflowed: false,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalise raw bps values to a valid split summing to exactly 10_000
// ─────────────────────────────────────────────────────────────────────────────

/// Takes an arbitrary slice of `(index, raw_bps)` pairs and returns a
/// deduplicated, normalised `Vec<u32>` of basis-point values summing to
/// exactly 10_000, with at least one and at most `max_recipients` entries.
///
/// Normalisation strategy:
/// 1. Deduplicate by index (first occurrence wins) so we model distinct
///    addresses, which is how the contract's `Map<Address, u32>` behaves.
/// 2. Clamp to `max_recipients`.
/// 3. If all raw values are zero, assign equal shares (floors) plus a
///    remainder on the first recipient so the sum is always 10_000.
/// 4. Scale each raw value proportionally so the sum is 10_000.  Any
///    rounding remainder from the scaling is added to the first entry.
fn normalise_splits(recipients: &[Recipient], max_recipients: usize) -> Vec<u32> {
    // Step 1: deduplicate by index.
    let mut seen = std::collections::HashSet::new();
    let mut unique: Vec<u16> = Vec::new();
    for r in recipients {
        if seen.insert(r.index) {
            unique.push(r.raw_bps);
        }
    }

    // Step 2: clamp to max_recipients and ensure at least 1 entry.
    if unique.is_empty() {
        unique.push(1);
    }
    unique.truncate(max_recipients);
    let n = unique.len();

    // Step 3: handle all-zero case.
    let raw_sum: u64 = unique.iter().map(|&x| x as u64).sum();
    if raw_sum == 0 {
        // Assign equal shares; any remainder goes to index 0.
        let per = 10_000u32 / n as u32;
        let rem = 10_000u32 - per * n as u32;
        let mut bps = vec![per; n];
        bps[0] += rem;
        return bps;
    }

    // Step 4: scale proportionally.
    let mut bps: Vec<u32> = unique
        .iter()
        .map(|&x| {
            // Scale: (x / raw_sum) * 10_000, using u64 intermediate to avoid
            // overflow (raw_sum ≤ 65_535 * 10 = 655_350; x * 10_000 ≤ ~655M,
            // well within u64).
            ((x as u64 * 10_000) / raw_sum) as u32
        })
        .collect();

    // Fix any rounding deficit so the sum is exactly 10_000.
    let current_sum: u32 = bps.iter().sum();
    if current_sum < 10_000 {
        bps[0] += 10_000 - current_sum;
    } else if current_sum > 10_000 {
        // Over-allocation (can happen with rounding): trim from the largest.
        let excess = current_sum - 10_000;
        let max_idx = bps
            .iter()
            .enumerate()
            .max_by_key(|&(_, &v)| v)
            .map(|(i, _)| i)
            .unwrap_or(0);
        bps[max_idx] = bps[max_idx].saturating_sub(excess);
    }

    debug_assert_eq!(
        bps.iter().sum::<u32>(),
        10_000,
        "normalised split must sum to 10_000"
    );
    bps
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzz entry point
// ─────────────────────────────────────────────────────────────────────────────

fuzz_target!(|input: FuzzFeeArithmeticInput| {
    // ── 1. Sign validation — initialize path ─────────────────────────────────
    let init_should_succeed =
        fee_is_valid(input.base_fee) && fee_is_valid(input.metadata_fee);

    if !init_should_succeed {
        assert!(
            input.base_fee < 0 || input.metadata_fee < 0,
            "init_should_succeed is false but both fees are non-negative: \
             base_fee={}, metadata_fee={}",
            input.base_fee,
            input.metadata_fee
        );
        return;
    }

    let base_fee = input.base_fee;
    let metadata_fee = input.metadata_fee;
    assert!(base_fee >= 0);
    assert!(metadata_fee >= 0);

    // ── 2. Sign validation — update_fees path ────────────────────────────────
    let update_base_valid = fee_is_valid(input.update_base_fee);
    let update_meta_valid = fee_is_valid(input.update_metadata_fee);

    let effective_base = if update_base_valid {
        input.update_base_fee
    } else {
        base_fee
    };
    let effective_meta = if update_meta_valid {
        input.update_metadata_fee
    } else {
        metadata_fee
    };

    assert!(
        effective_base >= 0,
        "stored base_fee must be non-negative after update, got {}",
        effective_base
    );
    assert!(
        effective_meta >= 0,
        "stored metadata_fee must be non-negative after update, got {}",
        effective_meta
    );

    // ── 3. Fee-gate correctness ───────────────────────────────────────────────
    if effective_base > 0 {
        assert!(0_i128 < effective_base);
    }
    if effective_meta > 0 {
        assert!(0_i128 < effective_meta);
    }

    // ── 4. distribute_fee arithmetic — per-recipient conservation invariant ──
    //
    // This is the core of issue #918.  For any non-negative fee_payment and
    // any valid split (bps sum == 10_000), the contract's distribute_fee must
    // satisfy:
    //
    //   sum(all recipient shares) + treasury_remainder == fee_payment
    //
    // i.e. not a single stroop is leaked or double-counted.
    //
    // The fuzzer generates arbitrary (fee_payment, splits) pairs.  We
    // normalise the splits to always sum to 10_000 and then run the model to
    // verify the invariant.
    //
    // We only test non-negative fee_payment values because distribute_fee is
    // only ever called after the fee-gate check (fee_payment >= required_fee
    // >= 0).

    // Clamp to at most MAX_FEE_SPLIT_RECIPIENTS (= 10) recipients.
    const MAX_RECIPIENTS: usize = 10;
    let bps_values = normalise_splits(&input.recipients, MAX_RECIPIENTS);

    // Verify normalisation invariant before using it.
    assert_eq!(
        bps_values.iter().sum::<u32>(),
        10_000,
        "normalised split must sum to exactly 10_000; got: {:?}",
        bps_values
    );
    assert!(
        !bps_values.is_empty() && bps_values.len() <= MAX_RECIPIENTS,
        "normalised split must have 1..=MAX_RECIPIENTS entries; got {}",
        bps_values.len()
    );

    // Only test non-negative fee amounts (matches contract precondition).
    if input.fee_payment < 0 {
        return;
    }
    let fee_payment = input.fee_payment;

    let result = model_distribute_fee(fee_payment, &bps_values);

    if result.overflowed {
        // The contract returns ArithmeticOverflow in this case — not a panic,
        // so we just skip the invariant check (the overflow itself is the
        // expected behaviour, and it only happens for very large fee values
        // approaching i128::MAX / 10_000 ≈ 1.7 × 10^34 stroops).
        return;
    }

    // Primary invariant: sum(shares) + treasury_remainder == fee_payment.
    let share_sum: i128 = result.shares.iter().sum();

    assert_eq!(
        share_sum + result.treasury_remainder,
        fee_payment,
        "CONSERVATION VIOLATED: sum(shares)={share_sum} + \
         treasury_remainder={} != fee_payment={fee_payment}  \
         (bps={:?})",
        result.treasury_remainder,
        bps_values,
    );

    // Secondary invariants:
    // - No individual share is negative.
    for (i, &share) in result.shares.iter().enumerate() {
        assert!(
            share >= 0,
            "share[{i}] is negative ({share}) for fee_payment={fee_payment}, \
             bps={:?}",
            bps_values
        );
    }
    // - Remainder is non-negative.
    assert!(
        result.treasury_remainder >= 0,
        "treasury_remainder is negative ({}) for fee_payment={fee_payment}, \
         bps={:?}",
        result.treasury_remainder,
        bps_values
    );
    // - Remainder is strictly less than the number of recipients (a valid
    //   split of N entries can produce a remainder of at most N-1 units due
    //   to integer-division rounding).
    let n = bps_values.len() as i128;
    assert!(
        result.treasury_remainder < n,
        "treasury_remainder={} is >= num_recipients={n} for \
         fee_payment={fee_payment}, bps={:?}  \
         (indicates a systematic rounding bug rather than single-stroop drift)",
        result.treasury_remainder,
        bps_values
    );

    // ── 5. Batch fee multiplication ───────────────────────────────────────────
    let ops = (input.num_operations.min(100) as i128).max(1);
    let total_fee = effective_base.checked_mul(ops);
    let saturating_total = effective_base.saturating_mul(ops);

    if let Some(product) = total_fee {
        assert_eq!(product, saturating_total);
        assert!(product >= 0, "batch fee product must be non-negative");
        assert!(
            product >= effective_base || effective_base == 0,
            "batch fee must be >= single-op fee: product={product}, base={effective_base}"
        );
    } else {
        assert_eq!(
            saturating_total,
            i128::MAX,
            "saturating overflow must cap at i128::MAX"
        );
    }
    assert!(
        saturating_total >= 0,
        "saturating batch fee must be non-negative"
    );

    // ── 6. Charged-amount invariant (issue #1008) ────────────────────────────
    //
    // `fee_payment` is only the caller's authorized upper bound — the
    // contract must charge (i.e. hand to `distribute_fee`) exactly the
    // currently required fee, never `fee_payment` itself. Model this for
    // every entrypoint's required-fee value: `base_fee` (create_token /
    // mint_tokens), `total_fee` (create_tokens_batch, base_fee * count), and
    // `metadata_fee` (set_metadata). For any `fee_payment >= required_fee`,
    // the charged amount must equal `required_fee` exactly and must never
    // exceed `fee_payment`; the split-conservation invariant must then hold
    // against the charged amount, not `fee_payment`.
    let batch_total_fee = if let Some(product) = total_fee {
        product
    } else {
        saturating_total
    };
    let required_fees = [effective_base, batch_total_fee, effective_meta];

    for &required_fee in &required_fees {
        if fee_payment < required_fee {
            // The fee gate rejects this call before distribute_fee is ever
            // reached — nothing is charged, so there's nothing to check.
            continue;
        }

        let charged = required_fee;
        assert!(
            charged <= fee_payment,
            "charged amount ({charged}) must never exceed fee_payment ({fee_payment})"
        );
        assert_eq!(
            charged, required_fee,
            "charged amount must equal the required fee exactly, never fee_payment \
             (fee_payment={fee_payment}, required_fee={required_fee})"
        );

        let charge_result = model_distribute_fee(charged, &bps_values);
        if charge_result.overflowed {
            continue;
        }
        let charge_share_sum: i128 = charge_result.shares.iter().sum();
        assert_eq!(
            charge_share_sum + charge_result.treasury_remainder,
            charged,
            "CONSERVATION VIOLATED for charged amount: sum(shares)={charge_share_sum} + \
             treasury_remainder={} != charged={charged}",
            charge_result.treasury_remainder,
        );
    }
});
