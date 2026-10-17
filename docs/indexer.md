# Off-chain contract event indexer

Implementation of [`.kiro/specs/contract-event-indexing/`](../.kiro/specs/contract-event-indexing/), tracking issue #943.

The indexer ingests factory events and token records into Postgres and serves
fast, complete, paginated queries over them. It exists because the frontend's
data layer previously re-derived everything from live RPC calls on every page
load, which silently truncated the token list at the RPC's 100-event page cap
and could not see tokens older than the event-retention window at all.

> **The indexer is never a source of truth.** Every value it serves is
> re-derivable from the chain. A broken, slow, or stale indexer degrades to
> direct RPC — it can make reads faster, never change whether they succeed.
> Rollback is a feature flag, and because of that it loses speed, not data.

## Components

| Path                                   | Role                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `api/_lib/indexer/types.ts`            | `TokenStore` seam, row shapes, `limit`/`cursor` clamping |
| `api/_lib/indexer/ingest.ts`           | Backfill, steady-state paging, reconciliation            |
| `api/_lib/indexer/sorobanChain.ts`     | Soroban RPC reads (view calls + `getEvents`)             |
| `api/_lib/indexer/postgresStore.ts`    | Postgres implementation of `TokenStore`                  |
| `api/_lib/indexer/memoryStore.ts`      | In-memory store for tests and local dev                  |
| `api/_lib/indexer/store.ts`            | Store selection, durable-connect retry, health signal    |
| `api/_lib/reconciliationReadiness.ts`  | Safety gate destructive consumers must pass              |
| `api/cron/index-tokens.ts`             | Scheduled ingest entrypoint                              |
| `api/tokens/`, `api/health/`           | Read API                                                 |
| `frontend/src/services/tokenSource.ts` | `TokenSource` seam and the RPC fallback composer         |

## Ingest

Two phases, because the RPC only retains events for a bounded window.

**Phase A — backfill.** Walks `1..=get_state().token_count`, resolving each
index through `get_token_address(index)` and `get_token_info(index)`. This is
the only phase that can recover tokens older than the retention window.
Resumable across cron runs and idempotent.

**Phase B — steady state.** Pages `getEvents` from the stored cursor, upserting
`created` events and applying `meta` events.

**Retention window — resolved.** Soroban RPC prunes contract events after a
bounded window: **≈7 days on SDF public infrastructure**, provider-dependent
elsewhere (see [rpc-rate-limits.md](./rpc-rate-limits.md#event-retention-constraint)).
That window bounds only how far back a _cold-started_ Phase B can pick up `meta`
events; it does not bound the indexer's coverage, because Phase A resolves token
identity from contract state, which has no retention window. The practical
consequence: an indexer that is down longer than the window must be re-backfilled
rather than resumed, and at a 5-minute cadence it has ~2000 consecutive failed
runs of margin before that happens.

Delivery is **at-least-once**: the cursor advances only after a page has been
written, so a crash mid-run replays that range rather than skipping it. Every
write is an idempotent upsert, which is what makes replay safe.

**Reconciliation** compares `COUNT(*)` against `token_count` on every run and
re-reads any missing indices. This is the backstop that keeps at-least-once
delivery honest when a cursor range is lost entirely.

### Contract support

Backfill depends on `get_token_address(index) → Address`, added to the factory
for this work. `get_token_info(index)` carries no address, so without the
reverse mapping the enumerable key space `1..=token_count` could not be
resolved to actual tokens and a cold backfill was impossible — addresses could
only be learned from `created` events, capping recovery at the retention
window.

Tokens created by a factory binary predating that mapping return
`TokenNotFound`. Repair them with `backfill_token_address(token_address)`,
which is permissionless but self-verifying: it reads the index back from the
token's own `TokenIndex(address)` entry rather than trusting the caller.

## Read API

```
GET /api/tokens?creator=<G…>&cursor=<token_index>&limit=<1..100>
  -> { tokens: [...], nextCursor: string | null, indexedAt: string | null }

GET /api/tokens/:address
  -> { ...token, indexedAt } | 404 { error, authoritative: false }

GET /api/health/indexer
  -> { healthy, severity, lagSeconds, lastLedger, lastRunAt, lastError,
       backfillComplete, indexedCount, durable }
```

Pagination is keyset (`token_index < cursor`), not `OFFSET`, so page cost does
not grow with depth. `limit` is clamped server-side to 100.

**A 404 is not authoritative.** A token created since the last ingest run is
legitimately absent, so clients must fall through to RPC. Treating a cache miss
as non-existence is exactly the silent-wrong-answer bug the indexer exists to
remove, which is why the payload says so explicitly.

## Frontend integration

Off by default. Set `VITE_INDEXER_ENABLED=true` to opt in. When enabled, reads
go through `createFallbackTokenSource`, which degrades to RPC on any of:

| Branch                | Behaviour                                                     |
| --------------------- | ------------------------------------------------------------- |
| indexer ok and fresh  | serve indexed data                                            |
| error                 | RPC, log downgrade                                            |
| timeout (2s default)  | RPC, log downgrade — a slow indexer must never stall the page |
| lag > 15 min          | RPC, log downgrade                                            |
| 404 on address lookup | RPC — the token may be newer than the last ingest             |

`StellarService.onIndexerDowngrade` fires on every downgrade so the degradation
rate stays observable and a permanently broken indexer cannot hide behind a
working app.

## Deployment

Everything below needs a human — the code is complete, the infrastructure is
not provisioned.

### Which `vercel.json` is authoritative

**The repo-root `vercel.json`.** The serverless functions live in `api/` at the
repo root and the frontend calls them same-origin (`/api/ipfs/*`,
`/api/health/*`, `/api/tokens/*`), so the deployed project's Root Directory
must be the repo root — a project rooted at `frontend/` ships no functions at
all. `frontend/vercel.json` only carries response headers for that
frontend-only case and must never declare `crons`; the check described below
enforces both halves.

This matters because Vercel reads cron jobs **exclusively** from a `crons`
array in the deployed project's `vercel.json`. Issue #1090: this file and the
spec both described a 5-minute cron that no config file had ever contained, so
the indexer never ran, the store stayed empty and `/api/health/indexer`
returned `healthy: false` forever. Nothing broke visibly, because the frontend
falls back to direct RPC — which is precisely why it went unnoticed.

`npm run check:vercel-cron` (wired into the CI `drift-checks` job) fails the
build if the root `vercel.json` stops scheduling `/api/cron/index-tokens`, if a
scheduled path has no handler on disk, or if the cadence drifts coarser than
`LAG_WARNING_SECONDS`. Run it before every production deploy.

1. **Provision Postgres** (Vercel Postgres / Neon) and set `POSTGRES_URL`.
   Install the driver: `npm install @neondatabase/serverless` (override with
   `INDEXER_PG_DRIVER` if using a different one). Without `POSTGRES_URL` the
   API falls back to a per-process in-memory store, which `/api/health/indexer`
   reports as `durable: false` and never `healthy`.
2. **Apply the schema**: `api/_lib/indexer/migrations/001_init.sql`.
3. **Set the ingest environment**:

   | Variable                      | Purpose                                   |
   | ----------------------------- | ----------------------------------------- |
   | `INDEXER_FACTORY_CONTRACT_ID` | Factory contract to index                 |
   | `INDEXER_RPC_URL`             | Soroban RPC endpoint                      |
   | `INDEXER_NETWORK_PASSPHRASE`  | Must match the RPC's network              |
   | `INDEXER_START_LEDGER`        | Optional first ledger for the initial run |
   | `CRON_SECRET`                 | Set by Vercel; **required** in production |

   The cron endpoint refuses to run in production without `CRON_SECRET`, so a
   misconfigured deployment fails closed rather than leaving an unauthenticated
   endpoint that burns RPC quota.

4. **Cron cadence — resolved.** The root `vercel.json` schedules
   `/api/cron/index-tokens` on `*/5 * * * *`, the cadence design.md's lag
   thresholds assume. This **requires a Pro or Enterprise plan**: Vercel Hobby
   accepts daily crons only, and the deployment is on Pro. If that ever changes,
   the two must move together — a daily cadence with a 15-minute warning
   threshold reports a permanent lag warning on a perfectly healthy indexer, so
   `LAG_WARNING_SECONDS` / `LAG_CRITICAL_SECONDS` in `api/_lib/indexer/ingest.ts`
   would have to be relaxed to roughly 26h / 50h. `check-vercel-cron.mjs` fails
   the build if the cadence and the thresholds disagree.

   Vercel authenticates the invocation with `Authorization: Bearer $CRON_SECRET`,
   so `CRON_SECRET` must be set in the project before the first scheduled run —
   otherwise every invocation returns 401 and the symptom is indistinguishable
   from no cron at all.

5. **Let the backfill finish** before enabling the frontend flag. Poll
   `/api/health/indexer` until `backfillComplete` is true and `indexedCount`
   equals the factory's `token_count`.
6. **Enable the frontend** with `VITE_INDEXER_ENABLED=true` and watch the
   downgrade rate.

## Consuming the indexer destructively

Reads that only _display_ data can treat a partial indexer as a cache miss —
the frontend falls back to RPC and nothing is lost. A consumer that **deletes**
something because a row is absent cannot: to it, "not yet indexed" and "does
not exist" are the same answer. IPFS pin reconciliation is the one such
consumer, and issue #1156 is what happens when that distinction is skipped.

Three ordinary, non-adversarial states make the token set incomplete while
every query still succeeds:

| State                      | Why the set is incomplete                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Store degraded to memory   | A durable backend is configured but this instance could not connect, so it serves an empty in-memory store.                                 |
| Backfill unfinished        | Phase A moves at most `BACKFILL_BATCH_SIZE × MAX_BACKFILL_BATCHES_PER_RUN` = 200 tokens per 5-minute run; a few thousand tokens take hours. |
| Steady-state ingest behind | Recent `created`/`meta` events have not been applied yet.                                                                                   |

`checkReconciliationReadiness()` (`api/_lib/reconciliationReadiness.ts`) is the
single gate for all three. It returns `ready: false` with a `blocker` of
`store_degraded`, `store_unreachable`, `never_ingested`, `backfill_incomplete`
or `indexer_lagging`, and never throws — an unanswerable question is itself a
refusal. Destructive callers must treat `ready: false` exactly like a thrown
error.

**The store no longer caches a degrade.** `getStore()` used to cache the
in-memory fallback in a module-level variable on the first failed connect, so
one cold-start blip made every later read on that warm instance return nothing,
silently, for the instance's lifetime. It now retries the durable connection
after `DURABLE_RETRY_BACKOFF_MS` (30s) and reports the degrade through
`getStoreHealth()` — `durableConfigured && !usingDurableStore` is the signal
that reads are meaningless.

## Monitoring

`lagSeconds = now − last_ledger_close_time`, from `/api/health/indexer`.

| Condition                                              | Severity                                             |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `lagSeconds > 15m`                                     | warning                                              |
| `lagSeconds > 1h`, or `lastError` set                  | page                                                 |
| `backfillComplete = false` for > 24h                   | warning                                              |
| `indexedCount != token_count` after reconcile          | page — indicates real data loss                      |
| `durableStoreConnected = false` while `durable = true` | page — instance is serving an empty store            |
| `reconciliationReady = false` for > 24h                | warning — orphaned pins are accumulating unreclaimed |

`/api/health/indexer` carries the two reconciliation fields alongside the
freshness ones:

- `durableStoreConnected` — whether this instance is actually on the durable
  backend, as opposed to `durable`, which only says one is configured.
- `reconciliationReady` / `reconciliationBlocker` — whether pin reconciliation
  is allowed to delete anything right now, and if not, why.

## Local development

No database needed: without `POSTGRES_URL` the in-memory store is used, so the
API and cron endpoint run standalone. Tests use it directly (`npm test` at the
repo root). With no `POSTGRES_URL` configured the in-memory store is the
_intended_ backend rather than a degrade, so `getStoreHealth()` reports
`durableConfigured: false` and reconciliation gates on backfill and lag alone.
