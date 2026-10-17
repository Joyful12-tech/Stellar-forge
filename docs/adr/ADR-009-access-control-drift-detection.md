# ADR-009: Access-Control Documentation Drift Detection Strategy

**Status:** ACCEPTED — implemented, with Phase 2b outstanding  
**Date:** 2026-08-22 (operation classification corrected 2026-08-26, issue #1161)  
**Decision Maker:** Architect (SDD Lead)  
**Issue:** #1112 (Access-Control Documentation Drift Check)

---

## Context

The Stellar Forge token-factory contract defines critical access-control semantics. The classification below was re-verified line-by-line against `contracts/token-factory/src/lib.rs` in issue #1161, which found `set_metadata` misfiled as admin-only:

- **Admin-only operations** (`admin.require_auth()` **plus** an identity check against `state.admin`): `add_to_whitelist`, `remove_from_whitelist`, `set_whitelist_enabled`, `pause`, `unpause`, `update_fees`, `set_fee_split`, `upgrade`, `migrate`, `backfill_capped_supply`, `propose_admin`, `cancel_admin_proposal`
- **Constructor:** `__constructor` — `admin.require_auth()` only; it _establishes_ `state.admin`, so there is no prior admin to check against
- **Creator-authorized operations (caller-signed):** `create_token`, `create_tokens_batch` — `creator.require_auth()` plus the conditional whitelist gate
- **Creator-authorized operations (per-token owner):** `set_metadata`, `freeze_metadata`, `mint_tokens`, `set_burn_enabled` — the caller signs and is then compared against the creator stored under the token's `owner` key. **`state.admin` is never consulted**, so factory-admin privilege grants nothing here
- **Holder-authorized:** `burn` — `from.require_auth()`, gated on the token's `burn_enabled` flag
- **Successor-authorized:** `accept_admin` — `new_admin.require_auth()` plus a match against the pending proposal, which must not have expired
- **Deprecated aliases:** `transfer_admin`, `update_admin` — no auth of their own; they delegate to `propose_admin`, which enforces the admin path
- **View operations** (public, no auth required): `is_whitelisted`, `is_metadata_frozen`, `get_metadata_version`, `get_state`, `get_base_fee`, `get_metadata_fee`, `get_fee_split`, `get_token_info`, `get_token_index`, `get_token_address`, `get_token_info_by_address`, `get_metadata`, `get_tokens_by_creator`
- **Permissionless write:** `backfill_token_address` — repairs a missing index→address record idempotently from data the contract already holds; it confers no privilege and grants no new state

> **The `admin` parameter name is not an authorization claim.** Four entrypoints — `set_metadata`, `freeze_metadata`, `mint_tokens`, `set_burn_enabled` — name their caller `admin` because it is _the token's_ admin: its creator. Reading the signature instead of the guard is exactly the mistake that produced issue #1161, and it is why the checker has a distinct `creator_check` rule rather than folding it into `admin_check`.

These semantics are documented across three sources:

1. **Code source of truth:** `contracts/token-factory/src/lib.rs` (Rust contract logic)
2. **API specification:** `docs/contract-abi.md` (public ABI, function signatures)
3. **Security policy:** `SECURITY.md`, `README.md` (high-level access control claims)

**Problem:** If a developer updates `lib.rs` to add/remove authorization checks or modify whitelist logic, the documentation may drift out of sync. This creates:

- **UX friction:** Frontend builds incorrect assumptions about access gates
- **Security risk:** Miscommunication about which addresses can call which functions
- **Audit failure:** Discrepancies between claimed and actual access control

**Goal:** Implement an automated drift detection mechanism in CI that:

1. Extracts access-control patterns from `lib.rs` (Rust AST)
2. Compares against documented claims in ABI and security docs
3. Fails the PR build if divergence exceeds acceptable thresholds
4. Provides actionable error messages and remediation steps

---

## Decision

**Implement access-control drift detection via a new Bash script, `scripts/check-access-control-docs-drift.sh`.**

### Rationale

**Why Bash (vs. Node.js or Python)?**

- **Consistency with existing drift-check scripts:** The codebase already uses Bash for `check-abi-doc-drift.sh`, `check-validation-drift.sh`, and `check-event-topic-drift.sh`. Bash is the established lingua franca for this family of linters.
- **Simplicity:** Access-control patterns are lexically regular (e.g., `require_auth()`, `admin.require_auth()`, `require_whitelisted(...)`). Regex and `grep` suffice; no need for a full Rust parser.
- **Low friction:** Runs in CI and developer shells without additional dependencies (Bash, grep, sed are standard on Linux/macOS).
- **Shift-left security:** Fast feedback loop — runs before compilation, catches drift immediately.

**Why not a full Rust AST parser?**

- Overkill for the patterns we need to detect; adds build-time overhead.
- If the codebase graduates to more complex semantic checks in future (e.g., control flow analysis), a Rust tool can be introduced then.

**Why not integrate into existing `check-abi-doc-drift.sh`?**

- Separation of concerns: ABI drift checks function _names_ and _signatures_; access-control checks _authorization logic_. Mixing them reduces maintainability.
- Different validation rules: ABI drift uses `grep` to find function names; access-control drift uses pattern matching on authorization logic.

---

## Architecture & Design

### 1. **Lexical Pattern Extraction from lib.rs**

The script will use regex + sed/awk to extract access-control assertions from `lib.rs`:

#### Pattern 1: Admin-only gates

```rust
admin.require_auth();
if state.admin != admin { return Error::Forbidden; }
```

**Extracted:** Function name + claim: "admin-only"

#### Pattern 2: Creator authorization (caller-signed)

```rust
creator.require_auth();
```

**Extracted:** Function name + claim: "requires caller auth"

#### Pattern 2b: Creator authorization (per-token owner)

```rust
let creator: Address =
    Self::migrate_addr_keyed(&env, &(&token_address, symbol_short!("owner")))
        .ok_or(Error::TokenNotFound)?;
if creator != admin {
    return Err(Error::Unauthorized);
}
```

**Extracted:** Function name + claim: "token creator only"

This is deliberately a **separate** rule from Pattern 1. The caller parameter is named `admin`, but it is compared against the token's stored creator and `state.admin` is never read — so matching on the parameter name would classify a creator-scoped entrypoint as admin-only. That is precisely the drift issue #1161 found in `SECURITY.md` and in this ADR's own operation table.

#### Pattern 3: Whitelist gates

```rust
Self::require_whitelisted(&env, &state, &creator)?;
```

**Extracted:** Function name + claim: "whitelist gate (conditional on `state.whitelist_enabled`)"

#### Pattern 4: View-only (no auth)

```rust
pub fn is_whitelisted(env: Env, address: Address) -> bool {
    // No require_auth() call
}
```

**Extracted:** Function name + claim: "view (no auth required)"

### 2. **Documentation Assertion Extraction**

The script will scan `docs/contract-abi.md` and `SECURITY.md` to find documented claims:

#### Format in `docs/contract-abi.md`

```markdown
### `add_to_whitelist(admin, address)`

**Authorization:** Admin-only (`admin.require_auth()`).  
**Effect:** Adds `address` to the whitelist.
```

**Extraction rule:** Search for `**Authorization:**` or `**Access control:**` sections.

#### Format in `SECURITY.md`

```markdown
| Function           | Caller | Requirement                                                 |
| ------------------ | ------ | ----------------------------------------------------------- |
| `add_to_whitelist` | admin  | Signer must be the current admin                            |
| `create_token`     | any    | Caller must be whitelisted (if enabled) or always permitted |
```

**Extraction rule:** Parse security matrix tables.

### 3. **Correspondence Matrix (Single Source of Truth)**

Define a hardcoded matrix in the script mapping (function, entrypoint) → expected access-control claims:

As implemented in `get_expected_claims()` (claims are colon-joined, and the comparison is an exact match):

```bash
case "$fn" in
    "__constructor")         echo "admin_auth" ;;
    "add_to_whitelist")      echo "admin_auth:admin_check" ;;
    "remove_from_whitelist") echo "admin_auth:admin_check" ;;
    "set_whitelist_enabled") echo "admin_auth:admin_check" ;;
    "is_whitelisted")        echo "view_only" ;;
    "create_token")          echo "creator_auth:whitelist_gate" ;;
    "create_tokens_batch")   echo "creator_auth:whitelist_gate" ;;
    # NOT admin_check — the caller is checked against the token's stored
    # creator, so the factory admin key has no authority here (issue #1161).
    "set_metadata")          echo "admin_auth:creator_check" ;;
    *) echo "" ;;
esac
```

Entrypoints absent from the matrix are reported as `UNKNOWN` (exit code 2, warning) rather than failing the build, so adding an entrypoint to `lib.rs` never breaks CI before its expectation is written down. `freeze_metadata`, `mint_tokens` and `set_burn_enabled` currently sit in that bucket and all three resolve to `admin_auth:creator_check`, the same shape as `set_metadata`.

### 4. **Comparison & Reporting Logic**

1. **Extract actual patterns** from `lib.rs` for each public function.
2. **Extract documented claims** from `docs/contract-abi.md` and `SECURITY.md`.
3. **For each function:**
   - Compare actual pattern against `EXPECTED_CONTROLS[function_name]`.
   - Compare documented claims against expected claims.
   - Flag mismatches as errors or warnings.
4. **Exit code:** 0 (all consistent), 1 (critical drift), 2 (warnings only).

### 5. **Output Format**

GitHub Actions annotations for inline PR feedback:

```
::error::Access-control drift detected in create_token:
  Expected: creator.require_auth | optional_whitelist_gate
  Found in code: creator.require_auth (whitelist gate MISSING)
  Found in docs: "Caller must be whitelisted"

  Action: Add `Self::require_whitelisted(...)` to create_token or update SECURITY.md
```

---

## Verified Operation Classification

Re-verified against `contracts/token-factory/src/lib.rs` for issue #1161. "Guard" is the authorization actually enforced, not the parameter name. `#[cfg(feature = "testutils")]` helpers (`fuzz_seed_token`) are excluded — they are not in the deployed WASM.

| Entrypoint                                                                                                                                                                                                                                                       | Guard in `lib.rs`                                               | Classification          | In checker matrix             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- | ----------------------------- |
| `__constructor`                                                                                                                                                                                                                                                  | `admin.require_auth()` (establishes `state.admin`)              | Constructor             | ✅ `admin_auth`               |
| `add_to_whitelist`                                                                                                                                                                                                                                               | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | ✅                            |
| `remove_from_whitelist`                                                                                                                                                                                                                                          | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | ✅                            |
| `set_whitelist_enabled`                                                                                                                                                                                                                                          | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | ✅                            |
| `pause` / `unpause`                                                                                                                                                                                                                                              | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | —                             |
| `update_fees`                                                                                                                                                                                                                                                    | `admin.require_auth()` + `admin != state.admin`                 | Admin-only              | —                             |
| `set_fee_split`                                                                                                                                                                                                                                                  | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | —                             |
| `upgrade`                                                                                                                                                                                                                                                        | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | —                             |
| `migrate`                                                                                                                                                                                                                                                        | `admin.require_auth()` + `state.admin != admin`                 | Admin-only              | —                             |
| `backfill_capped_supply`                                                                                                                                                                                                                                         | `admin.require_auth()` + `state.admin != admin`                 | Admin-only (once/token) | —                             |
| `propose_admin`                                                                                                                                                                                                                                                  | `current_admin.require_auth()` + `state.admin != current_admin` | Admin-only              | —                             |
| `cancel_admin_proposal`                                                                                                                                                                                                                                          | `current_admin.require_auth()` + `state.admin != current_admin` | Admin-only              | —                             |
| `accept_admin`                                                                                                                                                                                                                                                   | `new_admin.require_auth()` + matches unexpired pending proposal | Successor-only          | —                             |
| `transfer_admin` / `update_admin`                                                                                                                                                                                                                                | delegate to `propose_admin`                                     | Deprecated alias        | —                             |
| `create_token`                                                                                                                                                                                                                                                   | `creator.require_auth()` + conditional whitelist gate           | Creator (caller)        | ✅                            |
| `create_tokens_batch`                                                                                                                                                                                                                                            | `creator.require_auth()` + conditional whitelist gate           | Creator (caller)        | ✅                            |
| `set_metadata`                                                                                                                                                                                                                                                   | `admin.require_auth()` + `creator != admin` vs stored `owner`   | **Creator (per-token)** | ✅ `admin_auth:creator_check` |
| `freeze_metadata`                                                                                                                                                                                                                                                | `admin.require_auth()` + `creator != admin` vs stored `owner`   | Creator (per-token)     | —                             |
| `mint_tokens`                                                                                                                                                                                                                                                    | `admin.require_auth()` + `creator != admin` vs stored `owner`   | Creator (per-token)     | —                             |
| `set_burn_enabled`                                                                                                                                                                                                                                               | `admin.require_auth()` + `creator != admin` vs stored `owner`   | Creator (per-token)     | —                             |
| `burn`                                                                                                                                                                                                                                                           | `from.require_auth()` + token's `burn_enabled` flag             | Holder                  | —                             |
| `backfill_token_address`                                                                                                                                                                                                                                         | none — idempotent index repair, grants nothing                  | Permissionless write    | —                             |
| `is_whitelisted`, `is_metadata_frozen`, `get_metadata_version`, `get_state`, `get_base_fee`, `get_metadata_fee`, `get_fee_split`, `get_token_info`, `get_token_index`, `get_token_address`, `get_token_info_by_address`, `get_metadata`, `get_tokens_by_creator` | none                                                            | View                    | ✅ (`is_whitelisted` only)    |

### Known detector gaps

Entrypoints outside the matrix are reported as `UNKNOWN` warnings, and for three of them the _reported_ claim is not the real semantic. Fix the rule before promoting any of these into `EXPECTED_CONTROLS`, or the matrix will encode a false expectation — the failure mode this ADR exists to prevent:

| Entrypoint               | Reported     | Why it is wrong                                                                                                                             |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `burn`                   | `view_only`  | There is no rule for `from.require_auth()`, so a holder-authorized write looks unauthenticated.                                             |
| `accept_admin`           | `admin_auth` | `new_admin.require_auth()` contains the substring `admin.require_auth`. The successor check (pending proposal + expiry) has no rule at all. |
| `backfill_token_address` | `view_only`  | Accurate on auth, but it is a **write**, not a view. The two are not distinguished.                                                         |

---

## Consequences

### Positive

- **Security by default:** Drift detection runs on every PR; no human review bypasses it.
- **Clear accountability:** Developers see exactly where code and docs diverge.
- **Low maintenance:** Bash script fits the existing CI pattern; no new infra.
- **Shift-left:** Catches issues before merge, reducing incident risk.

### Negative (Mitigations)

- **False positives:** Regex patterns might miss edge cases (e.g., conditional auth). **Mitigation:** Define clear patterns, document exceptions in comments.
- **Regex brittleness:** Code formatting changes can break pattern matching. **Mitigation:** Write flexible regex, test against multiple coding styles.
- **Documentation overhead:** Developers must keep three sources in sync. **Mitigation:** Generate documentation from code annotations in a future phase (ADR-010).

---

## Implementation Phases

### Phase 2a: Script Foundation (Done)

- [x] Define pattern extraction rules in Bash — `scripts/check-access-control-docs-drift.sh`.
- [x] Build correspondence matrix (hardcoded in script).
- [x] Implement comparison logic.

### Phase 2b: Documentation Ingestion (Not implemented)

- [ ] Parse `docs/contract-abi.md` for authorization blocks.
- [ ] Parse `SECURITY.md` for security matrix.
- [ ] Map claims to expected patterns.

`parse_documented_claims()` exists but is not wired into `main()`, which logs "Parsed documentation blocks" without reading either file. **The prose in `SECURITY.md`, `README.md` and this ADR is therefore not machine-verified against `lib.rs` — only the hardcoded matrix is.** Issue #1161 is what that gap costs: the claim that `set_metadata` is admin-gated survived in three documents while the checker's own matrix had it right.

### Phase 2c: CI Integration (Done)

- [x] GitHub Actions workflow — `.github/workflows/validate-access-control-drift.yml`.
- [x] Exit code handling (1 = critical drift, 2 = warnings only).
- [ ] Document in `CONTRIBUTING.md`.

### Phase 3: Validation (Partial)

- [x] Test suite — `tests/check-access-control-docs-drift.test.sh`, with baseline and drift-injection fixtures including the issue #1161 regression case.
- [x] Audit documentation for accuracy (issue #1161; see the classification table above).
- [ ] Test against live contract on testnet.

---

## Related ADRs & Standards

- **ADR-005:** Analytics & Privacy Consent (no cross-dependency).
- **SOLID Principle:** Separation of Concerns — drift detection isolated from CI orchestration.
- **Clean Architecture:** Validation logic (pure functions) separate from I/O (file reads).

---

## Questions & Open Items

1. **Whitelist gate optionality:** Should `require_whitelisted(...)` be _required_ or _optional_ for `create_token`? The code shows it's conditional on `state.whitelist_enabled`, but the documentation must be explicit.
   - **Answer (from SECURITY.md): Caller must be whitelisted (if enabled) or always permitted.**
   - **Code reflects this:** Drift rule: `create_token` must contain `Self::require_whitelisted(...)`.

2. **Future: Authorization annotations:** If access control becomes more complex, introduce `#[access_control(...)]` Rust attributes to generate docs automatically. (See ADR-010, future.)

---

**Approved by:** Architect  
**Date:** 2026-08-22  
**Next Review:** After Phase 2c completion
