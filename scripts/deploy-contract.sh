#!/usr/bin/env bash
set -euo pipefail

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
  echo "Usage: $0 --network <testnet|mainnet> --admin <address> --treasury <address> --fee-token <address> --token-wasm-hash <hash> --source <secret-key>"
  echo ""
  echo "  --network     Target network: testnet or mainnet (required)"
  echo "  --admin       Admin address for the contract (required)"
  echo "  --treasury    Treasury address for fee collection (required)"
  echo "  --fee-token       SEP-41 token address used for fee payments (required)"
  echo "  --token-wasm-hash Wasm hash the factory deploys for each new token (required)"
  echo "  --source          Stellar secret key or account alias (required)"
  echo ""
  echo "Example:"
  echo "  $0 --network testnet --admin GABC... --treasury GXYZ... --fee-token CFEE... --token-wasm-hash abcd... --source SXXX..."
  exit 1
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
NETWORK=""
ADMIN=""
TREASURY=""
FEE_TOKEN=""
TOKEN_WASM_HASH=""
SOURCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)         NETWORK="$2";         shift 2 ;;
    --admin)           ADMIN="$2";           shift 2 ;;
    --treasury)        TREASURY="$2";        shift 2 ;;
    --fee-token)       FEE_TOKEN="$2";       shift 2 ;;
    --token-wasm-hash) TOKEN_WASM_HASH="$2"; shift 2 ;;
    --source)          SOURCE="$2";          shift 2 ;;
    -h|--help)         usage ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

# ─── Validate required arguments ─────────────────────────────────────────────
MISSING=()
[[ -z "$NETWORK" ]]         && MISSING+=("--network")
[[ -z "$ADMIN" ]]           && MISSING+=("--admin")
[[ -z "$TREASURY" ]]        && MISSING+=("--treasury")
[[ -z "$FEE_TOKEN" ]]       && MISSING+=("--fee-token")
[[ -z "$TOKEN_WASM_HASH" ]] && MISSING+=("--token-wasm-hash")
[[ -z "$SOURCE" ]]          && MISSING+=("--source")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "Error: Missing required arguments: ${MISSING[*]}"
  echo ""
  usage
fi

if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "Error: --network must be 'testnet' or 'mainnet', got '$NETWORK'"
  exit 1
fi

# ─── Validate dependencies ───────────────────────────────────────────────────
for cmd in stellar cargo wasm-opt; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' is not installed or not in PATH."
    [[ "$cmd" == "stellar" ]] && echo "  Run: cargo install stellar-cli --features opt"
    [[ "$cmd" == "wasm-opt" ]] && echo "  Run: apt install binaryen  OR  brew install binaryen"
    exit 1
  fi
done

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACT_DIR="$REPO_ROOT/contracts/token-factory"
# The cargo workspace root is `contracts/`, so build output lands in
# `contracts/target`, not the repo-root `target`.
WASM_DIR="$REPO_ROOT/contracts/target/wasm32v1-none/release"
WASM_FILE="$WASM_DIR/token_factory.wasm"
OPTIMIZED_WASM="$WASM_DIR/token_factory.optimized.wasm"
FRONTEND_ENV="$REPO_ROOT/frontend/.env"

# ─── Default fees ────────────────────────────────────────────────────────────
BASE_FEE=70000000
METADATA_FEE=30000000

# ─── Step 1: Build ───────────────────────────────────────────────────────────
echo ""
echo "▶ Building contract WASM..."
# soroban-sdk 27 rejects wasm32-unknown-unknown on Rust 1.82+; wasm32v1-none is
# the target the contract is built and shipped from everywhere else.
(cd "$CONTRACT_DIR" && cargo build --target wasm32v1-none --release)

echo "▶ Optimizing WASM with wasm-opt..."
wasm-opt -Oz "$WASM_FILE" -o "$OPTIMIZED_WASM"
echo "  Optimized: $OPTIMIZED_WASM"

# ─── Step 2+3: Deploy and initialize atomically ──────────────────────────────
# `initialize` runs as the contract's `__constructor`, so `stellar contract
# deploy` invokes it as part of the same deploy transaction (Soroban's
# deploy_v2 host function). There is no separate `invoke` call and therefore
# no window between deployment and initialization for an attacker to race
# with their own admin/treasury — see docs/mainnet-deployment-checklist.md.
echo ""
echo "▶ Deploying and initializing contract on $NETWORK (atomic)..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPTIMIZED_WASM" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  --admin "$ADMIN" \
  --treasury "$TREASURY" \
  --fee_token "$FEE_TOKEN" \
  --token_wasm_hash "$TOKEN_WASM_HASH" \
  --base_fee "$BASE_FEE" \
  --metadata_fee "$METADATA_FEE" 2>&1)

# Validate the contract ID looks like a Stellar contract address
if [[ ! "$CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
  echo "Error: Deployment failed or returned unexpected output:"
  echo "$CONTRACT_ID"
  exit 1
fi

echo "  Contract ID: $CONTRACT_ID"

# ─── Step 4: Verify admin before publishing the address anywhere ────────────
echo ""
echo "▶ Verifying on-chain admin matches --admin..."
STATE_JSON=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  get_state 2>&1)

ONCHAIN_ADMIN=$(echo "$STATE_JSON" | grep -o '"admin":"[^"]*"' | cut -d'"' -f4)

if [[ "$ONCHAIN_ADMIN" != "$ADMIN" ]]; then
  echo "Error: on-chain admin ($ONCHAIN_ADMIN) does not match expected admin ($ADMIN)."
  echo "  Do NOT publish this contract ID anywhere. Investigate before proceeding."
  exit 1
fi

echo "  Verified: on-chain admin matches $ADMIN."

# ─── Step 5: Save to .env ────────────────────────────────────────────────────
echo ""
echo "▶ Saving contract ID to $FRONTEND_ENV..."

# Create .env from example if it doesn't exist
if [[ ! -f "$FRONTEND_ENV" ]]; then
  cp "$REPO_ROOT/frontend/.env.example" "$FRONTEND_ENV"
fi

# Update or append VITE_FACTORY_CONTRACT_ID
if grep -q "^VITE_FACTORY_CONTRACT_ID=" "$FRONTEND_ENV"; then
  sed -i "s|^VITE_FACTORY_CONTRACT_ID=.*|VITE_FACTORY_CONTRACT_ID=$CONTRACT_ID|" "$FRONTEND_ENV"
else
  echo "VITE_FACTORY_CONTRACT_ID=$CONTRACT_ID" >> "$FRONTEND_ENV"
fi

# Update or append VITE_NETWORK
if grep -q "^VITE_NETWORK=" "$FRONTEND_ENV"; then
  sed -i "s|^VITE_NETWORK=.*|VITE_NETWORK=$NETWORK|" "$FRONTEND_ENV"
else
  echo "VITE_NETWORK=$NETWORK" >> "$FRONTEND_ENV"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Deployment complete!"
echo "   Network:     $NETWORK"
echo "   Contract ID: $CONTRACT_ID"
echo "   Saved to:    $FRONTEND_ENV"
