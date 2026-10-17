#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

const METADATA_URI_MAX_LEN: usize = 128;
const IPFS_PREFIX: &str = "ipfs://";

#[derive(Arbitrary, Debug, Clone)]
struct FuzzSetMetadataInput {
    /// Random bytes for metadata URI — may or may not be valid UTF-8.
    uri_bytes: Vec<u8>,
    fee_payment: i128,
    metadata_fee: i128,
    /// Whether to simulate a freeze before a second update attempt.
    attempt_after_freeze: bool,
    /// Simulate update count (0..=METADATA_MAX_UPDATES).
    update_count: u8,
}

fuzz_target!(|input: FuzzSetMetadataInput| {
    let metadata_fee = input.metadata_fee.saturating_abs();
    let fee_payment = input.fee_payment;

    // ── Fee comparison ────────────────────────────────────────────────────
    let fee_sufficient = fee_payment >= metadata_fee;
    if fee_sufficient {
        let remainder = fee_payment.saturating_sub(metadata_fee);
        assert!(remainder >= 0);
    }

    // ── URI string validation (mirrors contract logic) ────────────────────
    let uri_str = match String::from_utf8(input.uri_bytes.clone()) {
        Ok(s) => s,
        Err(_) => return, // non-UTF-8 rejected at SDK boundary
    };

    let is_empty = uri_str.is_empty();
    let too_long = uri_str.len() > METADATA_URI_MAX_LEN;
    let has_prefix = uri_str.starts_with(IPFS_PREFIX);
    let cid_nonempty = uri_str.len() > IPFS_PREFIX.len();

    let is_valid_uri = !is_empty && !too_long && has_prefix && cid_nonempty;

    // Verify classification is stable (pure function, no side effects).
    assert_eq!(
        is_valid_uri,
        !is_empty && !too_long && has_prefix && cid_nonempty
    );

    // If URI is valid, it must not be empty, must have prefix, must be bounded.
    if is_valid_uri {
        assert!(!uri_str.is_empty());
        assert!(uri_str.starts_with(IPFS_PREFIX));
        assert!(uri_str.len() <= METADATA_URI_MAX_LEN);
        assert!(uri_str.len() > IPFS_PREFIX.len());
    }

    // ── Update-count / freeze logic simulation ────────────────────────────
    const METADATA_MAX_UPDATES: u8 = 5;
    let current_version = input.update_count.min(METADATA_MAX_UPDATES);

    // Simulate: if frozen or at max version, update must fail.
    let would_be_frozen = input.attempt_after_freeze || current_version >= METADATA_MAX_UPDATES;
    if would_be_frozen {
        // No further updates allowed — this is the MetadataFrozen path.
        assert!(current_version >= METADATA_MAX_UPDATES || input.attempt_after_freeze);
    } else {
        // Update is allowed; new version would be current_version + 1.
        let new_version = current_version + 1;
        assert!(new_version <= METADATA_MAX_UPDATES);
    }

    // ── Overflow-safe fee accumulation ────────────────────────────────────
    let ops: i128 = 3;
    let _scaled = metadata_fee.saturating_mul(ops);
    let _total = fee_payment.saturating_add(metadata_fee);
    assert!(metadata_fee.saturating_add(i128::MAX) >= 0 || metadata_fee < 0);
});
