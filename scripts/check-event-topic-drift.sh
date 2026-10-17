#!/usr/bin/env bash
# check-event-topic-drift.sh
#
# CI guard: extract every event topic published by the Soroban contract
# (symbol_short! arguments used as the *action* in env.events().publish()
# calls) and compare them against the keys of CONTRACT_TOPIC_MAP in the
# frontend service.
#
# Exits 0 when both lists match; exits 1 and prints a diff otherwise.
#
# Usage (from repo root):
#   ./scripts/check-event-topic-drift.sh
set -euo pipefail

LIB_RS="contracts/token-factory/src/lib.rs"
STELLAR_IMPL="frontend/src/services/stellar-impl.ts"
EXIT_CODE=0

TMP_CONTRACT=$(mktemp)
TMP_FRONTEND=$(mktemp)

cleanup() {
  rm -f "$TMP_CONTRACT" "$TMP_FRONTEND"
}
trap cleanup EXIT

# ── Validate inputs ───────────────────────────────────────────────────────────

if [ ! -f "$LIB_RS" ]; then
  echo "::error::Cannot find contract source at $LIB_RS"
  exit 1
fi

if [ ! -f "$STELLAR_IMPL" ]; then
  echo "::error::Cannot find frontend service at $STELLAR_IMPL"
  exit 1
fi

echo ":: Checking event-topic drift between contract and frontend..."
echo "   Contract : $LIB_RS"
echo "   Frontend : $STELLAR_IMPL"
echo ""

# ── Extract contract event topics ─────────────────────────────────────────────
#
# The contract emits events like:
#   .publish((symbol_short!("factory"), symbol_short!("init")), ...);
#   env.events().publish(
#       (symbol_short!("factory"), symbol_short!("adm_upd")),
#       ...
#   );
#
# Strategy: for each line containing .publish(, read that line plus the next
# 2 lines (to handle multi-line calls).  On lines that have both "factory" and
# another symbol_short!, strip the factory occurrence then extract whatever
# symbol_short! remains.

grep -n '\.publish(' "$LIB_RS" | cut -d: -f1 | while IFS= read -r lineno; do
  sed -n "${lineno},$((lineno+2))p" "$LIB_RS"
done | \
  grep 'symbol_short!' | \
  sed 's/symbol_short!("factory")[^,]*,//' | \
  grep 'symbol_short!' | \
  sed 's/.*symbol_short!("\([^"]*\)").*/\1/' | \
  sort -u > "$TMP_CONTRACT"

if [ ! -s "$TMP_CONTRACT" ]; then
  echo "::error::Could not extract any event action topics from $LIB_RS"
  echo "         Looked for symbol_short! inside .publish() calls."
  exit 1
fi

echo "Contract event topics:"
sed 's/^/  /' "$TMP_CONTRACT"
echo ""

# ── Extract frontend topic keys ───────────────────────────────────────────────
#
# CONTRACT_TOPIC_MAP in stellar-impl.ts looks like:
#
#   export const CONTRACT_TOPIC_MAP: Record<string, ContractEventType> = {
#     init: 'init',
#     created: 'created',
#     ...
#     adm_upd: 'adm_upd',
#   } as const
#
# We isolate the block and extract the key names (left-hand side of each
# "key: 'value'" pair), stripping whitespace.

awk '/CONTRACT_TOPIC_MAP[^=]*=[^{]*\{/,/\} as const/' "$STELLAR_IMPL" | \
  grep ":" | \
  grep -v 'Record\|ContractEventType\|//' | \
  sed "s/[[:space:]]//g" | \
  sed "s/:.*$//" | \
  grep -v '^$' | \
  sort -u > "$TMP_FRONTEND"

if [ ! -s "$TMP_FRONTEND" ]; then
  echo "::error::Could not extract CONTRACT_TOPIC_MAP keys from $STELLAR_IMPL"
  echo "         Make sure CONTRACT_TOPIC_MAP is exported from that file."
  exit 1
fi

echo "Frontend CONTRACT_TOPIC_MAP keys:"
sed 's/^/  /' "$TMP_FRONTEND"
echo ""

# ── Diff ──────────────────────────────────────────────────────────────────────

ONLY_IN_CONTRACT=$(comm -23 "$TMP_CONTRACT" "$TMP_FRONTEND")
ONLY_IN_FRONTEND=$(comm -13 "$TMP_CONTRACT" "$TMP_FRONTEND")

if [ -n "$ONLY_IN_CONTRACT" ]; then
  echo "::error::Topics emitted by contract but MISSING from frontend CONTRACT_TOPIC_MAP:"
  echo "$ONLY_IN_CONTRACT" | sed 's/^/  missing: /'
  echo ""
  EXIT_CODE=1
fi

if [ -n "$ONLY_IN_FRONTEND" ]; then
  echo "::warning::Topics in frontend CONTRACT_TOPIC_MAP not found in contract:"
  echo "$ONLY_IN_FRONTEND" | sed 's/^/  extra:   /'
  echo ""
  EXIT_CODE=1
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "All contract event topics match CONTRACT_TOPIC_MAP — no drift detected."
else
  echo ""
  echo "Fix: update CONTRACT_TOPIC_MAP in $STELLAR_IMPL so its keys"
  echo "match the symbol_short! action topics emitted by $LIB_RS."
  echo ""
  echo "Then re-run the regression tests:"
  echo "  cd frontend && npx vitest run src/services/stellar-impl.test.ts"
fi

exit $EXIT_CODE
