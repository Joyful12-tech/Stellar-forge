# Soroban RPC Rate Limits

> **Last updated:** 2026-07-16  
> **Context:** Issue [#942](https://github.com/Favourorg/Stellar-forge/issues/942) — Load/Soak test against Soroban RPC rate limits

## SDF Public RPC Endpoints

The Stellar Development Foundation provides public RPC services as a convenience for developers. These are **not** intended for production/high-volume traffic.

| Network | URL                                   | Purpose                   |
| ------- | ------------------------------------- | ------------------------- |
| Testnet | `https://soroban-testnet.stellar.org` | Development & testing     |
| Mainnet | No public SDF-hosted RPC              | Use third-party providers |

## Published Rate Limits

**The SDF does not publish a specific numeric rate limit** (e.g. "X requests/second") for the public testnet RPC endpoint. Key findings from official documentation:

1. **No explicit static limit** — The infrastructure is monitored dynamically. If a user's traffic impacts other users, throttling or IP blocking may be applied at the operator's discretion.
2. **Testnet is bad for load/stress testing** — The official docs explicitly warn against using testnet for stress testing.
3. **Recommended alternatives for production:**
   - Use a third-party infrastructure provider (Ankr, Nodies, Gateway.fm, etc.) with documented SLAs
   - Run your own Stellar RPC instance

## Event Retention Constraint

Soroban RPC does **not** retain contract events indefinitely. `getEvents` can
only return events from within a bounded retention window — approximately
**7 days** on SDF public infrastructure, and provider-dependent elsewhere.
Events older than the window are pruned and are permanently unavailable from
that RPC.

### Why this matters for token data

Two consequences follow, and the frontend is built around both:

1. **Token identity must not be derived from events.** A token created before
   the retention window (or simply beyond the most recent event page) would
   otherwise fall out of the event stream, leaving the UI to fabricate
   placeholder data — an address used as the token name and a _guessed_
   `decimals` value. Guessed decimals are especially damaging: every balance
   and amount rendered for that token is then wrong by orders of magnitude.

   Identity is therefore resolved from **contract state**, which has no
   retention window:

   | Data                                            | Source of truth                      |
   | ----------------------------------------------- | ------------------------------------ |
   | name / symbol / decimals / creator / created_at | `get_token_info_by_address(address)` |
   | address → storage index                         | `get_token_index(address)`           |
   | metadata URI                                    | `get_metadata(address)`              |

   `StellarService.resolveTokenInfoByAddress()` calls these views and returns a
   typed `{ status: 'resolved' } | { status: 'unresolved' }` result. It never
   returns a placeholder — an address the factory cannot confirm renders as an
   explicit "unresolved" marker.

2. **Per-token history is inherently partial and must be disclosed as such.**
   `StellarService.getTokenEvents()` paginates the factory event stream
   exhaustively with cursors (via `fetchAllContractEvents`) so it returns every
   event the RPC still retains — but events older than the retention window are
   gone. The result is flagged `retentionLimited` with the approximate
   `retentionDays`, and `TokenHistory` discloses this in the UI ("Events older
   than about N days are not available from this RPC") rather than implying the
   list is the token's complete lifetime.

The retention window is codified as `RPC_EVENT_RETENTION_DAYS` in
`frontend/src/services/stellar-impl.ts`. It is a conservative approximation for
messaging, not a guarantee — a specific provider may retain more or less. For
production deployments needing complete historical data, run an off-chain
indexer (see #35) rather than relying on RPC event retention.

## Horizon Rate Limits

The Horizon API (used for `getTransaction` and `accountExists`) also does not publish specific rate limits, but 429 responses are known to occur under sustained high traffic. Horizon returns `Retry-After` headers with 429 responses.

## Stellar ecosystem provider rate limits (for reference)

| Provider   | Free Tier | Rate Limits     |
| ---------- | --------- | --------------- |
| Ankr       | Yes       | Varies by plan  |
| Nodies     | Yes       | 10 req/s (free) |
| Gateway.fm | Yes       | Varies          |

## How the App Currently Handles Rate Limits

### Retry Infrastructure (`frontend/src/utils/retry.ts`)

The app has a comprehensive retry system:

- **`HttpError`** — Custom error class carrying HTTP status and optional `Retry-After` header value
- **`isTransientError()`** — Correctly identifies 429 and 5xx as transient, 4xx as non-transient
- **`withRetry()`** — Retries with:
  - Exponential backoff: `baseDelayMs * 2^(attempt-1)`
  - Respects `Retry-After` header when present (overrides exponential backoff)
  - Configurable `maxAttempts` (default: 3)

### RPC Call Sites

| Call Site                                | Retry Wrapped? | Notes                                     |
| ---------------------------------------- | -------------- | ----------------------------------------- |
| `rpcCall()` (getContractEvents)          | ✅ Yes         | Uses `withRetry` with `HttpError` for 429 |
| `getTransaction()` (Horizon)             | ✅ Yes         | Uses `withRetry` with `HttpError` for 429 |
| `accountExists()` (Horizon)              | ✅ Yes         | Uses `withRetry` with `HttpError` for 429 |
| `pollTransaction()` (RPC getTransaction) | ✅ Yes         | Uses `withRetry`                          |
| `simulateTransaction()` (SDK)            | ✅ Yes         | Wrapped with `withRetry`                  |
| `sendTransaction()` (SDK)                | ✅ Yes         | Wrapped with `withRetry`                  |
| `getAccount()` (SDK)                     | ✅ Yes         | Wrapped with `withRetry`                  |
| IPFS uploads                             | ✅ Yes         | Uses `withRetry` with `isTransientError`  |

### User-Facing Error Messages

- 429/rate-limit errors → Retried silently up to 3 times with backoff
- If retries exhausted → Falls through to generic error handling in `parseContractError()`
- The `parseContractError()` function provides user-friendly messages for network timeouts and insufficient balance, but **does not have a specific message for 429/rate-limit after retry exhaustion**

## Recommendations

1. **Add a specific 429/rate-limit error message** in `parseContractError()` so users see "The server is currently rate-limiting requests. Please wait and try again." instead of a generic error.
2. **Run the load test** (see `frontend/tests/e2e/load-test.spec.ts`) periodically against testnet to verify graceful degradation.
3. **Consider third-party RPC providers** for production deployments to get guaranteed SLAs and documented rate limits.

## Sources

- [Stellar Docs: Networks](https://developers.stellar.org/docs/networks)
- [Stellar Docs: RPC Providers](https://developers.stellar.org/docs/data/apis/rpc/providers)
- [Stellar Docs: Stellar RPC](https://developers.stellar.org/docs/data/apis/rpc)
