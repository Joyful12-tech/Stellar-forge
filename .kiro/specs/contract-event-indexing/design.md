# Contract Event Indexing — Design

Companion to [requirements.md](./requirements.md). Tracking issue: #943.

## Decision: serverless cron, not a dedicated service

**Chosen: a scheduled serverless function writing to a managed Postgres, with
read routes served from the same deployment.**

| Option                       | Verdict                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serverless cron + managed DB | **Chosen.** Workload is a periodic poll over a low-volume event stream and a keyset-paginated read. No long-lived connections needed. Deploys with the existing Vercel project; no new infrastructure to operate. |
| Dedicated always-on service  | Rejected for v1. Justified only by a Soroban event _subscription_ (push), which the RPC does not offer — so the service would poll on a timer anyway, i.e. a cron with extra operational cost.                    |
| Client-side IndexedDB cache  | Rejected as the primary fix. Per-browser, cold on first visit, and cannot fix the retention gap (R1). Complementary later, not a substitute.                                                                      |

Revisit if event volume outgrows a single function invocation's budget, or if
Soroban gains a real subscription API.

### Storage

Postgres (Vercel Postgres / Neon). Chosen over Cloudflare D1 because the
deployment target is already Vercel, and because keyset pagination over a
partial index is a well-trodden Postgres path. D1 would force a second vendor
into the deploy story for no gain at this scale.

> The `token_count` on a mature factory is in the thousands, not millions. This
> schema is deliberately boring; the constraint is correctness, not throughput.

```sql
CREATE TABLE tokens (
  address       TEXT PRIMARY KEY,
  token_index   INTEGER NOT NULL UNIQUE,   -- contract enumeration order
  name          TEXT   NOT NULL,
  symbol        TEXT   NOT NULL,
  decimals      SMALLINT NOT NULL,
  creator       TEXT   NOT NULL,
  created_at    BIGINT NOT NULL,           -- unix seconds
  metadata_uri  TEXT,
  source        TEXT   NOT NULL,           -- 'backfill' | 'event'
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tokens_creator_idx ON tokens (creator, token_index DESC);
CREATE INDEX tokens_index_idx   ON tokens (token_index DESC);

-- Single-row checkpoint. Survives function restarts; makes lag queryable.
CREATE TABLE indexer_state (
  id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_cursor            TEXT,        -- getEvents paging token
  last_ledger            BIGINT,
  last_ledger_close_time TIMESTAMPTZ, -- drives the lag metric (R4)
  last_run_at            TIMESTAMPTZ,
  last_error             TEXT,
  backfill_complete      BOOLEAN NOT NULL DEFAULT FALSE
);
```

## Ingest

Two phases, because of the retention constraint in requirements.md.

**Phase A — backfill (once, resumable).** Read `get_state().token_count`, then
walk `get_token_info(i)` for every `i` not already present, in batches.
Idempotent: re-running skips rows already stored. Sets
`backfill_complete = true` when `COUNT(*) = token_count`. This is the only
phase that can recover tokens older than the RPC event-retention window.

**Phase B — steady state (every run).** Page `getEvents` from `last_cursor`,
upsert `created` events, apply the newest `meta` event per token, then advance
the checkpoint. On any error, record `last_error` and leave the cursor
untouched so the next run retries the same range — at-least-once delivery with
idempotent upserts, rather than at-most-once with silent gaps.

**Reconciliation.** Each run compares `COUNT(*)` against
`get_state().token_count`. A mismatch means an event was missed or the cursor
skipped a range; it re-triggers Phase A for the missing indices. This is the
backstop that keeps at-least-once delivery honest, and it is cheap.

Cadence: every 5 minutes. See the Vercel Hobby cron caveat in requirements.md.

## API

All routes are read-only and public. Pagination is keyset, not `OFFSET` — the
cost of `OFFSET n` grows with `n`, violating R5.

```
GET /api/tokens?creator=<G...>&cursor=<token_index>&limit=<1..100>
  -> { tokens: TokenInfo[], nextCursor: string | null, indexedAt: string }

GET /api/tokens/:address
  -> TokenInfo & { indexedAt: string }        // 404 when genuinely absent

GET /api/health/indexer
  -> { lagSeconds, lastLedger, backfillComplete, lastError, healthy }
```

`limit` is clamped server-side to 100. `indexedAt` is returned on every payload
so the client can surface staleness rather than presenting cached data as live.

`TokenInfo` matches the existing frontend type exactly, so the indexer is a
drop-in behind the current interface.

## Frontend integration and fallback (R3)

Introduce a `TokenSource` seam with two implementations behind one interface —
`IndexerTokenSource` and the existing `RpcTokenSource` — composed by a wrapper
that tries the indexer and falls back:

```
getTokens(...)
  ├─ indexer: ok and fresh   -> return
  ├─ indexer: error/timeout  -> RPC, log downgrade
  ├─ indexer: lag > MAX_LAG  -> RPC, log downgrade
  └─ indexer: 404 on address -> RPC (may be newer than last ingest)
```

Three rules that make this safe:

- **Timeout, don't hang.** The indexer call gets a short deadline (~2s); a slow
  indexer must degrade to RPC, never stall the page.
- **404 is not authoritative.** A token created since the last ingest is legitimately
  absent. Address lookups must fall through to RPC on 404 — otherwise the indexer
  turns "too new" into "does not exist", exactly the class of silent-wrong-answer
  bug this spec exists to remove.
- **Fallback is visible.** Surface a "showing live chain data" indicator when
  degraded, so a permanently-broken indexer cannot hide behind a working app.

Testing (R3): unit tests per branch above with a stubbed indexer — success,
error, timeout, stale-lag, and 404-falls-through — asserting the RPC path is
actually exercised, plus a manual runbook step for a real indexer outage.

## Monitoring (R4)

`lagSeconds = now() - last_ledger_close_time`, exposed by `/api/health/indexer`.

| Condition                                                  | Severity                        |
| ---------------------------------------------------------- | ------------------------------- |
| `lagSeconds > 15m`                                         | warning                         |
| `lagSeconds > 1h`, or `last_error` set on consecutive runs | page                            |
| `backfill_complete = false` for > 24h                      | warning                         |
| `COUNT(*) != token_count` after reconciliation             | page — indicates real data loss |

Report ingest failures to the existing Sentry setup (`lib/monitoring/sentry`)
rather than introducing a second alerting path.

## Rollout

1. Deploy ingest + DB. Do not wire the frontend. Let backfill complete.
2. Verify `COUNT(*) == token_count` on testnet with >100 tokens (R1).
3. Put the explorer list behind `TokenSource` with the indexer enabled and
   fallback active. Measure the downgrade rate.
4. Extend to per-creator queries and search once the list view is proven.

Rollback is a feature flag: point `TokenSource` at RPC only. Because the
indexer never becomes a source of truth (R2), rollback loses speed, not data.
