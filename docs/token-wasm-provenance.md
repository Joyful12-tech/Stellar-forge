# Token WASM Provenance and Audit Status

This document is the definitive reference for the token contract WASM used by the StellarForge factory and answers three questions every deployer must be able to answer before going to mainnet:

1. Where does the token WASM come from?
2. Has it been independently audited?
3. What must I verify before I supply its hash to the factory?

---

## What is `token_wasm_hash`?

The StellarForge factory contract takes a `token_wasm_hash` parameter at initialization time. Every call to `create_token` deploys a new token contract as an instance of the WASM identified by that hash. All user-created tokens inherit whatever security properties (and vulnerabilities) that WASM carries. The hash is an on-chain content address: the network will refuse to deploy a contract whose bytes do not match the recorded hash, so the binding is cryptographically guaranteed.

---

## Upstream reference implementation

The deployment guide in `README.md` (Step 4 — "Upload Token Contract WASM") identifies the intended token WASM as:

| Field                         | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| Repository                    | `stellar/soroban-examples`                                                |
| File path                     | `token/target/wasm32-unknown-unknown/release/soroban_token_contract.wasm` |
| Interface                     | SEP-41 (Soroban Token Interface)                                          |
| SDK version pinned in factory | `soroban-sdk = "26.1.0"`, `soroban-token-sdk = "26.1.0"`                  |

This is the canonical example token contract published by Stellar Development Foundation (SDF) as a reference implementation of SEP-41.

### Who maintains it?

The `soroban-examples` repository is maintained by SDF. The token example contract is updated alongside releases of the Soroban SDK and is considered the authoritative starting point for production token implementations on Stellar.

---

## Audit status

**As of August 2026 this project has not independently audited the token WASM.**

The following should be understood by every deployer:

- **SDF's soroban-examples is a reference/example repository.** SDF has not published a formal third-party security audit specifically scoped to `soroban_token_contract.wasm` in `soroban-examples`. The contract is well-reviewed internally and widely used in the Stellar ecosystem, but "widely used" and "audited" are not the same thing.

- **No audit report is on file in this repository.** There is no named auditor, no engagement date, no scope document, and no report linked from this project. Until one is filed here, no documentation in this project should represent the token WASM as "audited."

- **The factory contract itself (`token_factory.wasm`) has not been externally audited.** The codebase includes fuzz testing, unit tests, and a security-aware checklist, but these are not substitutes for a professional audit.

### What deployers must do before mainnet

1. **Pin a specific WASM commit.** Download `soroban_token_contract.wasm` from a pinned `soroban-examples` commit tag (e.g., `v0.x.y`) rather than from `main`. Record the exact tag and commit SHA in your deployment log.

2. **Verify the WASM hash.** After installing the WASM with `stellar contract install`, record the 64-hex-character hash the CLI returns. Verify it matches the value you set in `VITE_TOKEN_WASM_HASH` and the value stored in the factory's `initialize` call.

3. **Assess the risk level.** If you are deploying a high-value token factory where theft or exploit would cause material harm to users, commission a professional audit of both the token WASM and the factory contract before launch. This is not optional for production systems at scale.

4. **Document your decision.** If you proceed without an external audit, record your risk acceptance in writing — who reviewed the code, what the known risks are, and who accepted them. This document is the template; add your findings below.

---

## Deployment log (fill this in before mainnet)

| Environment | Network | WASM source tag/commit     | WASM hash (hex) | Audit status                                  | Decision owner | Date   |
| ----------- | ------- | -------------------------- | --------------- | --------------------------------------------- | -------------- | ------ |
| testnet     | testnet | `soroban-examples` @ _tag_ | _64-hex_        | Not audited — reference impl, internal review | _name_         | _date_ |
| mainnet     | mainnet | `soroban-examples` @ _tag_ | _64-hex_        | **TODO before launch**                        | _name_         | _date_ |

---

## If a formal audit is completed

When a professional audit is conducted, update this document with:

- Auditor name and firm
- Engagement date and scope (which contract(s), which commit)
- Report link (or docs/audits/\<filename\>.pdf if stored in-repo)
- Key findings and remediation status
- Sign-off by the project admin

Then update `docs/mainnet-deployment-checklist.md` to mark the audit status item as satisfied.

---

## Related documents

- [Mainnet Deployment Checklist](./mainnet-deployment-checklist.md)
- [Contract ABI](./contract-abi.md)
- [Spec: soroban-token-sdk-audit](./../.kiro/specs/soroban-token-sdk-audit/requirements.md)
