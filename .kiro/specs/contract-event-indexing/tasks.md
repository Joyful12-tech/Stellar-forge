# Contract Event Indexing — Tasks

Milestoned build plan for [design.md](./design.md). Tracking issue: #943.

Milestones are ordered so each one is independently shippable and reversible.

## M0 — Unblock (done in this change)

- [x] Fill in this spec (requirements, design, tasks).
- [x] Fix the surviving 100-event cap in `getTokenInfoByAddress`, which silently
      resolved tokens beyond the first event page to a placeholder record
      instead of their real metadata. Regression-tested in
      `services/stellar-impl.getTokenInfoByAddress.test.ts`.

No infrastructure yet — M0 is spec plus the correctness fix that does not need it.

## M1 — Resolve open questions

Blocked production rollout, not the code. Each is cheap and each can invalidate
part of the _deployment_, so all of them are called out in
[docs/indexer.md](../../../docs/indexer.md#deployment).

Exit: **met** — all open questions answered and the answers recorded below.

- [x] Confirm the RPC provider's event retention window. **Resolved:** ≈7 days
      on SDF public infrastructure, provider-dependent elsewhere — documented in
      [docs/rpc-rate-limits.md](../../../docs/rpc-rate-limits.md#event-retention-constraint).
      Phase A backfill no longer depends on it (see the contract change in M2),
      so this only bounds how far back a cold-started Phase B can pick up `meta`
      events: an indexer down longer than the window must be re-backfilled
      rather than resumed. At the 5-minute cadence that is ~2000 consecutive
      failed runs of margin.
- [x] Confirm whether `simulateTransaction` accepts an unfunded source account
      for `get_token_info`. It does — simulation never touches ledger account
      state — so `sorobanChain.ts` uses a fixed all-zero source account and no
      key material is needed on any network.
- [x] Confirm the Vercel plan's minimum cron interval. **Resolved:** the
      deployment is on Pro, so the 5-minute cadence the lag thresholds assume is
      supported, and `LAG_WARNING_SECONDS` / `LAG_CRITICAL_SECONDS` stay at
      15m / 1h. Hobby would have been daily-only.
- [x] **The cron was never actually scheduled** (issue #1090). This file and
      `docs/indexer.md` both described a `vercel.json` cron entry that neither
      `vercel.json` nor `frontend/vercel.json` had ever contained — Vercel reads
      cron jobs exclusively from that array, so ingest never ran and every
      component below was dead code in every deployment. The app kept working
      (RPC fallback), which is why it went unnoticed. The root `vercel.json` is
      authoritative (`api/` lives at the repo root) and now schedules
      `/api/cron/index-tokens` on `*/5 * * * *`;
      `scripts/check-vercel-cron.mjs` runs in CI so it cannot silently regress.

## M2 — Ingest, no frontend changes

- [x] Schema checked in as a migration
      (`api/_lib/indexer/migrations/001_init.sql`). **Provisioning the database
      itself still needs a human**; without `POSTGRES_URL` the API degrades to
      an in-memory store that `/api/health/indexer` reports as
      `durable: false`.
- [x] **Contract prerequisite discovered while building this.** Phase A was not
      implementable as designed: the factory exposed `address → index`
      (`get_token_index`) but no inverse, and `get_token_info(index)` carries no
      address — so the enumerable key space `1..=token_count` could not be
      resolved to actual tokens, and addresses could only come from `created`
      events, capping any backfill at the event-retention window. Added
      `get_token_address(index) → Address` plus a permissionless, self-verifying
      `backfill_token_address(token_address)` for tokens created before the
      mapping existed.
- [x] Backfill job (Phase A): batched, resumable across cron runs, idempotent.
- [x] Steady-state job (Phase B): cursor-paged `getEvents`, upsert, checkpoint
      advanced only after each page is written.
- [x] Reconciliation: compares `COUNT(*)` to `token_count` and re-reads the
      specific missing indices.
- [x] Tests (`api/_lib/indexer/ingest.test.ts`): idempotent re-ingest,
      cursor-not-advanced-on-error, reconciliation detects a deliberately
      skipped index, plus resumability and metadata-preservation.

Exit: **not yet met** — requires a provisioned database and a testnet run.

## M3 — Read API

- [x] `GET /api/tokens` with keyset pagination and clamped `limit`.
- [x] `GET /api/tokens/:address`, 404 explicitly marked `authoritative: false`
      so a cache miss is never read as non-existence.
- [x] `GET /api/health/indexer` exposing `lagSeconds` and severity.
- [x] Tests (`api/tokens/tokens.test.ts`): 250-row pagination with no
      duplicates and no gaps across page boundaries, `limit` clamping, 404
      shape.
- [x] These tests actually run in CI now — the root `vitest.config.ts` targeted
      `api/**/*.test.ts` but no workflow invoked it and `vitest` was not even a
      declared dependency, so the existing API tests had silently rotted. Added
      an `api` job to `.github/workflows/ci.yml`.

Exit: **not yet met** against testnet (needs a deployment); pagination
completeness past the 100-row cap is proven by unit test.

## M4 — Frontend integration behind fallback

- [x] `TokenSource` interface extracted; the existing RPC path is wrapped with
      no behaviour change.
- [x] `createIndexerTokenSource` and the fallback composer — all four branches
      from design.md.
- [x] Feature flag `VITE_INDEXER_ENABLED`, defaulting to RPC-only.
- [ ] Degraded-mode indicator in the UI. The plumbing exists
      (`StellarService.onIndexerDowngrade` fires on every downgrade); no
      component consumes it yet. Only observable once the flag is on, so this
      is deliberately deferred rather than half-built.
- [x] Tests (`frontend/src/services/tokenSource.test.ts`) for every fallback
      branch, each asserting the RPC path is actually invoked.

Exit: **not yet met** — requires the flag on against a live indexer.

## M5 — Monitoring

- [ ] Alert thresholds from design.md wired to Sentry.
- [ ] Ingest failures reported with the failing cursor range.
- [ ] Runbook: what to do when lag alerts fire, including forced re-backfill.

Exit: a deliberately stalled indexer produces an alert within 15 minutes.

## M6 — Expansion

Only after M4 is proven in production.

- [ ] Per-creator queries served by the indexer (`useTokens`).
- [ ] Search and filter pushed server-side.
- [ ] Transaction history.

## Verification note

Acceptance criterion "verified against a testnet deployment with more than 100
tokens created" is **still unsatisfied**. The ingest, read API and frontend
fallback are implemented and unit-tested against stubbed chain and store
seams — that proves the logic, not the deployment. Satisfying the criterion
needs a provisioned database and a testnet factory with >100 tokens, which is
the remaining work in M1/M2's deployment steps (see
[docs/indexer.md](../../../docs/indexer.md#deployment)).
