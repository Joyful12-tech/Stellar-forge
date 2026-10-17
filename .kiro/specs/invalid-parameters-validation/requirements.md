# Invalid Parameters Validation

## Status

Implemented in `frontend/src/utils/validation.ts` (character policy block + exported constants).
Drift detection via `scripts/check-validation-drift.sh` (CI: `.github/workflows/ci.yml`).

## Character Policy

- **Names**: Block only dangerous/display-corrupting characters (control characters, zero-width, bidirectional overrides, BOM, unpaired surrogates). All other characters including non-Latin scripts are permitted, matching the contract's `validate_token_params` in `contracts/token-factory/src/lib.rs`.
- **Symbols**: ASCII alphanumeric + hyphens (ticker convention). This is a UI convention only; the contract accepts any symbol.

## Bounds (matching contract)

| Field    | Max | Unit        |
| -------- | --- | ----------- |
| name     | 32  | UTF-8 bytes |
| symbol   | 12  | UTF-8 bytes |
| decimals | 18  | integer     |

## See Also

- `contracts/token-factory/src/lib.rs`:749 — `validate_token_params`
- `frontend/src/utils/validation.ts` — `validateTokenParams`, exported constants
- `scripts/check-validation-drift.sh` — CI drift detection

# Invalid Parameters Validation Spec

## Status

**Shipped with Contract Divergences (Active Issue #1099)**

## Summary

Ensure rigorous parameter validation across Frontend, API, and Soroban Smart Contracts to prevent invalid token creation or parameter rejection.

## Current State & Shipped Code

- Frontend parameter validation implemented in `frontend/src/utils/validation.ts` and `frontend/src/components/CreateToken.tsx`.
- API payload schema validation implemented in `api/_lib/schemaValidation.ts`.
- Contract validation implemented in `contracts/token-factory/src/lib.rs`.

## Identified Divergences & Gaps

- Issue #1099 identifies divergence where frontend validation limits, regex patterns, or string length rules differ from the Soroban smart contract invariants.
- Frontend and backend validation bounds must strictly match contract bounds.

## Requirements

1. **Contract Parity**: Input validation rules in frontend/API must strictly mirror smart contract constraints.
2. **Immediate Feedback**: Display clear field-level error messages before submitting transactions.

## Related Issues

- Issue #1099: Frontend validation silently diverges from the contract in both directions
- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
