#!/usr/bin/env bash
# ── Validation drift check ──────────────────────────────────────────────
#
# Verifies that the numeric bounds in the frontend's validation.ts match
# the corresponding literals in the contract's validate_token_params.
# If they drift apart, the frontend may accept input the contract rejects
# (or vice versa), causing users to pay for failed transactions.
#
# Usage: scripts/check-validation-drift.sh
# Exit code: 0 = all bounds match, 1 = mismatch found
#
# Called from CI (see .github/workflows/ci.yml or similar).
# ────────────────────────────────────────────────────────────────────────

set -euo pipefail

LIB_RS="contracts/token-factory/src/lib.rs"
VALIDATION_TS="frontend/src/utils/validation.ts"
EXIT_CODE=0

echo ":: Checking frontend/contract validation bounds drift..."

# ── Extract contract bounds from lib.rs ────────────────────────────────
#
# validate_token_params enforces:
#   name.len() > 32    → InvalidTokenParams
#   symbol.len() > 12  → InvalidTokenParams
#   decimals > 18      → InvalidDecimals

CONTRACT_NAME_MAX=$(sed -n 's/.*name\.len() > \([0-9][0-9]*\).*/\1/p' "$LIB_RS" | head -1)
CONTRACT_SYMBOL_MAX=$(sed -n 's/.*symbol\.len() > \([0-9][0-9]*\).*/\1/p' "$LIB_RS" | head -1)
CONTRACT_DECIMALS_MAX=$(sed -n 's/.*decimals > \([0-9][0-9]*\).*/\1/p' "$LIB_RS" | head -1)

if [ -z "$CONTRACT_NAME_MAX" ] || [ -z "$CONTRACT_SYMBOL_MAX" ] || [ -z "$CONTRACT_DECIMALS_MAX" ]; then
  echo "::error::Could not extract all contract bounds from $LIB_RS"
  echo "  name.max=$CONTRACT_NAME_MAX  symbol.max=$CONTRACT_SYMBOL_MAX  decimals.max=$CONTRACT_DECIMALS_MAX"
  exit 1
fi

echo ":: Contract bounds:  name ≤ ${CONTRACT_NAME_MAX}B  symbol ≤ ${CONTRACT_SYMBOL_MAX}B  decimals ≤ ${CONTRACT_DECIMALS_MAX}"

# ── Extract frontend bounds from validation.ts ─────────────────────────
#
# Exported constants:
#   export const TOKEN_NAME_MAX_BYTES = 32
#   export const TOKEN_SYMBOL_MAX_BYTES = 12
#   export const TOKEN_DECIMALS_MAX_VALUE = 18

FE_NAME_MAX=$(sed -n 's/.*TOKEN_NAME_MAX_BYTES *= *\([0-9][0-9]*\).*/\1/p' "$VALIDATION_TS" | head -1)
FE_SYMBOL_MAX=$(sed -n 's/.*TOKEN_SYMBOL_MAX_BYTES *= *\([0-9][0-9]*\).*/\1/p' "$VALIDATION_TS" | head -1)
FE_DECIMALS_MAX=$(sed -n 's/.*TOKEN_DECIMALS_MAX_VALUE *= *\([0-9][0-9]*\).*/\1/p' "$VALIDATION_TS" | head -1)

if [ -z "$FE_NAME_MAX" ] || [ -z "$FE_SYMBOL_MAX" ] || [ -z "$FE_DECIMALS_MAX" ]; then
  echo "::error::Could not extract all frontend bounds from $VALIDATION_TS"
  echo "  name.max=$FE_NAME_MAX  symbol.max=$FE_SYMBOL_MAX  decimals.max=$FE_DECIMALS_MAX"
  exit 1
fi

echo ":: Frontend bounds: name ≤ ${FE_NAME_MAX}B  symbol ≤ ${FE_SYMBOL_MAX}B  decimals ≤ ${FE_DECIMALS_MAX}"

# ── Compare ────────────────────────────────────────────────────────────

MISMATCH=""

if [ "$FE_NAME_MAX" != "$CONTRACT_NAME_MAX" ]; then
  MISMATCH="${MISMATCH}  - TOKEN_NAME_MAX_BYTES ($FE_NAME_MAX) != contract name.len() > $CONTRACT_NAME_MAX\n"
  EXIT_CODE=1
fi

if [ "$FE_SYMBOL_MAX" != "$CONTRACT_SYMBOL_MAX" ]; then
  MISMATCH="${MISMATCH}  - TOKEN_SYMBOL_MAX_BYTES ($FE_SYMBOL_MAX) != contract symbol.len() > $CONTRACT_SYMBOL_MAX\n"
  EXIT_CODE=1
fi

if [ "$FE_DECIMALS_MAX" != "$CONTRACT_DECIMALS_MAX" ]; then
  MISMATCH="${MISMATCH}  - TOKEN_DECIMALS_MAX_VALUE ($FE_DECIMALS_MAX) != contract decimals > $CONTRACT_DECIMALS_MAX\n"
  EXIT_CODE=1
fi

if [ "$EXIT_CODE" -ne 0 ]; then
  echo ""
  echo "::error::Validation bounds drift detected!"
  echo -e "$MISMATCH"
  echo ""
  echo "The frontend validation constants in $VALIDATION_TS must match the"
  echo "contract's validate_token_params in $LIB_RS.  Update the constants"
  echo "in validation.ts to match the contract, or update the contract if"
  echo "the frontend's bound is the intended one."
  exit "$EXIT_CODE"
fi

echo ":: All validation bounds match between frontend and contract."