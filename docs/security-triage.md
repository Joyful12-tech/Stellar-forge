# Security Advisory Triage

The [Security Audit workflow](../.github/workflows/security-audit.yml) runs `cargo audit` against the contracts workspace and `npm audit` (via [audit-ci](https://github.com/IBM/audit-ci)) against the frontend, on every push and pull request to `main`/`develop` and weekly on Mondays at 08:00 UTC.

Any high-or-above advisory fails the job. Sometimes an advisory genuinely does not affect StellarForge — a dev-only dependency, or an attack vector we do not exercise. This document describes how to record that decision so CI stays meaningful instead of chronically red.

## Principles

- **A waiver is a decision, not a mute button.** It records that someone looked at the advisory and concluded it does not affect this project.
- **Every waiver expires.** Waivers carry a `Review-by` date; the weekly `waiver review` job fails once that date has passed.
- **Untriaged findings always fail.** Nothing is waived implicitly — only the advisory IDs explicitly listed are ignored.

## When a security-audit run fails

1. **Read the advisory.** Follow the RUSTSEC/GHSA link and understand the vulnerable code path.
2. **Try to fix it first.** `npm audit fix`, or bump the crate/package. A patch release is almost always cheaper than a waiver.
3. **If the fix is unavailable or disproportionate, decide whether it applies to us.** Ask:
   - Is the dependency reachable from shipped code, or is it dev/build-only?
   - Do we call the affected API at all?
   - Does exploitation require input we never pass (untrusted deserialisation, attacker-controlled paths, a server context we do not run)?
4. **If it applies, fix it** — pin, patch, or replace the dependency. Do not waive an advisory that affects us.
5. **If it does not apply, open a tracking issue and add a waiver** as described below.

## Adding a waiver

Waivers live next to the tool that consumes them:

| Ecosystem | File                          | List key              |
| --------- | ----------------------------- | --------------------- |
| Rust      | `contracts/.cargo/audit.toml` | `[advisories] ignore` |
| JS        | `frontend/audit-ci.jsonc`     | `allowlist`           |

Each entry must be preceded by a waiver block using the file's comment syntax (`#` for TOML, `//` for JSONC):

```toml
[advisories]
ignore = [
  # WAIVER: RUSTSEC-2024-0001
  # Justification: build-only dependency of the wasm optimiser; the affected
  # parser never sees untrusted input in our pipeline.
  # Link: https://github.com/Favourorg/Stellar-forge/issues/123
  # Review-by: 2026-10-20
  "RUSTSEC-2024-0001",
]
```

All four lines are required:

- **`WAIVER:`** — the advisory ID, matching the list entry exactly.
- **`Justification:`** — why the advisory does not affect StellarForge. "Not exploitable" alone is not a justification; say which precondition fails.
- **`Link:`** — the tracking issue where the analysis and any upgrade path are recorded.
- **`Review-by:`** — an ISO `YYYY-MM-DD` date, normally one quarter out.

`scripts/check-audit-waivers.mjs` enforces this shape in the `waiver lint` job, which gates both audit jobs. It fails on a waiver with missing fields, a bad date, a duplicate entry, a waived ID with no block, or a block with no entry. Run it locally before pushing:

```bash
node scripts/check-audit-waivers.mjs           # structure only (as on PRs)
node scripts/check-audit-waivers.mjs --fail-on-expired   # as on the weekly cron
node --test scripts/check-audit-waivers.test.mjs
```

Waivers go through normal code review. The reviewer is approving the security analysis, not just the diff.

## Re-triaging an expired waiver

When the weekly `waiver review` job fails, a waiver has reached its `Review-by` date. Re-triage it — do not simply push the date out:

1. Re-read the advisory; check whether a fixed version now exists.
2. Confirm the original justification still holds against the current code.
3. Then either:
   - **Remove the waiver** and upgrade the dependency (preferred), or
   - **Extend `Review-by`** by another quarter, updating the justification and tracking issue with what you re-verified.

An extension with no re-verification is how a waiver quietly becomes permanent — the exact failure mode this process exists to prevent.

## Reporting a vulnerability in StellarForge itself

This document covers third-party advisories only. To report a vulnerability in StellarForge, follow [SECURITY.md](../SECURITY.md) — do not open a public issue.

---

## August 2026 critical-issues audit — architectural decisions

The following entries document *why* certain areas are rate-limited or validated
differently, per the requirement in the fix for the issues below.

### Issue #1162 — Challenge-issuance vs authenticated-action rate limits

**Problem:** `isRateLimited(address)` in `api/_lib/rateLimit.ts` used a single
shared bucket per Stellar address across every call site: the unauthenticated
`GET /api/auth/challenge` (no proof-of-key-possession required) and every
authenticated action (`upload-file`, `upload-json`, `unpin`). An attacker who
knows a victim's public address — a public-by-design value — could exhaust the
victim's daily budget at zero cost.

**Fix:** The rate-limit namespace is now split into two independent families:

| Endpoint | Function | Key | Rationale |
|---|---|---|---|
| `GET /api/auth/challenge` | `isChallengeRateLimited(ip)` | Requester IP | Challenge issuance requires no key possession; keying on address lets any observer deny a victim. IP is the appropriate axis here because Vercel's `x-forwarded-for` provides a spoof-resistant rightmost entry. |
| `POST /api/auth/challenge`, uploads, unpin | `isActionRateLimited(address)` | Wallet address | These callers have already proved possession of the corresponding private key via the challenge→signature flow, so the address is a safe rate-limit key. |

Exhausting the challenge-issuance IP bucket for a given requester does **not**
affect that address's authenticated-action quota, and vice versa. The split is
enforced in `api/_lib/rateLimit.ts`; the test in `api/_lib/rateLimit.test.ts`
asserts both isolation properties.

### Issue #1163 — Cross-tab localStorage network sync on mutating forms

**Problem:** `useLocalStorage` installs a `window storage` event listener that
silently updates `NetworkContext` whenever another tab writes the persisted
network key. `StellarContext` rebuilds `stellarService` purely as a reaction to
the network change, with no coordination with in-progress form state. A user
filling `MintForm` / `BurnForm` / `SetMetadataForm` / `AdminPanel` in one tab
while switching networks in another tab could submit a transaction against a
contract address that belongs to the wrong network — defeating `useNetworkGuard`
(which only checks Freighter-vs-app agreement, not "did the app's own target
change since this tab's form was opened").

**Fix:** `useNetworkGuard` now captures the network value active at hook-mount
time and sets `networkChangedSinceMount = true` whenever `NetworkContext`
drifts away from that baseline. This blocks form submission and surfaces an
explicit "Network changed to X since you opened this form" banner with a
confirmation button. Clicking the button calls `acknowledgeNetworkChange()`,
which rebases the mount snapshot to the current network and re-enables the form.
All four mutating forms (`MintForm`, `BurnForm`, `SetMetadataForm`, `AdminPanel`)
consume the new return values.

### Issue #1164 — Contract error discriminant uniqueness

**Problem:** Rust allows duplicate explicit discriminants on a fieldless enum
without a warning, but Soroban exposes `#[contracterror]` values to external
callers as bare `u32` codes. Three semantically distinct errors
(`TreasuryTransferFailed`, `BatchSizeExceeded`, `NoPendingProposal`) were
reported as sharing discriminant 24, making them indistinguishable to any
monitoring, retry, or UI logic that branches on the numeric code.

**Fix:** The contract already carries unique discriminants (24, 25, 26, 27) for
those three variants plus `ProposalExpired`. A compile-time test
(`test_error_discriminants_are_unique` in `contracts/token-factory/src/test.rs`)
now exhaustively lists every variant and asserts uniqueness via a `HashSet`,
failing CI if any future variant reuses an existing code or is added without
being registered in the test. `CONTRACT_ERROR_MESSAGES` and
`CONTRACT_ERROR_REQUIREMENTS` in `frontend/src/utils/contractErrors.ts` have
been updated to include entries for codes 24–27.
