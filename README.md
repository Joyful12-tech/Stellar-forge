# StellarForge - Stellar Token Deployer

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Favourorg/Stellar-forge&root=frontend&env=VITE_FACTORY_CONTRACT_ID,VITE_TOKEN_WASM_HASH,PINATA_API_KEY,PINATA_API_SECRET&envDescription=Required%20environment%20variables%20for%20StellarForge&envLink=https://github.com/Favourorg/Stellar-forge/blob/main/docs/deployment-vercel.md)

StellarForge is a user-friendly decentralized application (dApp) that enables creators, entrepreneurs, and businesses in emerging markets to deploy custom tokens on the Stellar blockchain without writing a single line of code.

## Features

- **Token Factory Contract**: Deploy custom SEP-41 tokens on Stellar using a single Soroban smart contract, without writing or auditing your own contract code
- **Single & Batch Token Creation**: Deploy one token per transaction, or atomically deploy multiple tokens in a single `create_tokens_batch` call
- **Fee-Based System**: Configurable, admin-adjustable fees for token creation, metadata setting, and minting, paid in a dedicated SEP-41 fee token (typically native XLM)
- **Fee Splitting**: Route a percentage (in basis points) of every collected fee to multiple recipients instead of a single treasury address
- **Max Supply Caps**: Optionally cap a token's total mintable supply at creation time (batch path); further `mint_tokens` calls are rejected once the cap would be exceeded
- **IPFS Integration**: Store token metadata (images, descriptions) on IPFS via Pinata, referenced on-chain by a single `ipfs://` URI
- **Wallet Integration**: Connect with the Freighter wallet extension for account discovery and transaction signing
- **Burn Functionality**: Token holders can burn their own balance; each token has a per-token `burn_enabled` flag an admin can toggle off
- **Admin Controls**: Update fees, pause/unpause the factory, rotate the admin address, and upgrade the contract's WASM through a two-step, timelocked proposal
- **Network Mismatch Protection**: Writes are blocked in the UI whenever the connected Freighter network differs from the app's selected network, preventing accidental cross-network signing
- **Network Switcher**: Toggle between testnet and mainnet from the UI, each with its own contract ID, RPC endpoint, and explorer links
- **Transaction History**: View on-chain contract events (token creation, mint, burn, metadata, fee changes) with pagination and CSV export
- **Contract Upgradability**: In-place WASM upgrades gated behind a mandatory two-step timelock (`propose_upgrade` → ~28.8h → `execute_upgrade`, cancellable throughout), plus an idempotent, versioned state-migration path (`schema_version` + `migrate`) that preserves all existing tokens, fees, and admin state
- **Testnet & Mainnet Support**: The same frontend build supports both networks via environment configuration, with an explicit confirmation modal before mainnet-destructive actions

## How StellarForge Works

StellarForge is built around one on-chain "factory" contract that deploys and administers many independent token contracts, plus a React frontend that talks directly to Stellar — there is no StellarForge backend server and no database. Every piece of durable state (tokens, balances, fees, metadata pointers) lives on the Stellar ledger; the frontend is a thin, stateless client that reads and writes it.

### 1. The factory pattern

The `token-factory` Soroban contract (`contracts/token-factory/src/lib.rs`) is deployed once per network (one factory on testnet, one on mainnet). It does not implement token logic itself — instead it:

1. Holds a `token_wasm_hash`: the hash of a separately-deployed, audited SEP-41 token contract WASM.
2. On `create_token`, uses Soroban's deterministic deployer (`env.deployer().with_address(creator, salt)`) to instantiate a **new, independent contract instance** of that WASM, owned at an address derived from `(creator, salt)`.
3. Initializes the new token contract with the requested `name`, `symbol`, and `decimals`, and optionally mints the caller an `initial_supply`.
4. Records bookkeeping for the new token in `persistent` storage (see [Storage architecture](./docs/contract-abi.md#storage-architecture)): a `TokenInfo` record (name, symbol, decimals, creator, timestamp, burn flag, optional max supply), a reverse `token_address → index` lookup, and a paginated `creator → [indices]` list for "my tokens" queries.

Every token deployed this way is a fully standalone contract on the ledger — it can be transferred, held, and queried through the standard SEP-41 interface by any Stellar wallet or tool, independent of StellarForge.

### 2. The fee model

Every mutating factory call that has a monetary cost (`create_token`, `create_tokens_batch`, `mint_tokens`, `set_metadata`) requires the caller to pass a `fee_payment` argument and pre-authorize a transfer of that amount in the factory's configured `fee_token` (a SEP-41 asset — usually native XLM). The factory:

- Rejects the call with `Error::InsufficientFee` if `fee_payment` is below the current `base_fee` (or `base_fee * token_count` for batch creation) or `metadata_fee`.
- Transfers the fee from the caller either straight to a single `treasury` address, or — if the admin has configured a **fee split** via `set_fee_split` — proportionally across multiple recipients by basis points (parts per 10,000), with any rounding remainder going to `treasury`.
- Lets the admin retune `base_fee` and `metadata_fee` at any time via `update_fees`, without redeploying.

### 3. Metadata: on-chain pointer, off-chain payload

Token images and descriptions are too large and mutable to store cheaply on a Soroban ledger, so StellarForge splits metadata into two layers:

1. **Off-chain payload** — the frontend uploads the image and a JSON document (`{ name, description, image }`) to IPFS through Pinata's pinning API, getting back a content identifier (CID) for each.
2. **On-chain pointer** — `set_metadata(token_address, admin, metadata_uri, fee_payment)` stores the current `ipfs://<cid>` URI for the token, and each successful update increments the metadata version. The contract enforces `fee_payment >= metadata_fee`, validates the `ipfs://` prefix and length, and blocks writes when the token is frozen. Authorization is **per-token**: the caller must be the token's creator (the guard compares the caller against the creator stored under the token's `owner` key), not the factory admin — see [SECURITY.md](./SECURITY.md#admin-key-is-a-single-point-of-trust). Any client — StellarForge's UI, a block explorer, another dApp — can resolve that URI through any IPFS gateway to fetch the same image/description.

### 4. Administration, safety, and lifecycle controls

- **Pause switch** — `pause`/`unpause` let the admin halt `create_token`, `create_tokens_batch`, `mint_tokens`, and `set_metadata` factory-wide in an emergency. `burn` intentionally ignores the pause flag, since token holders should always be able to reduce their own balance.
- **Reentrancy guard** — a `locked` flag on `FactoryState` prevents a second `create_token`/`create_tokens_batch` call from interleaving with one already in progress in the same transaction context.
- **Per-token burn toggle** — `set_burn_enabled` lets a token's creator disable burning for that token specifically (e.g. for a fixed-supply asset), independent of the factory-wide pause.
- **Allow-list enforcement** — `add_to_whitelist` / `remove_from_whitelist` / `is_whitelisted` maintain an admin-managed address allow-list in factory storage. When the admin calls `set_whitelist_enabled(true)`, only whitelisted addresses may call `create_token` or `create_tokens_batch`; non-whitelisted callers receive `Error::NotWhitelisted`. Enforcement defaults to `false` so existing open deployments are unaffected until an admin opts in.
- **Admin rotation** — `propose_admin` / `accept_admin` / `cancel_admin_proposal` implement a two-step rotation: the current admin proposes a successor (emitting `adm_prop`), the proposed admin proves they can sign by calling `accept_admin` (emitting `adm_acc`), and the current admin may cancel at any time before acceptance (emitting `adm_can`). Proposals expire after ~28 hours (`ADMIN_PROPOSAL_TTL_LEDGERS`). `transfer_admin` / `update_admin` are retained as **deprecated** aliases for `propose_admin` — neither completes the rotation on its own, and both say so: they return an `AdminRotationReceipt` with `rotation_complete: false` and emit an extra `adm_dep` event naming the deprecated entrypoint, so no caller or indexer can read a proposal as a finished rotation (issue #1159). Never decommission the outgoing admin key until `accept_admin` has succeeded and `get_state()` reports the new `admin` with `pending_admin: null`.
- **Upgrade + migrate** — `propose_upgrade` records a candidate WASM hash and starts a ~28.8-hour timelock (emitting `upg_prop`); `execute_upgrade` performs the swap once that window has elapsed, and only for the exact hash proposed (emitting `upg_exec`); `cancel_upgrade` withdraws a pending proposal at any point before that (emitting `upg_can`). The delay exists so a compromised admin key cannot swap in attacker WASM atomically — the proposal is visible on-chain before it can take effect. `migrate` is an idempotent, versioned function (`schema_version` vs. `CURRENT_SCHEMA_VERSION`) that brings on-chain state up to date with the currently-deployed code without ever losing existing tokens or fee configuration. See [Contract Upgrade Process](#contract-upgrade-process) below.

### 5. The frontend's role

The React app (`frontend/src`) is organized in layers so that UI code never talks to the network directly:

- **`services/`** — the only layer that touches the outside world: `stellar.ts` / `stellar-impl.ts` build, sign-request, submit, and poll Soroban transactions and parse contract events; `ipfs.ts` uploads to and reads from Pinata; `wallet.ts` wraps the Freighter browser extension API.
- **`context/`** — app-wide React state: `WalletContext` (connected account, signing), `NetworkContext` (testnet/mainnet selection, persisted to `localStorage`, cross-checked against Freighter's actual network via `useNetworkMismatch`), `ToastContext`, `DarkModeContext`, `TosContext`.
- **`hooks/`** — data-fetching and derived state built on the services layer: `useTokens` (cached, paginated token listings), `useTransaction`/`useTransactionPolling` (submit-and-poll a signed transaction), `useFactoryState`, `useTokenBalance`, `useTransactionHistory`, and more.
- **`components/`** — presentation and forms (`CreateToken`, `MintForm`, `BurnForm`, `SetMetadataForm`, `AdminPanel`, `TokenExplorer`, `TokenDashboard`, `TransactionHistory`, …) that compose hooks and services but hold no blockchain logic of their own.

Because all state lives on-chain (or on IPFS), the frontend can be redeployed, pointed at a different factory contract ID, or replaced entirely without any data migration — it is purely a view over the Stellar ledger.

## Tech Stack

### Backend (Smart Contracts)

- **Rust**: Programming language for Soroban contracts
- **Soroban SDK**: Stellar's smart contract development framework
- **Soroban Token SDK**: For token operations

### Frontend

- **React 19**: UI framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Build tool and dev server
- **Tailwind CSS**: Utility-first CSS framework
- **Vitest**: Testing framework

### Integrations

- **Freighter Wallet**: Stellar wallet browser extension
- **IPFS/Pinata**: Decentralized file storage for metadata
- **Stellar Horizon**: Blockchain data API
- **Soroban RPC**: Smart contract interaction

## Prerequisites

- **Rust**: For building Soroban contracts
- **Node.js** (v18+): For frontend development
- **Stellar CLI**: For contract deployment and testing (see setup below)
- **Freighter Wallet**: Browser extension for Stellar transactions

## Installation & Setup

You can set up StellarForge using either Docker (recommended for quick start) or local installation.

### Option 1: Docker Setup (Recommended)

**Prerequisites**: Docker and Docker Compose

```bash
# Clone the repository
git clone <repository-url>
cd stellar-forge

# Start development environment
docker compose up -d

# Frontend available at: http://localhost:5173
# Access contract builder: docker compose exec contract-builder bash
```

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for detailed Docker instructions.

### Option 2: Local Installation

**Prerequisites**: Rust, Node.js (v18+), Stellar CLI, Freighter Wallet

### 1. Clone the Repository

```bash
git clone <repository-url>
cd stellar-forge
```

### 2. Setup Stellar CLI Environment

Run the setup script to install Rust, Stellar CLI, and configure testnet:

```bash
./scripts/setup-soroban.sh
```

> **Note:** The Soroban CLI was renamed to `stellar` in recent versions. All commands below use `stellar`. If you have the old `soroban` binary installed, uninstall it and run the setup script again:
>
> ```bash
> cargo uninstall soroban-cli
> cargo install stellar-cli --features opt
> ```

### 3. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 4. Environment Variables

Copy the example env file and fill in your values:
Copy the example file and fill in your values:

```bash
cp frontend/.env.example frontend/.env
```

Then edit `frontend/.env`:

```env
VITE_NETWORK=testnet
VITE_FACTORY_CONTRACT_ID=<deployed-contract-id>
```

Metadata uploads go through a serverless proxy (`api/ipfs/*`) so Pinata
credentials never reach the browser. Set these as **server-side** environment
variables in your Vercel project settings (or a local `.env` at the repo
root when running `vercel dev`) - never prefix them with `VITE_`, or they'll
be inlined into the client bundle and shipped to every visitor:

```env
PINATA_API_KEY=<pinata-api-key>
PINATA_API_SECRET=<pinata-api-secret>
JWT_SECRET=<random-32-byte-secret>
VERCEL_KV_REST_API_URL=<vercel-kv-rest-url>
VERCEL_KV_REST_API_TOKEN=<vercel-kv-rest-token>
```

> **The KV variables are required in production.** Uploads are gated on a
> wallet-signature login whose challenge is issued by one request and verified
> by another. On Vercel those are separate invocations with no routing
> affinity, so without a shared store the second one lands on an instance that
> has never seen the challenge, and correct clients are told to "request a new
> challenge" at whatever rate the platform happens to scale at (issue #1091).
> The same store backs rate limiting, which is likewise per-instance without
> it. `GET /api/health/auth` reports which store is live: `durable: true` for
> Vercel KV, or `503` with `store: "in-memory"` for the local-dev fallback.
> Local development needs neither variable.

> **Note:** `VITE_FACTORY_CONTRACT_ID` and `VITE_TOKEN_WASM_HASH` are required. The app will display a misconfiguration screen if either is missing, rather than failing silently at runtime.
>
> **Pinata credentials are not frontend variables.** Vite inlines every `VITE_`-prefixed
> value into the built JavaScript, so a `VITE_IPFS_API_KEY` is readable by anyone who
> loads the page. Set `PINATA_API_KEY` and `PINATA_API_SECRET` in the _server_
> environment instead; the serverless functions in `api/ipfs/` proxy uploads, and the UI
> learns whether they are configured from `GET /api/health/ipfs`.

## Building & Testing

### Smart Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

For an optimized binary (requires `binaryen` — install via `apt install binaryen` or `brew install binaryen`):

```bash
cd contracts/token-factory
bash build.sh
```

This produces `target/wasm32-unknown-unknown/release/token_factory.optimized.wasm`, which is significantly smaller and lowers on-chain deployment costs.

### Run Contract Tests

```bash
cd contracts/token-factory
cargo test
```

### Run Contract Fuzz Tests

Fuzz testing with random inputs discovers edge cases and potential crashes:

```bash
cd contracts/token-factory/fuzz
cargo fuzz run fuzz_create_token -- -timeout=60    # Test token creation
cargo fuzz run fuzz_fee_arithmetic -- -timeout=60  # Test fee calculations
cargo fuzz run fuzz_burn -- -timeout=60            # Test burn operations
```

For more details on fuzz testing setup and interpretation, see [contracts/token-factory/fuzz/README.md](contracts/token-factory/fuzz/README.md).

### Frontend

```bash
cd frontend
npm run dev          # Start dev server
npm run build        # Build for production
npm run test         # Run tests
npm run lint         # Lint code
```

## Contract Functions

The authoritative, field-by-field reference — including parameter tables, every error code, and every emitted event — lives in [`docs/contract-abi.md`](./docs/contract-abi.md). This section is a quick-scan summary of the same `#[contractimpl]` surface in `contracts/token-factory/src/lib.rs`.

### Initialization

- `__constructor(admin, treasury, fee_token, token_wasm_hash, base_fee, metadata_fee)`: One-time factory setup, run atomically as part of contract deployment. Fails with `AlreadyInitialized` on retry.

### Token Lifecycle

- `create_token(creator, salt, name, symbol, decimals, initial_supply, max_supply, fee_payment)`: Deploy a single new token contract at a deterministic `(creator, salt)` address; optionally mint `initial_supply` to `creator`, and optionally cap total supply with `max_supply` (`Option<i128>`). Single-token creation shares one validation and bookkeeping routine with the batch path, so both accept/reject identical parameters with identical error codes and enforce `max_supply` with the same accounting (issue #1022).
- `create_tokens_batch(creator, tokens, fee_payment)`: Atomically deploy a `Vec<BatchTokenParams>` (each with its own name/symbol/decimals/initial_supply and optional `max_supply` cap) in one transaction. `fee_payment` must cover `base_fee * tokens.len()`; a failure partway through the batch aborts the whole call.
- `mint_tokens(token_address, admin, to, amount, fee_payment)`: Mint additional supply. Only the token's original creator may call this. Rejected with `MaxSupplyExceeded` if the token was created with a `max_supply` cap that minting would exceed.
- `burn(token_address, from, amount)`: Burn `amount` from the caller's own balance. Honors the token's `burn_enabled` flag; ignores the factory-wide pause.

### Metadata

- `set_metadata(token_address, admin, metadata_uri, fee_payment)`: Attach or update the token's `ipfs://` metadata URI. The caller must be the token's creator (the `admin` parameter names the _token's_ admin, not the factory admin), `fee_payment` must satisfy `metadata_fee`, and updates are allowed until the token is frozen or the per-token update cap is reached; every successful write increments the metadata version.
- `set_burn_enabled(token_address, admin, enabled)`: Toggle whether a specific token can be burned. Caller must be the token's creator.

### Admin & Governance

- `update_fees(admin, base_fee?, metadata_fee?)`: Adjust either fee; `None` leaves it unchanged.
- `set_fee_split(admin, splits)` / `get_fee_split()`: Configure or read a `Map<Address, u32>` of basis-point fee recipients (must sum to `10_000`, or be empty to clear the split and fall back to `treasury`).
- `pause(admin)` / `unpause(admin)`: Halt or resume `create_token`, `create_tokens_batch`, `mint_tokens`, and `set_metadata` factory-wide.
- `add_to_whitelist(admin, address)` / `remove_from_whitelist(admin, address)` / `is_whitelisted(address)`: Maintain an admin-managed address allow-list in contract storage. Use `set_whitelist_enabled(admin, true)` to turn enforcement on — once enabled, only whitelisted addresses may call `create_token` or `create_tokens_batch` (non-whitelisted callers receive `Error::NotWhitelisted`). Enforcement is off by default.
- `propose_admin(current_admin, new_admin)` / `accept_admin(new_admin)` / `cancel_admin_proposal(current_admin)`: Two-step admin rotation. `propose_admin` records the proposed successor; `accept_admin` (called by the proposed admin) completes the handover after proving the key can sign; `cancel_admin_proposal` lets the current admin withdraw a proposal. `transfer_admin` and `update_admin` are deprecated aliases for `propose_admin`; they return an `AdminRotationReceipt` (`rotation_complete: false`) and emit `adm_dep` alongside `adm_prop`. The rotation procedure — and the rule that the old key stays live until `accept_admin` lands — is in the [mainnet deployment checklist](./docs/mainnet-deployment-checklist.md#admin-key-rotation).
- `propose_upgrade(admin, new_wasm_hash)` / `execute_upgrade(admin, new_wasm_hash)` / `cancel_upgrade(admin)`: Two-step, timelocked WASM replacement, preserving all state. `propose_upgrade` records the candidate hash and a `ready_at` ledger ~17,280 ledgers (~28.8 hours) out; `execute_upgrade` performs the swap only once that ledger is reached and only for the exact hash proposed; `cancel_upgrade` aborts a pending proposal. The single-step `upgrade` entrypoint was removed in schema version 5 (issue #6). See [Contract Upgrade Process](#contract-upgrade-process).
- `migrate(admin)`: Idempotently bring on-chain state up to `CURRENT_SCHEMA_VERSION` after an upgrade.

### View Functions

- `get_state()`: Full `FactoryState` (admin, treasury, fee_token, fees, pause flag, token count, schema version).
- `get_base_fee()` / `get_metadata_fee()`: Current fee values.
- `get_token_info(index)`: Look up a token by its 1-based factory index.
- `get_tokens_by_creator(creator, offset, limit)`: Paginated slice of token indices created by a given address. The contract caps `limit` at `MAX_TOKENS_BY_CREATOR_PAGE` (currently 50) per call, so list iteration should advance `offset` by the previous page's length until a short page is returned. The frontend's `fetchAllTokensByCreator` helper (`frontend/src/hooks/useTokens.ts`) does this loop automatically.

### Errors

All fallible entrypoints return `Result<T, Error>`. See the full table (27 variants, e.g. `InsufficientFee`, `Unauthorized`, `ContractPaused`, `MaxSupplyExceeded`, `InvalidFeeSplit`, `NoPendingProposal`, `ProposalExpired`) in [`docs/contract-abi.md`](./docs/contract-abi.md#errors).

### Events

The contract publishes Soroban events on `(factory, action)` topics — `init`, `created`, `meta`, `mint`, `burn`, `fees`, `pause`, `unpause`, `adm_prop`, `adm_acc`, `adm_can`, `adm_dep` — parsed by the frontend in `frontend/src/services/stellar-impl.ts` and rendered in the Transaction History view. See [`docs/contract-abi.md`](./docs/contract-abi.md#events) for the exact payload of each.

## Usage

1. **Connect Wallet**: Use the Freighter browser extension to connect an account. The app checks that Freighter's active network matches the app's selected network and blocks writes on mismatch.
2. **Create Token**: Fill in name, symbol, decimals, and initial supply; the form validates against the same rules the contract enforces (name ≤ 32 chars, symbol ≤ 12 chars, decimals 0–18) before submission. Sign and submit the transaction to pay the creation fee and deploy the token contract.
3. **Set Metadata**: Upload a token image and description — the app uploads the image to IPFS, pins a metadata JSON document referencing it, then calls `set_metadata` with the resulting `ipfs://` URI. Metadata updates are valid for the token until the URI is frozen or the update cap is reached; the contract increments the metadata version on every successful write.
4. **Mint Tokens**: As the token's creator, mint additional supply to any address, subject to the token's optional `max_supply` cap.
5. **Manage Supply**: Token holders can burn their own balance at any time (unless the creator has disabled burning for that token via `set_burn_enabled`).
6. **Admin Panel**: The factory admin can update fees, configure a fee split, pause/unpause the factory, and rotate the admin address from the in-app Admin Panel.
7. **Explore & Export**: Browse all deployed tokens or a specific creator's tokens in the Token Explorer/Dashboard, and export transaction history to CSV.

## Deployment

Two `vercel.json` files govern two distinct Vercel deployments, and both must keep an identical `headers` block — see [docs/deployment-vercel.md](./docs/deployment-vercel.md) for which file is authoritative for which deployment.

## Deployment & Caching

The application uses a service worker (via Workbox) to support offline capabilities. The cache is versioned using the `VITE_FACTORY_CONTRACT_ID` and `VITE_NETWORK` environment variables.

- When either of these variables changes, the service worker will be updated and old caches will be cleared automatically.
- The user interface displays the current contract ID and network in the footer, allowing manual verification before signing any transaction.

To force a cache refresh, users can either reload the page (the SW will update in the background) or clear the site data from the browser.

**Important**: After a contract redeployment, ensure the environment variables are updated and the build is deployed. The new SW will be served and clients will fetch the updated assets.

### Testnet Deployment Guide

This guide walks you through deploying StellarForge to Stellar testnet from scratch.

#### Prerequisites

- Stellar CLI installed (run `./scripts/setup-soroban.sh` if not)
- Freighter wallet installed in your browser
- Basic understanding of command line

#### Step 1: Get Testnet XLM

You need testnet XLM to pay for contract deployment and transactions.

1. **Create a testnet account** using Stellar CLI:

   ```bash
   stellar keys generate deployer --network testnet
   ```

   This creates a new keypair and saves it locally. The output shows your public key.

2. **Fund your account** using Friendbot:

   ```bash
   stellar keys address deployer
   # Copy the address (starts with G...)

   # Fund with 10,000 testnet XLM
   curl "https://friendbot.stellar.org?addr=YOUR_ADDRESS_HERE"
   ```

3. **Verify your balance**:
   ```bash
   stellar account balance deployer --network testnet
   ```
   You should see 10,000 XLM.

#### Step 2: Build the Contract

```bash
cd contracts/token-factory

# Build the contract
cargo build --target wasm32-unknown-unknown --release

# Optimize the binary (reduces size and deployment costs)
stellar contract optimize \
  --wasm ../../target/wasm32-unknown-unknown/release/token_factory.wasm
```

The optimized WASM will be at `../../target/wasm32-unknown-unknown/release/token_factory.optimized.wasm`.

#### Step 3: Upload Token Contract WASM

The factory needs the token contract WASM hash _before_ it's deployed, since that hash is now one of its constructor arguments (see Step 4).

```bash
# First, build the standard Stellar token contract
# (or use your custom token implementation)
stellar contract install \
  --wasm path/to/soroban_token_contract.wasm \
  --source deployer \
  --network testnet

# Save the WASM hash (64 hex characters)
# Example: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

If you don't have a token WASM, you can use the Stellar Asset Contract:

```bash
# Download from a pinned release tag (replace v0.x.y with a specific tag — do NOT use main)
wget https://github.com/stellar/soroban-examples/raw/<TAG>/token/target/wasm32-unknown-unknown/release/soroban_token_contract.wasm

# Install it
stellar contract install \
  --wasm soroban_token_contract.wasm \
  --source deployer \
  --network testnet
```

#### Step 4: Deploy and Initialize the Factory (atomically)

`initialize` is the contract's `__constructor`, so deployment and initialization happen in a **single transaction** — there is no separate `invoke` step, and therefore no window where an attacker could race the deployer's own initialization with their own and seize the admin role (see [issue #1005](https://github.com/Favourorg/Stellar-forge/issues/1005) and [`docs/contract-abi.md`](./docs/contract-abi.md)). Constructor arguments go after `--`, the same as any other `stellar contract deploy` invocation with a constructor.

```bash
# Get your admin address (same as deployer for simplicity)
ADMIN_ADDRESS=$(stellar keys address deployer)

# Deploy and initialize in one atomic call
stellar contract deploy \
  --wasm ../../target/wasm32-unknown-unknown/release/token_factory.optimized.wasm \
  --source deployer \
  --network testnet \
  -- \
  --admin $ADMIN_ADDRESS \
  --treasury $ADMIN_ADDRESS \
  --fee_token <NATIVE_XLM_CONTRACT_ADDRESS> \
  --token_wasm_hash <TOKEN_WASM_HASH_FROM_STEP_3> \
  --base_fee 100000000 \
  --metadata_fee 50000000

# Save the contract ID (starts with C...)
# Example output: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Save this contract ID** - you'll need it for frontend configuration.

Before using this contract ID anywhere (frontend `.env`, docs, announcements), verify the on-chain admin matches:

```bash
stellar contract invoke \
  --id <FACTORY_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  get_state
# Confirm the "admin" field equals $ADMIN_ADDRESS before proceeding.
```

**Parameters explained:**

- `admin`: Address that can update fees, pause the factory, manage the whitelist and fee split, rotate the admin, and upgrade the contract. Must authorize this deployment (`require_auth`).
- `treasury`: Default address that receives fees from token creation (overridden per-recipient if a fee split is configured)
- `fee_token`: Contract address for the SEP-41 token used to pay all fees (use native XLM contract: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)
- `token_wasm_hash`: The WASM hash uploaded in Step 3 — every token the factory deploys is an instance of this code
- `base_fee`: Fee for `create_token` / `mint_tokens` / each token in `create_tokens_batch` (in stroops, 1 XLM = 10,000,000 stroops)
- `metadata_fee`: Fee for `set_metadata`

#### Step 6: Configure Frontend

```bash
cd frontend

# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env
```

Update these required variables:

```env
VITE_NETWORK=testnet
VITE_FACTORY_CONTRACT_ID=<your-factory-contract-id>
VITE_TOKEN_WASM_HASH=<your-token-wasm-hash>
```

Pinata credentials go in the **server** environment, never the frontend build:

```env
PINATA_API_KEY=<your-pinata-api-key>
PINATA_API_SECRET=<your-pinata-api-secret>
```

> **Keep `VITE_TOKEN_WASM_HASH` in sync with the factory.** This value must equal the
> factory's on-chain `token_wasm_hash` — the WASM the factory actually deploys tokens
> from. That field is set at deployment (`__constructor`) time and can only change through a contract
> upgrade + migrate, so the realistic way they drift apart is a factory upgrade that
> ships without a matching frontend redeploy.
>
> On startup (and every 5 minutes thereafter) the app reads `get_state()` and compares
> the on-chain hash against this variable, showing a red warning banner if they differ.
> Treat that banner as a deployment bug: it is a **safety net for detecting drift, not a
> substitute for updating both in lockstep**. If the check cannot be completed — the RPC
> read fails, or the variable is unset — the app stays silent rather than warning, so a
> missing banner is not by itself proof that the hashes match.

**Getting Pinata credentials:**

1. Sign up at [https://app.pinata.cloud](https://app.pinata.cloud)
2. Go to API Keys → New Key
3. Enable "pinFileToIPFS" permission
4. Copy the API Key and API Secret

#### Step 7: Test Locally

```bash
# Start the development server
npm run dev

# Open http://localhost:5173 in your browser
```

1. Connect your Freighter wallet (make sure it's on testnet)
2. Try creating a test token
3. Verify the transaction on [Stellar Expert](https://stellar.expert/explorer/testnet)

#### Step 8: Deploy Frontend

```bash
# Build for production
npm run build

# Deploy the dist/ folder to your hosting service
```

**Deployment options:**

- **Vercel**: See [docs/deployment-vercel.md](./docs/deployment-vercel.md)
- **Netlify**: Drag and drop the `dist/` folder
- **GitHub Pages**: Use `gh-pages` package
- **Your own server**: Serve the `dist/` folder with nginx/apache

### Mainnet Deployment

⚠️ **Warning**: Mainnet deployment involves real money. Test thoroughly on testnet first!

Before deploying to mainnet, complete the [Mainnet Deployment Checklist](./docs/mainnet-deployment-checklist.md).

The process is identical to testnet, but:

1. Use `--network mainnet` instead of `--network testnet`
2. Fund your account with real XLM (buy from an exchange)
3. Set `VITE_NETWORK=mainnet` in your `.env`
4. Review all parameters carefully before deployment
5. Consider using a hardware wallet for the admin key

### Troubleshooting Deployment

#### Error: "account not found"

Your account doesn't exist on the network yet. Fund it with Friendbot (testnet) or send XLM from an exchange (mainnet).

```bash
# Testnet
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

#### Error: "insufficient balance"

You don't have enough XLM to pay for the transaction.

```bash
# Check balance
stellar account balance deployer --network testnet

# Get more testnet XLM
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

#### Error: "contract already initialized"

The contract has already been initialized. You can't initialize it again. If you need to change parameters, deploy a new contract.

#### Error: "wasm not found"

The WASM hash you provided doesn't exist on the network. Make sure you ran `stellar contract install` first and used the correct hash.

#### Build fails with "target not found"

Add the wasm32 target to Rust:

```bash
rustup target add wasm32-unknown-unknown
```

#### Frontend shows "Misconfiguration Screen"

One or more required environment variables are missing. Check that your `.env` file has:

- `VITE_FACTORY_CONTRACT_ID`
- `VITE_TOKEN_WASM_HASH`

(Pinata credentials are server-side — `PINATA_API_KEY` / `PINATA_API_SECRET` — and
their absence disables uploads with an inline notice rather than this screen.)

Restart the dev server after changing `.env` files.

## Project Structure

```
stellar-forge/
├── contracts/                 # Soroban smart contracts
│   ├── Cargo.toml            # Workspace configuration
│   └── token-factory/        # Token factory contract
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs        # Contract implementation
│           └── test.rs       # Contract tests
├── frontend/                  # React application
│   ├── src/
│   │   ├── components/       # UI components (NetworkSwitcher, TransactionHistory, ...)
│   │   ├── context/          # React contexts (Wallet, Toast, Network)
│   │   ├── services/         # API integrations (stellar, wallet, ipfs)
│   │   ├── hooks/            # React hooks
│   │   ├── config/           # Configuration files
│   │   ├── types/            # TypeScript type definitions
│   │   └── utils/            # Utility functions
│   ├── package.json
│   └── vite.config.ts
├── scripts/                   # Setup scripts
│   └── setup-soroban.sh      # Installs Rust + Stellar CLI + configures testnet
└── README.md
```

## Architecture

StellarForge consists of three main components that work together:

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Browser                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    React Frontend                         │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │ │
│  │  │  UI Layer   │  │   Services   │  │   Wallet SDK    │ │ │
│  │  │ Components  │→ │ stellar.ts   │→ │   Freighter     │ │ │
│  │  │  Forms      │  │ ipfs.ts      │  │   Integration   │ │ │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              ↓                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               ↓
              ┌────────────────┴────────────────┐
              │                                 │
              ↓                                 ↓
┌─────────────────────────┐      ┌─────────────────────────┐
│   Stellar Network       │      │    IPFS (Pinata)        │
│                         │      │                         │
│  ┌──────────────────┐   │      │  ┌──────────────────┐   │
│  │ Factory Contract │   │      │  │ Token Metadata   │   │
│  │  - create_token  │   │      │  │  - Images        │   │
│  │  - mint_tokens   │   │      │  │  - Descriptions  │   │
│  │  - burn          │   │      │  │  - JSON files    │   │
│  │  - set_metadata  │   │      │  └──────────────────┘   │
│  └────────┬─────────┘   │      └─────────────────────────┘
│           │             │
│           ↓             │
│  ┌──────────────────┐   │
│  │ Token Contracts  │   │
│  │ (deployed by     │   │
│  │  factory)        │   │
│  │  - transfer      │   │
│  │  - balance       │   │
│  │  - approve       │   │
│  └──────────────────┘   │
└─────────────────────────┘
```

### Component Interactions

1. **User → Frontend**: User interacts with React UI to create tokens, set metadata, etc.

2. **Frontend → Freighter**: Frontend uses Freighter API to request transaction signatures

3. **Frontend → Stellar Network**: Signed transactions are submitted to Stellar via Soroban RPC

4. **Factory Contract → Token Contracts**: Factory deploys new token contracts using the token WASM hash

5. **Frontend → IPFS**: Token metadata (images, descriptions) are uploaded to IPFS via Pinata

6. **Frontend → Stellar Network**: Metadata URIs (ipfs://...) are stored on-chain via `set_metadata`

### Data Flow Example: Creating a Token

```
1. User fills form → 2. Frontend validates → 3. Freighter signs tx
                                                      ↓
                                            4. Submit to Stellar
                                                      ↓
                                            5. Factory Contract
                                               - Validates params
                                               - Collects fee
                                               - Deploys token
                                                      ↓
                                            6. New Token Contract
                                               - Initialized
                                               - Mints supply
                                                      ↓
                                            7. Event emitted
                                                      ↓
                                            8. Frontend updates UI
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Freighter Wallet Not Detected

**Symptoms**: "Wallet not installed" error or connection button doesn't work

**Solutions**:

- Install [Freighter wallet extension](https://www.freighter.app/)
- Refresh the page after installing
- Check that Freighter is enabled in your browser extensions
- Try a different browser (Chrome, Firefox, Brave, Edge supported)

#### 2. Wrong Network Selected

**Symptoms**: Transactions fail with "account not found" or "contract not found"

**Solutions**:

- Check the network indicator in the top-right corner of the app
- Click the network switcher to toggle between testnet and mainnet
- In Freighter, ensure you're on the same network as the app
- Verify `VITE_NETWORK` in your `.env` matches your deployment

#### 3. Insufficient Balance / Fee Errors

**Symptoms**: "insufficient balance" or "insufficient fee" errors

**Solutions**:

- **Testnet**: Get free XLM from Friendbot:
  ```bash
  curl "https://friendbot.stellar.org?addr=YOUR_ADDRESS"
  ```
- **Mainnet**: Buy XLM from an exchange and send to your wallet
- Check your balance in Freighter wallet
- Ensure you have at least 2-3 XLM for contract interactions
- Fee errors may indicate the factory's fee requirements have increased

#### 4. Transaction Timeout

**Symptoms**: Transaction pending for a long time, then fails

**Solutions**:

- Check Stellar network status at [status.stellar.org](https://status.stellar.org)
- Increase timeout in the code (default is 30 seconds)
- Try submitting the transaction again
- Check if Soroban RPC endpoint is responding:
  ```bash
  curl https://soroban-testnet.stellar.org/health
  ```

#### 5. IPFS Upload Fails

**Symptoms**: "Failed to upload metadata" or IPFS errors

**Solutions**:

- Verify your Pinata API credentials in `.env`
- Check Pinata dashboard for API key status
- Ensure image file is under 10MB
- Try a different image format (PNG, JPG, GIF supported)
- Check Pinata service status at [status.pinata.cloud](https://status.pinata.cloud)

#### 6. Contract Initialization Fails

**Symptoms**: "AlreadyInitialized" error or initialization transaction fails

**Solutions**:

- Contract can only be initialized once
- If you need different parameters, deploy a new contract
- Check if contract is already initialized:
  ```bash
  stellar contract invoke \
    --id <contract-id> \
    --network testnet \
    -- get_state
  ```

#### 7. Token Creation Fails

**Symptoms**: "InvalidTokenParams" or creation transaction fails

**Solutions**:

- Ensure token name is 1-32 characters
- Ensure token symbol is 1-12 characters
- Decimals must be 0-18
- Initial supply must be non-negative
- Check that you have enough XLM to pay the creation fee
- Verify the factory is not paused:
  ```bash
  stellar contract invoke \
    --id <contract-id> \
    --network testnet \
    -- get_state
  ```

#### 8. Metadata Not Displaying

**Symptoms**: Token created but image/description doesn't show

**Solutions**:

- Check that metadata was set (look for `metadata_set` event)
- Verify IPFS URI is accessible:
  ```bash
  curl https://gateway.pinata.cloud/ipfs/<your-cid>
  ```
- Clear browser cache and reload
- Check browser console for CORS or loading errors
- Ensure metadata JSON follows the correct format:
  ```json
  {
    "name": "Token Name",
    "description": "Token description",
    "image": "ipfs://..."
  }
  ```

#### 9. Build Errors

**Symptoms**: `cargo build` or `npm run build` fails

**Solutions**:

- **Rust build fails**:
  ```bash
  rustup update
  rustup target add wasm32-unknown-unknown
  cd contracts && cargo clean && cargo build
  ```
- **Frontend build fails**:
  ```bash
  cd frontend
  rm -rf node_modules package-lock.json
  npm install
  npm run build
  ```
- Check that you're using compatible versions (Node 18+, Rust stable)

#### 10. Events Not Loading

**Symptoms**: Transaction history or token events don't display

**Solutions**:

- Check that Soroban RPC endpoint supports `getEvents`
- Verify contract ID is correct in `.env`
- Check browser console for API errors
- Try refreshing the page
- Ensure you're on the correct network (testnet/mainnet)

### Getting More Help

If you're still experiencing issues:

1. **Check the logs**: Open browser DevTools (F12) and check the Console tab
2. **Search existing issues**: [GitHub Issues](https://github.com/Favourorg/Stellar-forge/issues)
3. **Ask for help**: Create a new issue with:
   - Description of the problem
   - Steps to reproduce
   - Error messages (from browser console and terminal)
   - Your environment (OS, browser, Node version)
4. **Join the community**: Stellar Discord or developer forums

## Security

We take security seriously. If you discover a security vulnerability, please review our [Security Policy](SECURITY.md) for responsible disclosure guidelines.

### Content Security Policy (CSP)

A strict CSP is defined as a `<meta>` tag in `frontend/index.html` (all configs are generated from `frontend/src/csp/policy.ts` via `npm run prebuild`):

```
default-src 'self';
connect-src 'self' https://*.stellar.org https://api.pinata.cloud;
img-src 'self' data: https://gateway.pinata.cloud;
script-src 'self'
```

> **Security hardening** — the `style-src` directive is locked to `'self'` (no `'unsafe-inline'`). Tailwind CSS v4 generates all styles at build time, and the three remaining inline style usages in the codebase have been migrated to static classes and CSSOM-based dynamic updates. The `ProgressBar` component uses a CSSOM ref to set its fill width, which is permitted by CSP-level 3 without requiring `'unsafe-inline'`.

For stronger enforcement, set the CSP as an HTTP response header on your hosting provider instead of (or in addition to) the meta tag — HTTP headers take precedence and support more directives like `frame-ancestors`.

**Vercel** — add to `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; connect-src 'self' https://*.stellar.org https://api.pinata.cloud; img-src 'self' data: https://gateway.pinata.cloud; script-src 'self'"
        }
      ]
    }
  ]
}
```

**Netlify** — add to `netlify.toml`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; connect-src 'self' https://*.stellar.org https://api.pinata.cloud; img-src 'self' data: https://gateway.pinata.cloud; script-src 'self'"
```

**Nginx** — add to your server block:

```nginx
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.stellar.org https://api.pinata.cloud; img-src 'self' data: https://gateway.pinata.cloud; script-src 'self'";
```

For users deploying tokens, we strongly recommend:

- Always test on testnet first before mainnet deployment
- Review all parameters carefully using the [Mainnet Deployment Checklist](./docs/mainnet-deployment-checklist.md)
- Verify contract addresses and transaction details before signing

## Fee Bump Transactions

If a user's XLM balance is too low to cover the network base fee, their transaction will fail. Stellar's [fee bump](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/fee-bump-transactions) mechanism lets a third-party account (the _fee source_) pay the base fee on behalf of the original sender.

### When to use fee bumps

- The inner transaction's source account has near-zero XLM.
- You want to sponsor fees for users as part of your application UX.
- Resubmitting a stuck transaction with a higher fee without re-signing the inner envelope.

### How it works in StellarForge

Two utilities are exported from `frontend/src/services/stellar.ts`:

```ts
// 1. Wrap a signed inner transaction in a fee bump envelope.
//    The fee-source account (connected via Freighter) signs the bump.
const signedFeeBumpXdr = await buildFeeBumpTransaction(innerTxXdr, feeSourceAddress)

// 2. Submit the fee bump and wait for confirmation.
const txHash = await submitFeeBumpTransaction(signedFeeBumpXdr)
```

The fee source must have enough XLM to cover the base fee. The inner transaction is not re-signed — only the fee bump envelope requires the fee source's signature.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development setup and contribution guidelines.

## Architecture Decision Records

Key architectural decisions are documented in [`docs/adr/`](./docs/adr/):

- [ADR-001: Choice of Stellar / Soroban for smart contracts](./docs/adr/ADR-001-stellar-soroban.md)
- [ADR-002: Freighter wallet integration](./docs/adr/ADR-002-freighter-wallet.md)
- [ADR-003: Pinata for IPFS metadata storage](./docs/adr/ADR-003-pinata-ipfs.md)
- [ADR-004: React + Vite + TypeScript for frontend](./docs/adr/ADR-004-react-vite-typescript.md)

## Contract Upgrade Process

The factory contract supports in-place WASM upgrades without redeploying or migrating state. Since schema version 5 the swap is **two-step and timelocked**: `propose_upgrade` starts a ~28.8-hour clock, `execute_upgrade` completes the swap after it, and `cancel_upgrade` aborts a proposal at any point in between. There is no single-step `upgrade` entrypoint.

### Schema versioning

`FactoryState` carries a `schema_version: u32` field. The constant `CURRENT_SCHEMA_VERSION` in `lib.rs` is the source of truth. `__constructor` stamps the current version on every fresh deployment. `migrate` reads the on-chain version from a standalone `"sv"` storage key and applies each pending upgrade step in order, making it safe to call multiple times (idempotent).

| Version | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Initial versioned schema — added `schema_version` field to `FactoryState`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2       | Max-supply accounting fix (issue #1006) — `deploy_one` now seeds the per-token supply counter with `initial_supply`; version bump only, no `FactoryState` field changes. Pre-fix capped tokens must be back-filled individually via `backfill_capped_supply` (see [docs/contract-abi.md](./docs/contract-abi.md#supply-cap-accounting))                                                                                                                                                                     |
| 3       | Persistent-storage migration (issue #1007) — per-token bookkeeping (`TokenInfo`, `TokenIndex`, `Metadata`, `owner`, `supply`, `CreatorTokens`) moves out of the shared `instance` ledger entry into `persistent` storage, keeping `instance` storage O(1) in `token_count`. `TokenInfo` migrates in bounded, resumable chunks per `migrate` call; everything else migrates lazily on next access (see [docs/contract-abi.md](./docs/contract-abi.md#storage-architecture))                                  |
| 4       | Two-step admin rotation — added `pending_admin: Option<Address>` and `pending_admin_expiry: Option<u64>` to `FactoryState`; new `propose_admin`, `accept_admin`, `cancel_admin_proposal` entrypoints; `transfer_admin` and `update_admin` now delegate to `propose_admin` (no single-step rotation path remains). New error codes 26 (`NoPendingProposal`) and 27 (`ProposalExpired`). New events `adm_prop`, `adm_acc`, `adm_can`, and `adm_dep` (emitted by the deprecated aliases alongside `adm_prop`). |
| 5       | Two-step upgrade timelock (issue #6) — added `pending_upgrade_hash: Option<BytesN<32>>` and `pending_upgrade_ready_at: Option<u64>` to `FactoryState`; replaced single-step `upgrade` with `propose_upgrade`, `execute_upgrade`, and `cancel_upgrade`; `execute_upgrade` enforces `UPGRADE_TIMELOCK_LEDGERS` (~28.8 hours) between proposal and execution. New error codes 28 (`UpgradeNotReady`), 29 (`NoUpgradePending`), 30 (`UpgradeHashMismatch`). New events `upg_prop`, `upg_exec`, `upg_can`.       |

### Adding a new migration (version N → N+1)

1. Increment `CURRENT_SCHEMA_VERSION` in `lib.rs` to `N+1`.
2. Add an `if on_chain_version < N+1 { … }` block inside `migrate` that reads the current state, sets new fields to their defaults, writes the updated state, **bumps `on_chain_version` to `N+1`**, and writes the updated `sv` key. The bump must happen inside the block, before the next block's guard runs — this is what allows a contract that is multiple versions behind to walk through every pending step in a single `migrate` call.

   ```rust
   // Example: adding version 2
   if on_chain_version < 2 {
       let mut s = Self::load_state(&env)?;
       s.new_field = default_value;   // initialise any new FactoryState fields
       Self::save_state(&env, &s);
       on_chain_version = 2;          // ← bump BEFORE the next if-block is evaluated
       env.storage().instance().set(&sv_key, &on_chain_version);
   }
   ```

   > **Critical:** `on_chain_version` is a `mut` local variable. Each block must assign the new version back to it after writing to storage. If you forget the in-place bump, the next `if on_chain_version < N+2` block will compare against the _original_ value read at the top of `migrate`, not the value just written — causing steps to run out of order or be skipped entirely on a multi-version catch-up.

3. Add tests in `test.rs` that:
   - Seed `sv = N-1` (or 0) and assert `migrate` walks through _all_ pending steps in one call, ending at `CURRENT_SCHEMA_VERSION`.
   - Seed `sv = N` and confirm only the N → N+1 step runs (earlier steps are skipped).
   - Call `migrate` twice at the final version and assert it is a no-op (idempotent).

### How it works

The factory contract uses a mandatory two-step upgrade flow with a ~28-hour timelock between proposal and execution. This is an active security control: an upgrade proposed by a compromised admin key can be cancelled by the legitimate team before it takes effect.

1. Build and optimize the new contract WASM.
2. Upload the new WASM to the network to obtain its hash:
   ```bash
   stellar contract upload \
     --wasm target/wasm32-unknown-unknown/release/token_factory.optimized.wasm \
     --source <admin-secret-key> \
     --network testnet
   # Outputs: <new-wasm-hash>
   ```
3. Propose the upgrade (step 1 of 2). Records the hash and starts the timelock clock. Emits `upg_prop`:
   ```bash
   stellar contract invoke \
     --id <contract-id> \
     --source <admin-secret-key> \
     --network testnet \
     -- propose_upgrade \
     --admin <admin-address> \
     --new_wasm_hash <new-wasm-hash>
   ```
4. **Wait** approximately 17,280 ledgers (~28.8 hours). `execute_upgrade` will fail with `Error::UpgradeNotReady` before this delay has elapsed.
5. Execute the upgrade (step 2 of 2). Performs the WASM swap; only succeeds once the delay has elapsed **and** the hash matches exactly. Emits `upg_exec`:
   ```bash
   stellar contract invoke \
     --id <contract-id> \
     --source <admin-secret-key> \
     --network testnet \
     -- execute_upgrade \
     --admin <admin-address> \
     --new_wasm_hash <new-wasm-hash>
   ```
6. If the new version requires data layout changes, call `migrate` immediately after:
   ```bash
   stellar contract invoke \
     --id <contract-id> \
     --source <admin-secret-key> \
     --network testnet \
     -- migrate \
     --admin <admin-address>
   ```

To abort a pending upgrade at any time before execution, use `cancel_upgrade` (emits `upg_can`):

```bash
stellar contract invoke \
  --id <contract-id> \
  --source <admin-secret-key> \
  --network testnet \
  -- cancel_upgrade \
  --admin <admin-address>
```

Only the admin address can call `propose_upgrade`, `execute_upgrade`, `cancel_upgrade`, and `migrate`. Non-admin callers receive `Error::Unauthorized`. Contract state (tokens, fees, admin) is fully preserved across upgrades.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This software is for educational and development purposes. Always test thoroughly on testnet before mainnet deployment. The authors are not responsible for any financial losses incurred through the use of this software.
