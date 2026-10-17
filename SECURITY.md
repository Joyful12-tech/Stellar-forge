# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in StellarForge, please **do not** open a public GitHub issue.

Instead, report it privately using one of the following channels:

1. **GitHub private security advisory** — open a [private advisory](https://github.com/Favourorg/Stellar-forge/security/advisories/new) in this repository.
2. **Email** — send details to `security@stellarforge.app` with the subject line `[SECURITY] <brief description>`.

Please include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept code or exploit path).
- Affected contract addresses or frontend versions.
- Your suggested severity (Critical / High / Medium / Low).

We will acknowledge your report within **72 hours** and provide an estimated fix timeline within **7 days**. Please allow us a reasonable time to patch and deploy a fix before public disclosure.

## Scope

| Component                                                        | In scope                             |
| ---------------------------------------------------------------- | ------------------------------------ |
| Token factory Soroban contract (mainnet + testnet)               | ✅                                   |
| React frontend (wallet integration, transaction flow)            | ✅                                   |
| IPFS / Pinata integration                                        | ✅                                   |
| Admin key custody and access controls                            | ✅                                   |
| Dependency vulnerabilities with active exploit paths             | ✅                                   |
| Third-party services (Stellar network itself, Pinata, Freighter) | ❌ — report to the respective vendor |
| Theoretical issues with no practical exploit path                | ❌                                   |

## Severity definitions

| Severity     | Description                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Critical** | Remote code execution, admin key theft, total loss of funds, contract upgrade to attacker WASM |
| **High**     | Partial fund loss, admin privilege escalation, persistent denial of service                    |
| **Medium**   | Temporary DoS, fee manipulation without fund loss, user-data leakage                           |
| **Low**      | Minor information disclosure, UX security issues                                               |

## Incident response

For details on how the team responds to a confirmed security incident — including the procedure for a compromised admin key, the break-glass recovery mechanism, and user communication templates — see the [Incident Response Runbook](./docs/incident-response.md).

## Disclosure policy

- We follow a **90-day coordinated disclosure** timeline.
- If a fix cannot be delivered within 90 days, we will publish a mitigation advisory and negotiate an extension with the reporter.
- We will credit reporters in the security advisory unless they request anonymity.
- We do not offer a bug-bounty programme at this time, but we genuinely appreciate responsible disclosures and will acknowledge all valid reports publicly.

## Known security considerations

### Admin key is a single point of trust

The factory contract's `admin` address holds **factory-wide** authority. Every entrypoint below enforces the same path in `contracts/token-factory/src/lib.rs`: `admin.require_auth()` **plus** an identity check against `state.admin`. No other entrypoint gates on `state.admin` — `accept_admin` writes it and the view functions read it, but neither uses it to authorize a privileged action.

| A compromised admin key can                                | Entrypoint(s)                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace the contract WASM (two-step, timelocked)           | `propose_upgrade`, `execute_upgrade`, `cancel_upgrade`                                                                                               |
| Run a state migration                                      | `migrate`                                                                                                                                            |
| Change the creation and metadata fees                      | `update_fees`                                                                                                                                        |
| Redirect fee revenue away from the treasury                | `set_fee_split`                                                                                                                                      |
| Halt or resume the factory                                 | `pause` / `unpause`                                                                                                                                  |
| Turn the creation whitelist on/off and edit its membership | `set_whitelist_enabled`, `add_to_whitelist`, `remove_from_whitelist`                                                                                 |
| Rewrite a capped token's tracked supply, once per token    | `backfill_capped_supply`                                                                                                                             |
| Propose or cancel an admin rotation                        | `propose_admin`, `cancel_admin_proposal` (the deprecated `transfer_admin` / `update_admin` aliases reach this only by delegating to `propose_admin`) |

**It cannot rewrite any token's metadata.** Metadata authority is **per-token and creator-scoped**: `set_metadata` compares the caller against the creator recorded under that token's `owner` key, never against `state.admin`. The parameter is conventionally named `admin` in the call signature, but it means _the token's_ admin — its original creator. A factory admin who did not create a token cannot touch its metadata, and `Error::Unauthorized` is what they get if they try. The identical creator-scoped check gates three further entrypoints — `freeze_metadata`, `mint_tokens` and `set_burn_enabled` — so a compromised admin key cannot mint supply or alter a token's burn flag either. In full, what the admin key does **not** reach:

| Not available to the factory admin | Entrypoint(s)                         | Who is authorized                    |
| ---------------------------------- | ------------------------------------- | ------------------------------------ |
| Set or update a token's metadata   | `set_metadata`                        | that token's creator                 |
| Freeze a token's metadata          | `freeze_metadata`                     | that token's creator                 |
| Mint new supply                    | `mint_tokens`                         | that token's creator                 |
| Toggle a token's burn flag         | `set_burn_enabled`                    | that token's creator                 |
| Burn tokens                        | `burn`                                | the holder, for their own balance    |
| Create tokens                      | `create_token`, `create_tokens_batch` | any caller, subject to the whitelist |
| Complete an admin rotation         | `accept_admin`                        | the proposed successor only          |

Metadata writes remain subject to the `metadata_fee` gate, `ipfs://` URI validation, and the per-token freeze/version cap — but those are constraints on the _creator_, not powers of the admin.

**One caveat for incident scoping:** the upgrade path is an escalation path. A compromised admin key cannot rewrite metadata under the deployed contract, but it can install attacker-controlled WASM that grants itself any authority it likes. Treat "metadata is safe" as true for the _current_ code and false the moment a malicious upgrade lands. The two-step timelock (below) is what turns that from an atomic surprise into a ~28.8-hour window you can act inside — but only if someone is actually alerting on `upg_prop`.

Key custody is documented in the [Mainnet Deployment Checklist](./docs/mainnet-deployment-checklist.md). A compromised admin key is a **Critical** severity event; see the [Incident Response Runbook](./docs/incident-response.md) for the response procedure.

### Upgrades are two-step and timelocked (issues #9, #1094, #6)

The single-step `upgrade` entrypoint no longer exists. Replacing the factory WASM now takes
three separate admin calls, and every stage emits an on-chain event:

| Step | Entrypoint        | Event      | Effect                                                                                 |
| ---- | ----------------- | ---------- | -------------------------------------------------------------------------------------- |
| 1    | `propose_upgrade` | `upg_prop` | Records the candidate hash and a `ready_at` ledger. **No WASM change yet.**            |
| 2    | `execute_upgrade` | `upg_exec` | Swaps the WASM — only after the timelock elapses and only for the exact proposed hash. |
| —    | `cancel_upgrade`  | `upg_can`  | Withdraws a pending proposal. Available at any point before step 2.                    |

`UPGRADE_TIMELOCK_LEDGERS` (~17,280 ledgers ≈ 28.8 hours) separates step 1 from step 2, so a
compromised admin key can no longer swap in attacker WASM atomically — the proposal is public
the moment it lands, and the legitimate holder of the key can `cancel_upgrade` inside the window.

**Only `upg_exec` means the deployed code changed.** A `upg_prop` with no matching `upg_exec`
was cancelled or left to expire; do not treat the proposal alone as an upgrade.

This supersedes the previous guidance that WASM-hash polling was the _only_ way to detect a
malicious replacement. Alerting on `upg_prop` is now the primary signal; polling remains a
defense-in-depth layer. Both are documented in the
[Incident Response Runbook](./docs/incident-response.md#23-upgrade-event-monitoring-primary-signal).

### Admin rotation takes two transactions (issue #1159)

`propose_admin` records a successor; only `accept_admin`, signed by that successor, actually rotates the admin, and the proposal expires after ~28.8 hours. The `transfer_admin` and `update_admin` names are **deprecated aliases** that delegate to `propose_admin` — they used to rotate in one transaction and no longer do. To make that downgrade impossible to miss, they return an `AdminRotationReceipt` with `rotation_complete: false` instead of `void`, and emit an `adm_dep` event naming the deprecated entrypoint alongside the usual `adm_prop`.

The operational hazard is retiring the outgoing key while a proposal is merely pending: if `accept_admin` never lands, the proposal expires, the factory stays under the old key, and there is no guardian override or timelock bypass — governance is lost permanently. The rotation procedure is in the [Mainnet Deployment Checklist](./docs/mainnet-deployment-checklist.md#admin-key-rotation); stale pending proposals are monitored by `scripts/check-pending-admin-proposal.sh` ([runbook §2.6](./docs/incident-response.md#26-stale-pending-admin-proposals)).

### IPFS unpin requires CID ownership (issue #1155)

`POST /api/ipfs/unpin` requires more than a valid JWT: any wallet can obtain one for free via the challenge/response flow, so JWT possession alone does not prove a right to delete someone else's pinned content. The endpoint additionally checks the requesting wallet address against an ownership record captured at upload time (`api/_lib/pinOwnership.ts`, populated by `upload-json.ts` / `upload-file.ts`). A CID with no ownership record on file is **denied by default** — it is never treated as unpinnable-by-anyone. See `api/ipfs/unpin.ts` and its regression tests in `api/ipfs/unpin.test.ts`.

### Content Security Policy

A strict CSP is enforced both as a `<meta>` tag and via HTTP response headers on the hosted deployment. See the [README](./README.md#content-security-policy-csp) for configuration details.
