#!/usr/bin/env bash
set -euo pipefail

LIB_RS="contracts/token-factory/src/lib.rs"
ABI_MD="docs/contract-abi.md"
STELLAR_IMPL="frontend/src/services/stellar-impl.ts"
EXIT_CODE=0
TMP=$(mktemp)
TMP_CALLS=$(mktemp)

cleanup() { rm -f "$TMP" "$TMP_CALLS"; }
trap cleanup EXIT

echo ":: Checking contract ABI documentation drift..."

awk '/impl TokenFactory/,/^}/' "$LIB_RS" | grep -oP 'pub fn \K\w+' > "$TMP"

if [ ! -s "$TMP" ]; then
  echo "::error::Could not extract public functions from $LIB_RS"
  exit 1
fi

echo ":: Found public functions in lib.rs:"
cat "$TMP"

MISSING=""
while IFS= read -r fn_name; do
  if ! grep -q "$fn_name" "$ABI_MD"; then
    MISSING="$MISSING  - $fn_name\n"
    EXIT_CODE=1
  fi
done < "$TMP"

ERROR_VARIANTS=$(awk '/enum Error \{/,/\}/' "$LIB_RS" | grep -oP '^\s+\w+' | tr -d ' ')

echo ""
echo ":: Checking Error enum variants in ABI doc..."
for variant in $ERROR_VARIANTS; do
  if ! grep -q "$variant" "$ABI_MD"; then
    MISSING="$MISSING  - Error::$variant\n"
    EXIT_CODE=1
  fi
done

# Extract contract.call invocations and check against contract signature documentation
echo ""
echo ":: Checking contract.call(...) sites in stellar-impl.ts..."
if [ -f "$STELLAR_IMPL" ]; then
  # Extract function names from contract.call invocations. Only string
  # literals name a contract function — calls like contract.call(method, ...)
  # forward a caller-supplied name and are checked at their own call sites.
  # The literal may sit on the same line or (prettier-wrapped) the next line.
  {
    grep -oP "contract\.call\(\s*['\"]\K\w+" "$STELLAR_IMPL" || true
    grep -A1 "contract\.call($" "$STELLAR_IMPL" | grep -oP "^\s*['\"]\K\w+" || true
  } | sort -u > "$TMP_CALLS"
  
  if [ -s "$TMP_CALLS" ]; then
    echo ":: Found contract.call invocations:"
    sort -u "$TMP_CALLS"
    
    # Verify each call exists in lib.rs
    while IFS= read -r fn_name; do
      if ! grep -q "pub fn $fn_name" "$LIB_RS"; then
        MISSING="$MISSING  - contract.call('$fn_name') does not match any public function in $LIB_RS\n"
        EXIT_CODE=1
      fi
      
      # Check if documented in ABI
      if ! grep -q "\`$fn_name\`" "$ABI_MD"; then
        echo "::warning::contract.call('$fn_name') is not documented in $ABI_MD"
      fi
    done < "$TMP_CALLS"
  fi
else
  echo "::warning::$STELLAR_IMPL not found, skipping contract.call validation"
fi

if [ -n "$MISSING" ]; then
  echo ""
  echo "::error::Missing or mismatched entries:"
  echo -e "$MISSING"
  echo ""
  echo "Please verify contract function signatures in $LIB_RS and update call sites in $STELLAR_IMPL"
else
  echo ""
  echo ":: All public functions, error variants, and contract calls are consistent"
fi

exit $EXIT_CODE
