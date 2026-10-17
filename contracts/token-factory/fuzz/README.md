# Contract Fuzz Testing

This directory contains fuzz testing targets for the token factory contract using `libfuzzer` and the `arbitrary` crate. The fuzz targets are designed to test critical contract logic with randomly generated inputs to uncover edge cases and potential panics.

## Overview

Fuzz testing generates random inputs to discover edge cases and potential crashes in arithmetic and validation logic. The fuzz targets focus on five critical areas:

1. **create_token**: UTF-8 string validation, name/symbol/decimals parsing, fee arithmetic with random inputs
2. **fee_arithmetic**: Integer overflow checking in fee calculations, saturation arithmetic, boundary conditions
3. **burn**: Burn amount arithmetic, balance invariants, total supply calculations with random amounts
4. **set_metadata**: Metadata URI string handling, fee comparison arithmetic, duplicate-set guard
5. **mint_tokens**: Amount validation, max-supply cap overflow (`checked_add`), fee distribution arithmetic

## Setup

### Prerequisites

- Rust toolchain (latest stable)
- `cargo-fuzz` (optional, for full libfuzzer integration):
  ```bash
  cargo install cargo-fuzz
  ```

### Building Fuzz Targets

```bash
cd contracts/token-factory/fuzz
cargo build --release
```

## Running Fuzz Tests

### Using cargo-fuzz

```bash
cd contracts/token-factory/fuzz
cargo fuzz run fuzz_create_token
```

### Using cargo directly

```bash
cd contracts/token-factory/fuzz
cargo +nightly run --release --bin fuzz_create_token
```

### Run with time and input limits

```bash
cargo +nightly run --release --bin fuzz_create_token -- -max_len=10000 -timeout=60
```

## Fuzz Targets

### fuzz_create_token

**Focus**: Input validation and string creation with random data

**Tests**:

- UTF-8 validation of random byte sequences
- String creation with various name/symbol values
- Decimals clamping (0-255)
- Saturation arithmetic on supply and fee values
- No panics on any valid input combination

**Success Criteria**: No panics on valid inputs; all assertions pass

**File**: `fuzz_targets/fuzz_create_token.rs`

### fuzz_fee_arithmetic

**Focus**: Fee calculation logic and overflow checking

**Tests**:

- Saturation arithmetic properties
- Base fee and metadata fee combinations
- Fee multiplication with operation counts
- Monotonic increase property (fees never decrease)
- No signed integer overflow

**Success Criteria**:

- No integer overflow panics
- All saturation operations complete safely
- Arithmetic properties maintained

**File**: `fuzz_targets/fuzz_fee_arithmetic.rs`

### fuzz_burn

**Focus**: The real `TokenFactory::burn` entrypoint, driven through a live `soroban_sdk::testutils` `Env`

**Real vs. oracle**: This target calls the actual `burn` entrypoint via the generated `TokenFactoryClient` (through the `token-factory-testutils-lib` crate in `../testutils-lib`, which compiles this contract's own `src/lib.rs` as an ordinary `rlib` — see that crate's `Cargo.toml` for why it's a separate crate rather than adding `rlib` to the contract's own `crate-type`). The only bypass is token _registration_: no real token WASM is available to install at a `token_wasm_hash` in a native test/fuzz environment, so a real Stellar Asset Contract stands in for the deployed token and `TokenFactory::fuzz_seed_token` (`#[cfg(feature = "testutils")]`-only, not a contract entrypoint — see `docs/contract-abi.md`) records it in factory storage exactly as `create_token` would have. Everything downstream — auth, the `TokenNotFound`/`Unauthorized`/`InvalidBurnAmount`/`BurnAmountExceedsBalance` gates, the reentrancy lock, and the actual cross-contract `token::burn` call — runs as real contract code, with pass/fail judged against an independently-computed oracle (expected balance delta, expected error per fault class) rather than a reimplementation of the contract's own logic.

**Tests**:

- Every returned `Result` variant (`Ok`, each `Error` fault class, host-level errors) matches the oracle's expectation for the given `(initial_balance, burn_amount, burn_enabled)` input
- Balance decreases by exactly the burned amount on success
- No unexpected error variant is ever returned (a deliberately-introduced regression — e.g. weakening the `amount > balance` check — is caught this way: the underlying token rejects the resulting over-balance burn and the target panics on the unexpected result)

**File**: `fuzz_targets/fuzz_burn.rs`

### fuzz_set_metadata

**Focus**: Metadata URI string handling and fee arithmetic for `set_metadata`

**Tests**:

- Arbitrary byte sequences converted to UTF-8 metadata URIs (no length limit in contract)
- Fee sufficiency guard: `fee_payment >= metadata_fee`
- Fee remainder arithmetic after payment
- Duplicate-set guard simulation (idempotency path skips arithmetic)
- Saturating fee-accumulation operations matching `distribute_fee`

**Success Criteria**:

- No panics on any valid UTF-8 URI or fee combination
- Non-UTF-8 inputs handled without panic
- All arithmetic invariants maintained

**File**: `fuzz_targets/fuzz_set_metadata.rs`

### fuzz_mint_tokens

**Focus**: Amount validation, max-supply cap enforcement, and fee distribution for `mint_tokens`

**Tests**:

- Non-positive amount rejection (`amount <= 0`)
- Fee sufficiency guard: `fee_payment >= base_fee`
- `checked_add` overflow on `current_supply + amount` (maps to `ArithmeticOverflow` error)
- Max-supply cap enforcement: `new_total > cap` (maps to `MaxSupplyExceeded` error)
- Supply monotonicity: minting always increases total supply
- Fee split distribution arithmetic (two-recipient model)

**Success Criteria**:

- No panics on any `i128` amount or supply combination
- Overflow paths detected via `checked_add`, not via panic
- Supply invariants (`new_total <= cap`) maintained on success path

**File**: `fuzz_targets/fuzz_mint_tokens.rs`

## CI Integration

Fuzz tests are automatically run by GitHub Actions in two separate jobs:

### PR Smoke (`smoke`)

- **Trigger**: Pull requests modifying contract code
- **Duration**: 12 seconds per target
- **Behaviour**: Hard failure — any crash fails the PR check. This is a required status check on protected branches.
- **Corpus**: Starts from committed `corpus/` seeds and the cached runtime corpus, but does not save back (ephemeral PR branches do not pollute the shared corpus).
- **Artifacts**: Crash artifacts uploaded on failure (7-day retention).

### Scheduled Full Fuzz (`fuzz`)

- **Trigger**: Daily at 2 AM UTC (also manually via `workflow_dispatch`)
- **Duration**: 60 seconds per target
- **Behaviour**: Hard failure — any crash fails the workflow. Runs a thorough sweep to catch edge cases that the smoke test may miss.
- **Corpus**: Starts from committed seeds and cached corpus, saves newly-discovered inputs back to the cache so coverage accumulates across runs.
- **Artifacts**: Crash artifacts uploaded on failure (7-day retention).

See `.github/workflows/fuzz-testing.yml` for the workflow configuration.

## Interpreting Results

### Successful Run

```
...
artifact summary: 0 new, 0 unique
```

No artifacts = no crashes found ✓

### Crash Found

A crash will be saved to the work directory. The file contains the input that triggered the crash.

### Crash-to-Regression-Test Process

When a fuzz target discovers a crash, follow this process to convert it into a permanent regression guard. **This is mandatory** — a crash that is fixed but never enshrined as a test will not protect against regressions once the 7-day CI artifact retention expires.

#### Step 1: Reproduce locally

```bash
cd contracts/token-factory/fuzz
cargo +nightly run --release --bin <fuzz_target> -- \
  -max_len=10000 \
  artifacts/<fuzz_target>/<crash-file>
```

Confirm the crash reproduces deterministically with the saved input.

#### Step 2: Minimise the crashing input

Use `cargo-fuzz`'s `tmin` to produce the smallest input that still triggers the crash:

```bash
cargo fuzz tmin <fuzz_target> artifacts/<fuzz_target>/<crash-file>
```

This writes the minimised input to stdout (or a file). A smaller input makes the root cause easier to reason about and keeps the test suite fast.

#### Step 3: Convert into a `#[test]` regression test

Add a regression test to `contracts/token-factory/src/test.rs` that:

- Replicates the exact input/state that triggered the crash.
- Asserts the **fixed** behaviour (e.g., the contract returns a specific error instead of panicking).
- Includes a doc comment referencing the fuzz target that discovered it and the original crash file name.

**Example** (initial_supply overflow discovered by `fuzz_create_token`):

```rust
/// Regression test for initial_supply overflow when casting u128 → i128.
/// Discovered via fuzz_targets::fuzz_create_token.
#[test]
fn test_create_token_initial_supply_exceeds_i128_max() {
    // ... setup ...
    let overflow_supply = (i128::MAX as u128).checked_add(1).unwrap();
    let result = s.client.try_create_token(
        &creator, &s.salt(0),
        &name, &symbol, &7, &overflow_supply, &1_000,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));
}
```

#### Step 4: Commit the minimised input as a corpus seed

Copy the minimised crash input into the checked-in corpus so the fuzzer starts with it on every run:

```bash
cp artifacts/<fuzz_target>/<minimised-file> corpus/<fuzz_target>/regression_<description>.bin
git add corpus/
```

Alternatively, use the seed generation script:

```bash
node scripts/generate_seeds.mjs
```

#### Step 5: Verify

1. `cargo test` passes (the regression test succeeds).
2. The fuzz target no longer crashes on the original input.
3. Commit the test, the corpus seed, and the fix together.

**Real example**: This process was applied to the `initial_supply` overflow bug discovered by `fuzz_create_token`. See:

- Fix: `create_token_inner` overflow guard in `contracts/token-factory/src/lib.rs`
- Regression test: `test_create_token_initial_supply_exceeds_i128_max` in `contracts/token-factory/src/test.rs`
- Corpus seed: `corpus/fuzz_create_token/initial_supply_i128_max.bin`

## Corpus Seeds

The `corpus/` directory contains checked-in seed inputs organised per fuzz target. These seeds give the fuzzer a head start by pre-populating it with known edge cases (boundary values, overflow scenarios, etc.) rather than starting from scratch every run.

To add new seeds:

```bash
# Automatically from the seed definitions:
node scripts/generate_seeds.mjs

# Or manually: place any interesting binary input in the target's corpus directory
cp my_edge_case.bin corpus/fuzz_create_token/
```

## Known Limitations

1. **Simplified Targets**: Fuzz targets focus on pure Rust logic, not full contract interaction
2. **No WASM Execution**: Contract WASM execution is tested separately via integration tests
3. **Mock Environment**: Contract setup uses mocked Soroban environment
4. **No real reentrancy coverage here**: The fuzz targets exercise fee/arithmetic logic in isolation, and the majority of the `test.rs` reentrancy tests simulate a mid-execution state by injecting `locked = true` directly into storage. Those tests prove the guard _rejects when already locked_, not that the lock is acquired _before_ the vulnerable external call. Real reentrancy — a genuine nested cross-contract call that re-enters the factory — is covered end-to-end by `test_mint_tokens_rejects_real_reentrant_call` in `contracts/token-factory/src/test.rs`, which deploys the factory with a malicious SEP-41 fee-token contract (`ReentrantToken`) whose `transfer` calls back into the factory. A separate malicious WASM is not compiled for the in-process harness; see that test for the rationale and the mechanism.

## Future Improvements

- [ ] Integration with continuous fuzzing service (OSS-Fuzz)
- [ ] More comprehensive contract interaction fuzzing
- [ ] Generational corpus for improved coverage
- [ ] Cross-contract fuzz testing
- [ ] Memory safety checking with sanitizers

## Resources

- [libfuzzer Documentation](https://llvm.org/docs/LibFuzzer/)
- [arbitrary Crate](https://docs.rs/arbitrary/)
- [cargo-fuzz Book](https://rust-fuzz.github.io/book/cargo-fuzz.html)
- [Fuzzing Rust Code](https://rust-lang.github.io/rustlings/fuzzing/)
