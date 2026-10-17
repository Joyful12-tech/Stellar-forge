# Contract Event Indexing — Requirements

Status: **Scoped, not yet built** · Tracking issue: #943

## Problem

The frontend's entire read path derives state from live RPC calls to Soroban and
Horizon on every page load. There is no off-chain service that ingests factory
events once and serves fast, complete, filterable queries over them.

Three consequences, in order of severity:

1. **History is silently incomplete.** Soroban RPC retains contract events for a
   bounded window (roughly 7 days on public networks). The explorer's token list
   is derived from `getEvents` history, so tokens created before the retention
   window fall out of the list entirely — with no error and no empty state.
   This is not a future scaling concern; it is a correctness bug that grows
   worse the longer a deployment lives.
2. **Latency scales with history.** `fetchAllContractEvents` re-walks the entire
   retained event history on every explorer load, then issues one
   `getTokenInfoByAddress` call per displayed token. Cost is linear in total
   tokens created, paid again on every page load by every visitor (audit finding 23).
3. **RPC availability is a single point of failure.** Any endpoint outage or
   rate-limit event (audit finding 34) takes down all data reading simultaneously. The only
   persistence is a short-TTL in-memory cache (audit finding 21) that dies with the tab.

## Evidence

| Symptom                                       | Location                                           | Status                                                                  |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Fixed 100-event cap dropped the newest tokens | `utils/fetchAllContractEvents.ts`                  | Fixed in `b480f56` (audit finding 22) — replaced with cursor pagination |
| Same cap in the address-search path           | `services/stellar-impl.ts` `getTokenInfoByAddress` | Fixed alongside this spec                                               |
| Sequential pagination latency                 | `hooks/useTokens.ts`                               | Partly mitigated by bounded concurrency (audit finding 23)              |
| Unbounded in-memory cache                     | `hooks/useTokenInfo.ts`                            | Open (audit finding 21)                                                 |

Note that audit finding 22's truncation is **already fixed**. The indexer is therefore a
performance, completeness, and resilience layer — not the fix for it. The
issue text's framing on that point is out of date.

## The retention constraint (drives the whole design)

An indexer built _only_ on `getEvents` inherits the RPC retention window and
cannot backfill beyond it. It would reproduce problem (1) rather than fix it.

The factory contract exposes an authoritative, complete enumeration that does
not depend on event retention:

- `get_state() -> { token_count, ... }`
- `get_token_info(index) -> TokenInfo` for `index` in `0..token_count`

**Backfill must come from these index-based views; events are only used to stay
current.** Any design that skips this is incorrect for any deployment older than
the retention window.

## Requirements

### R1 — Completeness

The "all tokens" view must return every token ever created by the factory,
regardless of age, verified against a deployment with more than 100 tokens.

### R2 — The indexer is a cache, not a source of truth

The chain remains authoritative. The indexer is a read optimization. Any value
it serves must be independently derivable from the contract.

### R3 — Fallback

If the indexer is unreachable, stale beyond threshold, or returns an error, the
frontend must fall back to direct RPC reads and remain functional. This path
must be tested, not merely present.

### R4 — Staleness is visible

Indexer lag (time since the last successfully ingested ledger) must be queryable
and alertable. Silent staleness is worse than a visible outage, because it looks
like correct data.

### R5 — Bounded query cost

`GET /api/tokens` must serve a page in time independent of total token count.

## Non-goals

- Replacing on-chain view functions. The frontend keeps its direct-RPC path.
- Indexing non-factory contracts, or per-holder token balances.
- Serving as an authority for balances, supply, or any consensus-relevant value.
- Real-time push (WebSocket/SSE) to the browser. Polling is sufficient here.

## Open questions

- **Read source account.** `get_token_info` goes through `simulateTransaction`,
  which needs a source account. The frontend uses the connected wallet; a
  server-side indexer has none. Confirm whether an unfunded throwaway account
  simulates successfully, or whether a funded read-only account must be
  provisioned per network.
- **Retention window.** The ~7-day figure needs confirming against the specific
  RPC provider in use before the backfill/steady-state boundary is finalised.
- **Cron floor.** Vercel Hobby caps cron frequency at daily, which is far too
  slow for R4. Confirm the deployment tier before committing to Vercel Cron.
