# Codebase Audit Issues — 2026-08

This file tracks issues identified during the August 2026 codebase audit (30 issues total).

| #      | Area                              | Severity       | Title                                                                                                       | Status          |
| ------ | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
| 1      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 2      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 3      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 4      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| **5**  | **API (`api/auth/challenge.ts`)** | **High**       | **`verifyStellarSignature` used wrong payload + broken `tweetnacl` import — every login silently rejected** | **✅ Resolved** |
| 6      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 7      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 8      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 9      | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 10     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 11     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 12     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 13     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 14     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 15     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 16     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 17     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 18     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 19     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 20     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 21     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 22     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 23     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 24     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 25     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| **26** | **API (`api/_lib/rateLimit.ts`)** | **Medium-Low** | **`clientIp()` had inverted/incorrect X-Forwarded-For parsing**                                             | **✅ Resolved** |
| 27     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 28     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 29     | —                                 | —              | _(pending)_                                                                                                 | Open            |
| 30     | —                                 | —              | _(pending)_                                                                                                 | Open            |

---

## Issue 26 — `clientIp()` had inverted/incorrect X-Forwarded-For parsing

**Area:** API (`api/_lib/rateLimit.ts`)  
**Severity:** Medium-Low  
**Status:** ✅ Resolved

### Description

`clientIp()` (formerly at `rateLimit.ts:93–105`) took the **rightmost** entry of a
comma-separated `X-Forwarded-For` header as the trusted client IP. The inline comment
showed `"203.0.113.1, 10.0.0.1" -> use "10.0.0.1" (Vercel's edge)"` — treating what
appears to be a private/internal address as the "trusted client IP."

This was wrong in two compounding ways:

1. **Standard XFF semantics**: The client IP is the **leftmost** entry; subsequent entries
   are proxies appended in order. Taking the rightmost yields a proxy IP, not the client.
2. **Vercel's actual behaviour**: [Vercel's documentation](https://vercel.com/docs/headers/request-headers#x-forwarded-for)
   states that `x-forwarded-for` contains _"The public IP address of the client that made
   the request"_ and that Vercel **overwrites** the header (does not forward external IPs)
   to prevent IP spoofing. On Vercel, the header is always a single IP — the real client
   IP — making multi-hop parsing entirely moot.

The function was **not called anywhere** in `api/`, so there was no active bug, but it
was a latent security issue: if it had been wired into an unauthenticated endpoint
(e.g., issue #1101's IP-based rate limiting on `/api/auth/challenge`) without correction,
it would have either failed to distinguish clients or been trivially spoofable.

### Resolution

`clientIp()` and its associated `VercelRequest` import were **removed** from
`rateLimit.ts` as dead code. The corresponding tests in `rateLimit.test.ts` (which
pinned the unverified direction and would have stayed green even if the parsing was
backwards) were also removed.

The remaining four `isRateLimited` tests continue to pass.

### Follow-up

If IP-based rate limiting is needed in the future (e.g., for issue #1101), re-add a
`clientIp()` helper that reads `req.headers['x-forwarded-for']` directly as a single
string (Vercel's documented behaviour), with a fallback to `x-real-ip` or
`req.socket.remoteAddress`. Do **not** attempt multi-hop parsing unless deploying behind
a custom proxy with Vercel's Enterprise Trusted Proxy feature enabled.

---

## Issue 5 — `verifyStellarSignature` wrong SEP-53 payload + broken `tweetnacl` import

**Area:** API (`api/auth/challenge.ts`)  
**Severity:** High  
**Status:** ✅ Resolved

### Description

`verifyStellarSignature` (challenge.ts:118–140 before fix) had three compounding bugs
that caused **every POST `/api/auth/challenge` login attempt to silently return 401**:

1. **Wrong message payload**: The function verified the raw `challenge` string
   (`Buffer.from(message, 'utf-8')`). Freighter follows **SEP-53**, which requires
   hashing `SHA256("Stellar Signed Message:\n" + challenge)` before signing. The
   backend and frontend were signing/verifying completely different byte sequences.

2. **Dead `Keypair` construction**: `Keypair.fromPublicKey(address)` was called but
   its return value never used. The actual bytes came from `StrKey.decodeEd25519PublicKey`,
   which was passed to `tweetnacl` — itself broken (see below).

3. **Broken `tweetnacl` import**: `const { sign } = await import('tweetnacl')` attempts
   named-export destructuring from a CJS module; `sign` is `undefined` at runtime.
   Every `sign.detached.verify(...)` call threw `TypeError: Cannot read properties
of undefined (reading 'detached')`, which the catch block turned into `return false`.
   `tweetnacl` was also only a transitive dependency, not declared in `package.json`.

### Resolution

`verifyStellarSignature` was rewritten to:

- Construct the SEP-53 payload: `SHA256("Stellar Signed Message:\n" + challenge)`
  using Node's built-in `crypto` module (no new dependencies).
- Decode the base64 signature to raw bytes.
- Verify with `Keypair.fromPublicKey(address).verify(hash, signatureBytes)` from
  `stellar-sdk` (already in `package.json`) — the one call that does all the work.
- Remove all `tweetnacl`, `StrKey`, and dead `Keypair` code.
- Rename the parameter `signatureXdr → signatureBase64` and update the JSDoc and
  inline comments to accurately describe the SEP-53 wire format.

Four cryptographic unit tests were added to `challenge.test.ts` covering:

- Valid signature → 200 + JWT
- Tampered signature → 401
- Signature for wrong challenge → 401
- Malformed base64 → 401 (no unhandled exception / no 500)

The stale comment block documenting the `tweetnacl` bug was removed.
