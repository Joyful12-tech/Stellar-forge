# Tasks: Soroban Token SDK / Token WASM Audit

## Status: CLOSED — all tasks complete

Resolved via Issue 25. See [`requirements.md`](./requirements.md) for context and [`design.md`](./design.md) for approach.

---

## Completed tasks

### Task 1 — Investigate current state ✅

- Read `README.md`, `docs/mainnet-deployment-checklist.md`, and `.kiro/specs/soroban-token-sdk-audit/`
- Grep all `audit` and `wasm` references across the repository
- Read `contracts/token-factory/Cargo.toml` for SDK version
- Read `scripts/deploy-contract.sh` to confirm token WASM installation is a manual step

**Finding**: The word "audited" was not present in the current README, but no provenance document existed, and the mainnet checklist had no WASM-specific audit gate. The spec stub contained only a `.config.kiro` file.

### Task 2 — Determine token WASM provenance ✅

- Source: `stellar/soroban-examples` — `token/target/wasm32-unknown-unknown/release/soroban_token_contract.wasm`
- Interface: SEP-41 (Soroban Token Interface)
- SDK versions: `soroban-sdk = "26.1.0"`, `soroban-token-sdk = "26.1.0"`
- Maintainer: Stellar Development Foundation
- Audit status: Not independently audited by this project; reference implementation with internal SDF review

### Task 3 — Confirm README.md has no unsourced audit claims ✅

Step 4 in the deployment guide already contained the correct provenance notice:

- Pinned-tag instruction (do NOT use `main`)
- Reference to `docs/token-wasm-provenance.md`
- Explicit statement that the project has not commissioned an independent audit
- Recommendation for professional audit for high-value deployments

No unsourced "audited" claims found. No change required to README.md.

### Task 4 — Create `docs/token-wasm-provenance.md` ✅

Created [`docs/token-wasm-provenance.md`](../../docs/token-wasm-provenance.md) with:

- Explanation of the `token_wasm_hash` security dependency
- Upstream source table (repository, path, interface, SDK version)
- Honest audit status declaration
- Four-step pre-mainnet checklist for deployers
- Deployment log table template (testnet + mainnet rows)
- Upgrade path for future audit completion
- Links to related documents

### Task 5 — Update `docs/mainnet-deployment-checklist.md` ✅

Added explicit line item to the Pre-Deployment section:

> **Token WASM provenance and audit status**: Confirm the WASM identified by `VITE_TOKEN_WASM_HASH` has a documented source (upstream tag/commit), a verified on-chain hash, and a recorded audit status or explicit risk-acceptance decision. See `docs/token-wasm-provenance.md` and fill in the mainnet row of the deployment log before proceeding.

This ensures the audit question cannot be silently skipped in future deployments.

### Task 6 — Backfill this spec ✅

- Created `requirements.md` — problem statement, requirements, acceptance criteria, resolution
- Created `design.md` — approach, document structure, security model, future work
- Created `tasks.md` (this file) — implementation record

### Task 7 — Branch, commit, push

See git history for commit details.

---

## Files changed

| File                                                  | Change                                                    |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `docs/token-wasm-provenance.md`                       | Created — definitive provenance and audit status document |
| `docs/mainnet-deployment-checklist.md`                | Updated — added WASM provenance audit line item           |
| `README.md`                                           | Already correct — no changes required                     |
| `.kiro/specs/soroban-token-sdk-audit/requirements.md` | Created — this spec's requirements                        |
| `.kiro/specs/soroban-token-sdk-audit/design.md`       | Created — this spec's design                              |
| `.kiro/specs/soroban-token-sdk-audit/tasks.md`        | Created — this file                                       |

# Tasks: Soroban Token SDK Security Audit

- [ ] 1. Execute full cargo-audit check on contracts workspace
- [ ] 2. Run fuzz targets for 1,000,000 runs (`cargo fuzz run fuzz_fee_arithmetic` and `fuzz_set_metadata`)
- [ ] 3. Audit Soroban auth model and storage TTL management
- [ ] 4. Publish security audit findings report
