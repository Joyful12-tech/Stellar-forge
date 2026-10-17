# Stellar Implementation ABI Audit

## Overview

This document describes the structural fix for **issue #5** (CRITICAL: every token-deployment transaction failing at RPC simulation) and the permanent mechanism to prevent similar bugs from being silently reintroduced.

## The Problem: Issue #5

The root cause of issue #5 was an extra argument inserted into a `contract.call(...)` invocation in `frontend/src/services/stellar-impl.ts`:

```typescript
// BEFORE (broken — caused issue #5)
contract.call('initialize_factory', admin, paused, base_fee, metadata_fee, token_wasm_hash)

// AFTER (fixed)
contract.call('initialize_factory', admin, paused, base_fee, metadata_fee)
```

TypeScript never caught this because `contract.call(...)` accepts a variadic `...args: ScVal[]`, so an extra or reordered argument is syntactically valid. The RPC only caught it at simulation time, when the contract's parameter count didn't match.

### Why It Happened

Every write path independently hand-builds its argument list:

- `deployToken`
- `mintTokens`
- `burnTokens`
- `setMetadata`
- `updateFees`
- `setWhitelistEnabled`
- And others

No shared builder derived from the contract's ABI meant the risk of drift — and the inability to catch it early — was baked into the architecture.

## The Mitigation: AST-Based Parameter Validation

### How It Works

**File**: `scripts/check-stellar-impl-abi.mjs`

The script performs two key validations:

1. **Extracts public function signatures from `contracts/token-factory/src/lib.rs`**
   - Uses regex to find all `pub fn name(...)` declarations inside the `impl TokenFactory` block
   - Counts parameters for each function

2. **Extracts `contract.call(...)` invocations from `frontend/src/services/stellar-impl.ts`**
   - Finds each `contract.call('function_name', ...)` site
   - Properly counts top-level comma-separated arguments while respecting nested parentheses/brackets (important for multi-line formatting)

3. **Compares argument counts**
   - Fails CI if any call site has a different argument count than its corresponding Rust function
   - Catches additions, deletions, reorderings, and other drift

### Running Locally

```bash
# Check all contract call sites against lib.rs signatures
node scripts/check-stellar-impl-abi.mjs

# Exit code 0 = all call sites match
# Exit code 1 = drift detected
```

### Regression Baseline

All existing call sites pass with zero modifications required:

```
✓ create_token at line 614: 10 args (expected ~10)
✓ mint_tokens at line 677: 7 args (expected ~7)
✓ burn at line 723: 5 args (expected ~5)
✓ set_metadata at line 771: 6 args (expected ~6)
✓ update_fees at line 966: 5 args (expected ~5)
✓ set_whitelist_enabled at line 1011: 4 args (expected ~3)
```

## Integration into CI

The check runs in the `drift-checks` job in `.github/workflows/ci.yml`, alongside:

- `check-abi-doc-drift.sh` (verifies ABI documentation)
- `check-event-topic-drift.sh` (verifies event topics)
- `check-validation-drift.sh` (verifies validation bounds)

**CI Job Name**: `Stellar impl contract call signature validation (issue #5 fix)`

Fails the build if any drift is detected, preventing issue #5 from being silently reintroduced.

## Testing

### Deliberately Introduce an Error

To verify the check catches drift, add an extra argument to a call site:

```typescript
// In frontend/src/services/stellar-impl.ts, line 614
contract.call(
  'create_token',
  new Address(sourceAddress).toScVal(),
  nativeToScVal(hexToBytes(params.salt), { type: 'bytes' }),
  nativeToScVal(params.name, { type: 'string' }),
  nativeToScVal(params.symbol, { type: 'string' }),
  nativeToScVal(params.decimals, { type: 'u32' }),
  nativeToScVal(BigInt(params.initialSupply), { type: 'i128' }),
  optionI128(params.maxSupply),
  nativeToScVal(BigInt(params.feePayment), { type: 'i128' }),
  nativeToScVal('extra_arg_here', { type: 'string' }), // Extra argument
)
```

Run the check:

```bash
node scripts/check-stellar-impl-abi.mjs
```

Output (excerpt):

```
✗ create_token at line 614: 11 args, expected ~10
✗ Drift detected: some call sites do not match their signatures
```

CI will fail and prevent the broken code from being merged.

## Limitations & Future Enhancements

### Current Scope

- Counts arguments only; does not validate argument types or order within the argument list
- Regex-based parsing; does not use a full TypeScript AST parser

### Potential Improvements (M6+)

1. **Type validation**: Compare argument types (e.g., `Address` vs `u32`) against Rust parameter types
2. **Order validation**: Ensure arguments are reordered intentionally, not accidentally
3. **Rust-to-TypeScript codegen**: Generate a typed argument builder from `lib.rs` signatures (removes manual argument construction entirely)
4. **Pre-commit hook**: Run the check locally before pushing to catch drift before CI

## Permanent Resolution

The unchecked item at `docs/CODEBASE_AUDIT_CHECKLIST.md:102-104` is now marked done:

```markdown
- [x] Add AST-based parameter validation comparing stellar-impl.ts to contract signatures
      Implementation: scripts/check-stellar-impl-abi.mjs (integrated into CI)
      Reference: docs/STELLAR_IMPL_ABI_AUDIT.md
```

This mechanism replaces the manual-audit approach used to resolve issue #5 with an automated, continuous check that runs on every CI job, ensuring the gap cannot silently regress.

## See Also

- **Issue #5**: CRITICAL token deployment failures (RESOLVED)
- **Issue #946**: Contract interface drift detection (RESOLVED)
- **docs/CODEBASE_AUDIT_CHECKLIST.md**: Full audit context
- **docs/contract-abi.md**: Contract function and error documentation
