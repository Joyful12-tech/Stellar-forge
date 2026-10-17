# Mainnet Deployment Checklist

Use this checklist before promoting Stellar Forge from testnet to mainnet. Mainnet actions can move real funds, so keep a deployment owner, an approver, and a rollback owner available until smoke tests pass.

## Tagging Convention

Every mainnet deployment **must** be accompanied by a signed, annotated git tag so the WASM verification workflow can prove the on-chain bytecode matches the reviewed source.

- Tag format: `contract-v<MAJOR>.<MINOR>.<PATCH>` (e.g., `contract-v1.0.0`).
- The tag **must** point to the exact commit whose `contracts/token-factory/src/lib.rs` was reviewed and approved for deployment.
- Create the tag **before** deploying:
  ```bash
  # If you have a GPG key configured (recommended):
  git tag -s contract-v1.0.0 -m "Token Factory v1.0.0 — mainnet deployment"
  # Or, if GPG signing is not available:
  git tag -a contract-v1.0.0 -m "Token Factory v1.0.0 — mainnet deployment"
  git push origin contract-v1.0.0
  ```

## Pre-Deployment

- [ ] Confirm the latest contract code has completed audit or peer security review, and document any accepted risks.
- [ ] Resolve or explicitly defer all high and medium audit findings before signing mainnet transactions.
- [ ] Create the release git tag following the [Tagging Convention](#tagging-convention) above.
- [ ] Build the release WASM with production optimizations enabled and record the final artifact hash.
- [ ] Run the [WASM Hash Verification workflow](https://github.com/Favourorg/Stellar-forge/actions/workflows/wasm-verify.yml) against the deployment tag **after** the contract is deployed to confirm the on-chain bytecode matches the reviewed source commit. Do not rely solely on a manual hash comparison.
- [ ] Verify the optimized WASM hash matches the value configured for the frontend and deployment scripts.
- [ ] Review fee configuration, including base fees, token creation fees, treasury account, and expected transaction cost.
- [ ] Fund the deployer, treasury, and any operational accounts with the minimum mainnet XLM needed for deployment and reserves.
- [ ] Confirm admin keys are stored securely, preferably using a hardware wallet, multisig policy, or offline key custody process.
- [ ] Remove private keys, admin secrets, and mainnet credentials from local shell history, logs, screenshots, and committed files.

## Configuration

- [ ] Set `VITE_NETWORK=mainnet` and confirm no testnet network passphrase, RPC URL, or Friendbot reference remains.
- [ ] Verify `VITE_FACTORY_CONTRACT_ID`, `VITE_TOKEN_WASM_HASH`, and Pinata/IPFS configuration point to production values.
- [ ] Confirm `VITE_TOKEN_WASM_HASH` equals the factory's on-chain `token_wasm_hash` (`stellar contract invoke --id <factory> -- get_state`). If the factory is being upgraded in this release, the frontend must be redeployed with the new hash in the same release window.
- [ ] Confirm Content Security Policy headers allow only the required Stellar, Pinata, and application origins.
- [ ] Review deployment hosting settings, environment variables, redirects, and security headers before publishing.
- [ ] Confirm the Vercel project's **Root Directory is the repo root**, not `frontend/`. The serverless functions live in `api/` at the repo root, so a project rooted at `frontend/` ships none of them and every `/api/*` call 404s.
- [ ] Run `npm run check:vercel-cron` and confirm it passes. Vercel schedules cron jobs **only** from the `crons` array in the deployed project's `vercel.json`; without the `/api/cron/index-tokens` entry the indexer never runs, `/api/health/indexer` stays `healthy: false`, and nothing else breaks visibly because the frontend falls back to direct RPC (see [issue #1090](https://github.com/Favourorg/Stellar-forge/issues/1090) and [docs/indexer.md](./indexer.md#deployment)). The same check runs in CI.
- [ ] If the indexer is enabled, confirm `CRON_SECRET` is set in the Vercel project — the cron endpoint fails closed with 401 in production without it, which looks identical to the cron never firing.
- [ ] Set `JWT_SECRET`, `VERCEL_KV_REST_API_URL` and `VERCEL_KV_REST_API_TOKEN`, then confirm `GET /api/health/auth` returns 200 with `durable: true`. A 503 with `store: "in-memory"` means the wallet-auth challenge store is per-instance: challenges issued by one serverless instance cannot be verified by another, so logins fail intermittently for correct clients and every authenticated IPFS upload fails with them (see [issue #1091](https://github.com/Favourorg/Stellar-forge/issues/1091)). The same store backs upload rate limiting, which is likewise per-instance without it.

## Deployment

- [ ] Deploy and initialize the factory **atomically** — `initialize` runs as the contract's `__constructor`, so `scripts/deploy-contract.sh` (or an equivalent `stellar contract deploy --wasm ... -- --admin ... --treasury ... --fee_token ... --token_wasm_hash ... --base_fee ... --metadata_fee ...` invocation) deploys and initializes in a single transaction. Never deploy the WASM and initialize it as two separate transactions — that reopens a front-running window where an attacker's `initialize` call could win the race and seize the admin role (see the [Token Factory front-running writeup](https://github.com/Favourorg/Stellar-forge/issues/1005)).
- [ ] Immediately after deployment, run `stellar contract invoke --id <contract-id> --network mainnet -- get_state` and confirm the returned `admin` field is **exactly** the intended admin address before publishing the contract ID anywhere (frontend `.env`, docs, service-worker cache key, announcements). `scripts/deploy-contract.sh` performs this check automatically and aborts if it fails.
- [ ] If upgrading an existing factory (not a fresh deploy), call `migrate` immediately after `execute_upgrade` to apply schema version 5 (adds `pending_upgrade_hash` / `pending_upgrade_ready_at` to `FactoryState`). Confirm `get_state().schema_version == 5` before proceeding.

## Contract Upgrade Procedure (two-step timelock)

**Upgrading the factory WASM now requires two transactions separated by a mandatory ~28-hour waiting period.** This is an active security control — not a procedural suggestion. An upgrade proposed by a compromised admin key can be cancelled by the legitimate team within the waiting window.

- [ ] 1. Build and optimize the new contract WASM. Run the [WASM Hash Verification workflow](https://github.com/Favourorg/Stellar-forge/actions/workflows/wasm-verify.yml) against the new release tag to confirm the on-chain bytecode will match the reviewed source.
- [ ] 2. Upload the WASM to the network and record its hash:
     ```bash
     stellar contract upload \
       --wasm target/wasm32-unknown-unknown/release/token_factory.optimized.wasm \
       --source <admin-key> --network mainnet
     # → <new-wasm-hash>
     ```
- [ ] 3. Call `propose_upgrade` with the new hash:
     ```bash
     stellar contract invoke --id <factory-id> --source <admin-key> --network mainnet \
       -- propose_upgrade --admin <admin-address> --new_wasm_hash <new-wasm-hash>
     ```
     Confirm the `upg_prop` event appears on-chain with `ready_at` approximately 17,280 ledgers (~28.8 hours) in the future.
- [ ] 4. Announce the pending upgrade publicly (Discord, status page, Twitter/X) so the community can review the proposed WASM hash during the waiting window. Include the `ready_at` ledger sequence and the new WASM hash.
- [ ] 5. **Wait** until the current ledger sequence ≥ `ready_at`. Do not skip this step — `execute_upgrade` will fail with `UpgradeNotReady` before then.
- [ ] 6. If anything looks wrong during the waiting period, call `cancel_upgrade` immediately:
     ```bash
     stellar contract invoke --id <factory-id> --source <admin-key> --network mainnet \
       -- cancel_upgrade --admin <admin-address>
     ```
     Confirm the `upg_can` event on-chain.
- [ ] 7. Call `execute_upgrade` with the **same** hash that was proposed:
     ```bash
     stellar contract invoke --id <factory-id> --source <admin-key> --network mainnet \
       -- execute_upgrade --admin <admin-address> --new_wasm_hash <new-wasm-hash>
     ```
     Confirm the `upg_exec` event on-chain.
- [ ] 8. Call `migrate` immediately after to advance the schema version:
     ```bash
     stellar contract invoke --id <factory-id> --source <admin-key> --network mainnet \
       -- migrate --admin <admin-address>
     ```
- [ ] 9. Verify `get_state().schema_version == CURRENT_SCHEMA_VERSION` and `get_state().token_wasm_hash == <new-wasm-hash>`.
- [ ] 10. Update `EXPECTED_HASH` in `check-wasm-hash.sh` and redeploy the monitoring script.
- [ ] 11. If the factory upgrade also changes the token contract WASM hash, redeploy the frontend with the updated `VITE_TOKEN_WASM_HASH` in the same release window.

## Release Validation

- [ ] Run a complete smoke test on testnet using the same deployment steps planned for mainnet.
- [ ] Test token creation, metadata upload, minting, burning, transfer, and wallet connection flows on testnet.
- [ ] Prepare a rollback plan that names the last known-good frontend deployment, contract IDs, owner, and rollback command.
- [ ] Save deployment transaction hashes, contract IDs, WASM hashes, and release notes in the deployment log.
- [ ] After mainnet deployment, verify contract state, transaction history, and frontend reads against Stellar Explorer.
- [ ] Load the deployed frontend against mainnet and confirm **no token-contract mismatch banner** appears. The app compares the factory's on-chain `token_wasm_hash` against `VITE_TOKEN_WASM_HASH` at startup; a red banner means the frontend build and the factory disagree about which token contract is being deployed. The check stays silent when it cannot complete (RPC read failure, or the variable unset), so pair this with the config verification above rather than relying on the absent banner alone.
- [ ] Run the [WASM Hash Verification workflow](https://github.com/Favourorg/Stellar-forge/actions/workflows/wasm-verify.yml) as the final post-deployment check, using the deployment tag as `git_ref` and the new factory contract ID. The job must pass before the deployment is considered complete.
- [ ] Monitor application errors, failed transactions, fee spikes, and user-reported issues during the release window.

## Incident Readiness

These items must be verified before the factory is accessible to end users on mainnet. A deployed contract is only as safe as the team's ability to respond when things go wrong.

- [ ] Read the [Incident Response Runbook](./incident-response.md) in full and confirm the team understands every section.
- [ ] Break-glass admin address is generated, funded with at least 5 XLM, and recorded in the deployment log (see [runbook section 7](./incident-response.md#7-break-glass-recovery-mechanism)).
- [ ] **Verify break-glass account access before any incident:** confirm you can sign a transaction from the break-glass key. Emergency admin rotation now requires two transactions — `propose_admin` from the compromised key AND `accept_admin` from the break-glass key — so both keys must be accessible simultaneously (see [runbook step 4](./incident-response.md#4-immediate-response-first-five-minutes)).
- [ ] On-chain event monitoring for `adm_prop` (rotation proposed), `adm_acc` (rotation completed) and `adm_dep` (rotation proposed through a deprecated alias) is configured and alerting. An unexpected `adm_prop` event is actionable: the current admin can cancel via `cancel_admin_proposal` before `accept_admin` is called. An `adm_dep` event means some caller still uses `transfer_admin` / `update_admin` and may assume the rotation is already complete — track it down.
- [ ] Stale-proposal monitoring script (`check-pending-admin-proposal.sh`) is deployed on a cron schedule (≤ 15 minutes) and confirmed to alert well inside the ~28.8-hour proposal TTL (see [runbook section 2.5](./incident-response.md#25-stale-pending-admin-proposals)).
- [ ] WASM hash monitoring script (`check-wasm-hash.sh`) is deployed on a cron schedule (≤ 5 minutes) and confirmed to send alerts.
- [ ] On-chain event monitoring for `upg_prop` (upgrade proposed), `upg_exec` (upgrade executed), and `upg_can` (upgrade cancelled) is configured and alerting. An unexpected `upg_prop` event is actionable: the current admin can abort via `cancel_upgrade` at any time before the `ready_at` ledger. An unexpected `upg_exec` event means the admin key is compromised; escalate immediately.
- [ ] Sentry alert rules for mainnet anomalous-fee events and admin rotation events are active (see [runbook section 2](./incident-response.md#2-how-compromise-would-be-detected)).
- [ ] Incident commander and break-glass custodian contact details are documented in the team's private channel, not in this file.
- [ ] Tabletop exercise (runbook section 10) has been completed and dated in the deployment log.

## Admin Key Rotation

**Every admin rotation takes two transactions. The first one changes nothing.** Work through these in order — steps 4 and 5 are what make the rotation real, and step 6 is the only thing that authorises retiring the outgoing key.

- [ ] 1. Confirm the **incoming** key can sign on mainnet (submit any trivial transaction from it). A key that cannot sign cannot call `accept_admin`, and the rotation will lapse.
- [ ] 2. Confirm the incoming key's custodian is available **now** and knows a proposal is coming. Acceptance must happen within `ADMIN_PROPOSAL_TTL_LEDGERS` — 17,280 ledgers, ~28.8 hours — or the proposal expires.
- [ ] 3. From the **current** admin key, call `propose_admin --current_admin <old> --new_admin <new>`.
     Do **not** use `transfer_admin` / `update_admin`: they are deprecated aliases that delegate to `propose_admin`, return `rotation_complete: false`, and emit `adm_dep` precisely because they do not finish the job ([issue #1159](https://github.com/Favourorg/Stellar-forge/issues/1159)).
- [ ] 4. Verify the proposal was recorded: `get_state()` shows `pending_admin = <new>` and a `pending_admin_expiry` in the future. Note the expiry ledger.
- [ ] 5. From the **new** admin key, call `accept_admin --new_admin <new>`. This is the transaction that actually rotates the admin.
- [ ] 6. **Verify before decommissioning anything:** `get_state()` shows `admin = <new>` **and** `pending_admin = null`, and the transaction emitted `adm_acc`. Until both are true, the factory is still controlled by the old key.
- [ ] 7. Only after step 6 passes, retire the old key. Retiring it earlier — while a proposal is merely pending — means that if `accept_admin` never lands, the proposal expires and **nobody can ever administer the factory again**: no guardian override, no timelock bypass, and re-proposing requires the key you just destroyed.
- [ ] 8. If the window is going to lapse, call `cancel_admin_proposal` from the current admin and restart from step 1 rather than letting it expire unnoticed. `check-pending-admin-proposal.sh` (above) is what tells you this is happening.

> The same sequence applies to emergency rotation to the break-glass address — see [runbook section 7.4](./incident-response.md#74-activating-the-break-glass-account).

> See [SECURITY.md](../SECURITY.md) for the responsible disclosure policy and further security context.
