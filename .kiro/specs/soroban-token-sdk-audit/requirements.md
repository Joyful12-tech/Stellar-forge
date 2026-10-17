# Requirements: Soroban Token SDK / Token WASM Audit

## Status: CLOSED — resolved by documentation

This spec was created as a stub to track the security gap described in Issue 25. The gap has been addressed through documentation rather than a commissioned audit. See the resolution section below.

---

## Background

StellarForge's factory contract stores a `token_wasm_hash` at initialization time. Every call to `create_token` deploys a new token contract as an instance of the WASM identified by that hash. The security of every user-deployed token is therefore directly dependent on the integrity and correctness of the WASM bound to that hash.

The factory references `soroban-token-sdk = "26.1.0"` for its own token interaction helpers, and the deployment guide identifies `stellar/soroban-examples` as the upstream source for the standalone token WASM to be installed on-chain.

### Problem statement (Issue 25)

1. No document in the repository stated the provenance of the token WASM explicitly.
2. There was no audit trail, no named auditor, and no audit report for the token WASM.
3. `docs/mainnet-deployment-checklist.md` had generic audit mentions but no line item forcing deployers to verify and document the token WASM's provenance and audit status before going to mainnet.
4. The `.kiro/specs/soroban-token-sdk-audit/` directory existed as an empty stub — a security-sounding task name with no substantive content.

---

## Requirements

### REQ-01: Provenance documentation

A document must exist in `docs/` that answers:

- What is the canonical source of the token WASM used by the factory?
- Which upstream repository, version/tag, and commit does it come from?
- What SDK version was it compiled against?
- What is the current audit status?
- What must a deployer do before using a particular WASM hash on mainnet?

### REQ-02: Deployment log template

The provenance document must include a deployment log table for deployers to record:

- Network (testnet/mainnet)
- Exact source tag/commit
- Resulting WASM hash (hex)
- Audit status
- Decision owner and date

### REQ-03: Checklist enforcement

`docs/mainnet-deployment-checklist.md` must contain a specific line item requiring deployers to:

- Confirm the WASM provenance is documented
- Confirm the WASM hash is recorded
- Confirm the audit status or risk-acceptance decision is on file

This prevents the audit question from being silently skipped in future deployments.

### REQ-04: No unsourced audit claims

No documentation in the project may describe the token WASM as "audited" without citing a specific auditor, date, scope, and report location.

### REQ-05: Spec closure

This spec must be closed with a link to the resulting documentation rather than left as an empty stub.

---

## Out of scope

- Commissioning or performing a professional audit (this would be a separate engagement)
- Auditing the factory contract itself (separate scope)
- Auditing the frontend application

---

## Acceptance criteria

- [x] `docs/token-wasm-provenance.md` exists and satisfies REQ-01 and REQ-02
- [x] `docs/mainnet-deployment-checklist.md` contains an explicit token WASM audit/provenance line item (REQ-03)
- [x] No documentation calls the token WASM "audited" without a citation (REQ-04)
- [x] This spec is closed with links to the resulting documentation (REQ-05)

---

## Resolution

**Date**: August 2026  
**Disposition**: Closed via documentation — audit gap addressed with provenance document and checklist update.

The audit gap was resolved by:

1. Creating [`docs/token-wasm-provenance.md`](../../docs/token-wasm-provenance.md) — the definitive statement of the token WASM's provenance (sourced from `stellar/soroban-examples`), audit status (not independently audited as of August 2026), and a deployment log template that every deployer must fill in before mainnet.

2. Adding an explicit token WASM provenance and audit status line item to [`docs/mainnet-deployment-checklist.md`](../../docs/mainnet-deployment-checklist.md).

3. Confirming that `README.md` Step 4 (Upload Token Contract WASM) correctly qualifies the `soroban-examples` source with a pinned-tag requirement and a provenance notice — it does not make any unsourced "audited" claim.

If a professional audit is subsequently commissioned, the report should be filed under `docs/audits/` and both `docs/token-wasm-provenance.md` and this spec should be updated to reflect the findings.

# Soroban Token SDK Security Audit Spec

## Status

**Scoped, Not Executed (Active Issue #1113)**

## Summary

Perform security audit and WASM verification for deployed Soroban Token Factory smart contracts and compiled WebAssembly binaries.

## Objectives & Scope

1. **Bytecode Verification**: Verify target WASM bytecode hashes against source code compilations.
2. **Reentrancy & Authorization**: Audit administrative capability checks, authorization wrappers (`require_auth`), and fee distribution logic.
3. **Fuzzing & Property Tests**: Ensure fuzz targets in `contracts/token-factory/fuzz` achieve required coverage without panic conditions.
4. **WASM Optimization**: Enforce contract WASM binary size constraints.

## Related Artifacts & Tools

- Fuzzing suite: `contracts/token-factory/fuzz/`
- Audit documentation: `docs/security-triage.md`
- WASM verification workflow: `.github/workflows/wasm-verify.yml`

## Related Issues

- Issue #1113: The token-WASM security-audit spec was scoped and never executed or closed
- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
