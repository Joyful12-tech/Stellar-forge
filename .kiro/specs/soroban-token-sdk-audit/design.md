# Design: Soroban Token SDK / Token WASM Audit

## Status: CLOSED — resolved by documentation

See [`requirements.md`](./requirements.md) for background and resolution summary.

---

## Approach

The gap identified in Issue 25 was a documentation deficit, not a missing code feature. The design decision was to close it with lightweight, durable documentation rather than deferring indefinitely while awaiting a full commissioned audit.

### Option A: Commission an external audit (deferred)

A professional smart contract audit of `soroban_token_contract.wasm` (from `stellar/soroban-examples`) and/or `token_factory.wasm` would provide the strongest assurance. This remains the recommended path for high-value or high-traffic mainnet deployments. However:

- The `soroban-examples` token contract is an upstream reference maintained by SDF, not a custom implementation. The risk profile is materially different from a bespoke contract.
- Commissioning an audit of an upstream SDF contract is unusual; deployers are more likely to rely on their own review of SDF's internal processes.
- Blocking mainnet deployment documentation on an upstream audit was impractical.

**Decision**: Deferred. A future audit engagement should update `docs/token-wasm-provenance.md` and `docs/audits/` with findings.

### Option B: Document provenance and require explicit risk acceptance (chosen)

Create `docs/token-wasm-provenance.md` that:

- Identifies the canonical upstream source
- States the honest audit status (not independently audited by this project)
- Provides a deployment log template so every deployer records their specific hash and decision
- Links to the mainnet checklist item that enforces this before any production deploy

This approach:

- Closes the unsourced "audited" claim gap immediately
- Creates an enforceable gate in the deployment process
- Provides an upgrade path when a future audit is completed
- Is honest about the project's current security posture

---

## Document structure

### `docs/token-wasm-provenance.md`

Sections:

1. **What is `token_wasm_hash`?** — explains the security dependency
2. **Upstream reference implementation** — table of source, SDK version, maintainer
3. **Audit status** — honest declaration of current state; explains what "well-reviewed" vs "audited" means
4. **What deployers must do before mainnet** — actionable checklist (pin commit, verify hash, assess risk, document decision)
5. **Deployment log** — table template for recording actual deployments
6. **If a formal audit is completed** — upgrade path for future auditors
7. **Related documents** — links back to checklist, ABI docs, spec

### `docs/mainnet-deployment-checklist.md` change

Added a new bullet after the existing generic audit line items, specifically requiring deployers to open and fill in `docs/token-wasm-provenance.md` before proceeding to mainnet.

### README.md Step 4

Already contained the correct provenance notice (pinned-tag requirement, reference to `docs/token-wasm-provenance.md`). No changes required.

---

## Security model

The token WASM security model for StellarForge is:

1. The factory cannot deploy tokens using an unknown or unregistered WASM — the hash must match an on-chain installed WASM.
2. The deployer (admin) controls which WASM hash is registered at initialization. This is a trusted role.
3. The security properties of all user tokens are inherited from the chosen WASM. Token users trust the deployer to have chosen a safe implementation.
4. The `soroban-examples` reference implementation is broadly used in the Stellar ecosystem and is maintained by SDF, but has not been independently audited for this project.
5. For mainnet deployments, deployers must make a documented, conscious risk-acceptance decision and record it in the deployment log.

---

## Future work

- If SDF publishes a formal audit of `soroban-examples` token contract, link to it from `docs/token-wasm-provenance.md`.
- If this project commissions its own audit (of the factory or a custom token WASM), publish the report under `docs/audits/` and update the provenance document.
- Consider adding a pre-flight script that checks whether the deployment log's mainnet row is filled in before `deploy-contract.sh` is run against `--network mainnet`.
