#!/usr/bin/env bash
set -euo pipefail

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $0 [options]

End-to-end validation for issue #246 (Ephemeral Testnet Provisioning via CRD).

Provisions an ephemeral single-node Stellar network from a StellarTestnet
manifest, waits for the Soroban RPC endpoint to become Ready and funded
within a time budget (default 30s), deploys the token-factory smart contract
against the generated endpoint, invokes it, then deletes the manifest and
verifies complete garbage collection.

Options:
  -n, --namespace <ns>    Namespace for the testnet (default: stellar-ci)
  -m, --manifest <path>   StellarTestnet manifest
                          (default: controller/examples/stellartestnet.yaml)
  -t, --timeout <secs>    Budget for Ready in seconds (default: 30)
  -k, --keep              Keep the testnet after a successful run
  -h, --help              Show this help

Prerequisites:
  kubectl, curl, stellar CLI, and cargo (to build contracts/token-factory
  if its wasm artifact is not already present).

Examples:
  $0
  $0 --namespace ci-1234 --timeout 45 --keep
EOF
  exit 1
}

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()  { printf '[testnet-e2e] %s\n' "$*"; }
fail() { printf '[testnet-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Parse arguments ─────────────────────────────────────────────────────────
NAMESPACE="stellar-ci"
MANIFEST="$REPO_ROOT/controller/examples/stellartestnet.yaml"
TIMEOUT=30
KEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2";  shift 2 ;;
    -m|--manifest)  MANIFEST="$2";   shift 2 ;;
    -t|--timeout)   TIMEOUT="$2";    shift 2 ;;
    -k|--keep)      KEEP=true;       shift ;;
    -h|--help)      usage ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

CRD_MANIFEST="$REPO_ROOT/controller/deploy/stellartestnets.yaml"
WASM="${WASM:-$REPO_ROOT/contracts/target/wasm32v1-none/release/token_factory.wasm}"

# ─── Preconditions ───────────────────────────────────────────────────────────
require kubectl
require curl
require stellar
[[ -f "$MANIFEST" ]]    || fail "manifest not found: $MANIFEST"
[[ -f "$CRD_MANIFEST" ]] || fail "CRD manifest not found: $CRD_MANIFEST"

# ─── Install the CRD ─────────────────────────────────────────────────────────
log "installing StellarTestnet CRD"
kubectl apply -f "$CRD_MANIFEST" >/dev/null
kubectl wait --for=condition=Established "crd/stellartestnets.stellar.forge.dev" \
  --timeout=30s >/dev/null

# ─── Provision ───────────────────────────────────────────────────────────────
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 \
  || kubectl create namespace "$NAMESPACE" >/dev/null

log "applying $MANIFEST in namespace $NAMESPACE"
apply_start=$SECONDS
kubectl apply -f "$MANIFEST" -n "$NAMESPACE" >/dev/null

NAME="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" -o jsonpath='{.metadata.name}')"
log "waiting up to ${TIMEOUT}s for StellarTestnet/$NAME to become Ready"

phase=""
while (( SECONDS - apply_start < TIMEOUT )); do
  phase="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" \
    -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  [[ "$phase" == "Ready" ]] && break
  sleep 1
done
ready_in=$(( SECONDS - apply_start ))

if [[ "$phase" != "Ready" ]]; then
  kubectl get stellartestnet "$NAME" -n "$NAMESPACE" -o yaml || true
  kubectl get deploy,svc -n "$NAMESPACE" -l "stellar.forge.dev/testnet=$NAME" \
    -o wide || true
  kubectl logs -n stellar-forge-system deploy/stellar-forge-controller \
    --tail=50 2>/dev/null || true
  fail "not Ready within ${TIMEOUT}s (phase=${phase:-none}, waited ${ready_in}s)"
fi
log "StellarTestnet Ready in ${ready_in}s (budget ${TIMEOUT}s)"

# ─── Read connection details out of status ───────────────────────────────────
RPC_URL="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" -o jsonpath='{.status.rpcUrl}')"
PASSPHRASE="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" -o jsonpath='{.status.networkPassphrase}')"
DEPLOYER_G="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" \
  -o jsonpath='{.status.accounts[?(@.name=="deployer")].publicKey}')"
DEPLOYER_S="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" \
  -o jsonpath='{.status.accounts[?(@.name=="deployer")].secretKey}')"

[[ -n "$RPC_URL" ]]    || fail "status.rpcUrl is empty"
[[ -n "$DEPLOYER_S" ]] || fail "status did not publish the deployer secret key"
log "rpc endpoint:   $RPC_URL"
log "deployer:       $DEPLOYER_G"

# Every declared account must be funded before Ready was reported.
funded="$(kubectl get -f "$MANIFEST" -n "$NAMESPACE" \
  -o jsonpath='{.status.accounts[*].funded}')"
case " $funded " in
  *" false "*) fail "status reports unfunded accounts: $funded" ;;
esac
log "accounts funded: $funded"

# ─── Probe the Soroban RPC endpoint directly ─────────────────────────────────
health="$(curl -sf --max-time 5 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL")"
grep -q '"status":"healthy"' <<<"$health" || fail "getHealth not healthy: $health"

network="$(curl -sf --max-time 5 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}' "$RPC_URL")"
grep -Fq "$PASSPHRASE" <<<"$network" \
  || fail "RPC reports a different passphrase (expected: $PASSPHRASE)"
log "getHealth healthy, network passphrase matches spec"

# ─── Build the token-factory contract (same target as CI) ────────────────────
if [[ ! -f "$WASM" ]]; then
  require cargo
  log "building token-factory wasm (contracts, wasm32v1-none release)"
  (cd "$REPO_ROOT/contracts" \
    && cargo build --target wasm32v1-none --release) \
    || fail "contract build failed (rustup target add wasm32v1-none?)"
fi
[[ -f "$WASM" ]] || fail "wasm artifact missing: $WASM"

# ─── Deploy the contract against the ephemeral network ───────────────────────
# The deploy transaction doubles as the proof that the deployer account is
# funded: an unfunded source cannot submit anything.
NET_ARGS=(--source "$DEPLOYER_S" --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE")

log "uploading token-factory wasm"
WASM_HASH="$(stellar contract upload "${NET_ARGS[@]}" --wasm "$WASM")"
log "wasm hash: $WASM_HASH"

log "deploying token-factory"
CONTRACT_ID="$(stellar contract deploy "${NET_ARGS[@]}" --wasm-hash "$WASM_HASH")"
log "contract id: $CONTRACT_ID"

log "invoking initialize"
stellar contract invoke "${NET_ARGS[@]}" --id "$CONTRACT_ID" -- \
  initialize \
  --admin "$DEPLOYER_G" \
  --treasury "$DEPLOYER_G" \
  --fee_token "$DEPLOYER_G" \
  --token_wasm_hash "$WASM_HASH" \
  --base_fee 100 \
  --metadata_fee 1000 >/dev/null

base_fee="$(stellar contract invoke "${NET_ARGS[@]}" --id "$CONTRACT_ID" -- \
  get_base_fee)"
[[ "$base_fee" == "100" ]] || fail "get_base_fee returned '$base_fee', expected 100"
log "contract state verified (get_base_fee == 100)"

# ─── Teardown and garbage collection ─────────────────────────────────────────
if [[ "$KEEP" == true ]]; then
  log "keeping StellarTestnet/$NAME in namespace $NAMESPACE (--keep)"
else
  log "deleting StellarTestnet/$NAME"
  delete_start=$SECONDS
  kubectl delete -f "$MANIFEST" -n "$NAMESPACE" --wait=true --timeout=60s >/dev/null

  leftovers="$(kubectl get deploy,svc,ingresses -n "$NAMESPACE" \
    -l "stellar.forge.dev/testnet=$NAME" -o name 2>/dev/null || true)"
  [[ -z "$leftovers" ]] || fail "resources survived deletion: $leftovers"

  if kubectl get stellartestnet "$NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    fail "StellarTestnet/$NAME still present after delete returned"
  fi
  log "teardown verified in $(( SECONDS - delete_start ))s: no owned resources left"
fi

log "PASS: provisioned (${ready_in}s), deployed contract, torn down cleanly"
