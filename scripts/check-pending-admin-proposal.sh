#!/usr/bin/env bash
# check-pending-admin-proposal.sh
#
# Alert on an admin rotation that was started and never finished.
#
# `propose_admin` (and the deprecated `transfer_admin` / `update_admin`
# aliases, which delegate to it) only *records* a successor. The rotation takes
# effect when the proposed admin calls `accept_admin`, and the proposal lapses
# after ADMIN_PROPOSAL_TTL_LEDGERS (17,280 ledgers ~= 28.8 hours). A proposal
# left pending is a live hazard: if the outgoing key is decommissioned in the
# belief that the rotation completed, expiry leaves the factory permanently
# stuck under a key that no longer exists (issue #1159).
#
# Run it on a cron schedule (every 15 minutes is ample) and route non-zero
# exits to the same alert channel as check-wasm-hash.sh.
#
# Usage:
#   FACTORY_CONTRACT_ID=C... STELLAR_NETWORK=mainnet ./scripts/check-pending-admin-proposal.sh
#
# Environment:
#   FACTORY_CONTRACT_ID  (required) factory contract ID
#   STELLAR_NETWORK      network name for the stellar CLI      (default: mainnet)
#   SOROBAN_RPC_URL      RPC endpoint used to read the current ledger
#                        (default: derived from STELLAR_NETWORK)
#   WARN_AFTER_HOURS     age at which a pending proposal warns (default: 6)
#   PAGE_AFTER_HOURS     age at which a pending proposal pages (default: 12)
#
# Exit codes:
#   0  no proposal pending, or pending and younger than WARN_AFTER_HOURS
#   1  pending longer than WARN_AFTER_HOURS  (warn)
#   2  pending longer than PAGE_AFTER_HOURS  (page)
#   3  proposal has already expired — the rotation must be restarted from the
#      CURRENT admin key, which must therefore still exist
#   4  the check could not be completed (bad config, RPC failure)
set -euo pipefail

# Keep these in step with contracts/token-factory/src/lib.rs.
TTL_LEDGERS=17280
SECONDS_PER_LEDGER=6

FACTORY_CONTRACT_ID="${FACTORY_CONTRACT_ID:-}"
STELLAR_NETWORK="${STELLAR_NETWORK:-mainnet}"
WARN_AFTER_HOURS="${WARN_AFTER_HOURS:-6}"
PAGE_AFTER_HOURS="${PAGE_AFTER_HOURS:-12}"

case "$STELLAR_NETWORK" in
  mainnet) DEFAULT_RPC="https://soroban-mainnet.stellar.org" ;;
  testnet) DEFAULT_RPC="https://soroban-testnet.stellar.org" ;;
  *)       DEFAULT_RPC="" ;;
esac
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-$DEFAULT_RPC}"

fail() { echo "::error::$*" >&2; exit 4; }

[ -n "$FACTORY_CONTRACT_ID" ] || fail "FACTORY_CONTRACT_ID is not set."
[ -n "$SOROBAN_RPC_URL" ] || fail "SOROBAN_RPC_URL is not set and STELLAR_NETWORK='$STELLAR_NETWORK' has no default."
for cmd in stellar jq curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' is not installed or not in PATH."
done

# ── Read the factory's rotation state ────────────────────────────────────────

STATE=$(stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_state 2>/dev/null) || fail "get_state failed for $FACTORY_CONTRACT_ID on $STELLAR_NETWORK."

PENDING_ADMIN=$(echo "$STATE" | jq -r '.pending_admin // empty')
CURRENT_ADMIN=$(echo "$STATE" | jq -r '.admin // empty')
EXPIRY_LEDGER=$(echo "$STATE" | jq -r '.pending_admin_expiry // empty')

if [ -z "$PENDING_ADMIN" ]; then
  echo "OK: no pending admin proposal on $FACTORY_CONTRACT_ID (admin: ${CURRENT_ADMIN:-unknown})."
  exit 0
fi

[ -n "$EXPIRY_LEDGER" ] || fail "pending_admin is set but pending_admin_expiry is missing — inspect state manually."

# ── Read the current ledger ──────────────────────────────────────────────────

CURRENT_LEDGER=$(curl -sS -X POST "$SOROBAN_RPC_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
  | jq -r '.result.sequence // empty') || fail "Could not reach $SOROBAN_RPC_URL."
[ -n "$CURRENT_LEDGER" ] || fail "getLatestLedger returned no sequence from $SOROBAN_RPC_URL."

# ── Age the proposal ─────────────────────────────────────────────────────────
#
# The contract stores only the expiry, so the proposal ledger is recovered as
# expiry - TTL. Age and remaining time are reported in hours at the nominal
# ~6s ledger close time; treat them as close estimates, not exact clocks.

PROPOSED_AT=$((EXPIRY_LEDGER - TTL_LEDGERS))
AGE_LEDGERS=$((CURRENT_LEDGER - PROPOSED_AT))
AGE_HOURS=$(( (AGE_LEDGERS * SECONDS_PER_LEDGER) / 3600 ))
REMAINING_LEDGERS=$((EXPIRY_LEDGER - CURRENT_LEDGER))
REMAINING_HOURS=$(( (REMAINING_LEDGERS * SECONDS_PER_LEDGER) / 3600 ))

echo "Pending admin proposal on $FACTORY_CONTRACT_ID"
echo "  current admin : ${CURRENT_ADMIN:-unknown}"
echo "  proposed admin: $PENDING_ADMIN"
echo "  proposed at   : ledger $PROPOSED_AT (~${AGE_HOURS}h ago)"
echo "  expires at    : ledger $EXPIRY_LEDGER (~${REMAINING_HOURS}h from now)"
echo ""

if [ "$REMAINING_LEDGERS" -le 0 ]; then
  cat >&2 <<MSG
::error::EXPIRED admin proposal — the rotation to $PENDING_ADMIN can no longer be accepted.
         The factory is still administered by ${CURRENT_ADMIN:-the current admin}.
         Restart the rotation with propose_admin from THAT key (it must still exist),
         then have $PENDING_ADMIN call accept_admin. Clear the dead entry with
         cancel_admin_proposal.
MSG
  exit 3
fi

if [ "$AGE_HOURS" -ge "$PAGE_AFTER_HOURS" ]; then
  cat >&2 <<MSG
::error::Admin proposal pending for ~${AGE_HOURS}h (page threshold: ${PAGE_AFTER_HOURS}h),
         ~${REMAINING_HOURS}h before it expires.
         If expected: get accept_admin signed by $PENDING_ADMIN now.
         If unexpected: call cancel_admin_proposal from ${CURRENT_ADMIN:-the current admin}
         and treat the admin key as compromised.
         Do NOT decommission the current admin key until get_state() shows
         admin = $PENDING_ADMIN and pending_admin = null.
MSG
  exit 2
fi

if [ "$AGE_HOURS" -ge "$WARN_AFTER_HOURS" ]; then
  echo "::warning::Admin proposal pending for ~${AGE_HOURS}h (warn threshold: ${WARN_AFTER_HOURS}h), ~${REMAINING_HOURS}h before it expires. Confirm $PENDING_ADMIN is ready to call accept_admin." >&2
  exit 1
fi

echo "OK: proposal is ~${AGE_HOURS}h old, within the ${WARN_AFTER_HOURS}h warn threshold."
exit 0
