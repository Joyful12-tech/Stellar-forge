/**
 * Safety gate for destructive reconciliation (issue #1156).
 *
 * Pin reconciliation treats "this CID is not in the indexer" as "this CID is
 * unreferenced, unpin it". That inference is only sound when the indexer is
 * actually complete and current. Three states break it, and all three look
 * like a perfectly successful query from the caller's point of view:
 *
 * 1. The instance degraded to an empty in-memory store while a durable one is
 *    configured — every read returns nothing.
 * 2. Backfill has not finished — tokens deployed before the indexer started
 *    are simply absent, and at 200 tokens per 5-minute run a large factory can
 *    take many hours to catch up.
 * 3. Steady-state ingest has fallen behind — recent `meta` events are missing.
 *
 * This module answers "is the indexer trustworthy enough to delete things?"
 * for both the cron job and `/api/health/indexer`, so the refusal is
 * observable rather than silent.
 */

import { getStore, getStoreHealth } from './indexer/store'
import { lagSeconds, LAG_WARNING_SECONDS } from './indexer/ingest'

/** Machine-readable reasons reconciliation refuses to run its unpin phase. */
export type ReadinessBlocker =
  | 'store_degraded'
  | 'store_unreachable'
  | 'backfill_incomplete'
  | 'never_ingested'
  | 'indexer_lagging'

export interface ReconciliationReadiness {
  /** True only when destructive classification is safe. */
  ready: boolean
  /** Why not, or `null` when ready. */
  blocker: ReadinessBlocker | null
  /** Human-readable detail for logs and the health endpoint. */
  detail: string | null
  /** Observed ingest lag in seconds, when known. */
  lagSeconds: number | null
  /** Whether backfill has completed, when known. */
  backfillComplete: boolean | null
}

const READY: ReconciliationReadiness = {
  ready: true,
  blocker: null,
  detail: null,
  lagSeconds: null,
  backfillComplete: null,
}

/**
 * Decide whether the indexer's token set can be trusted as the complete,
 * authoritative "still referenced" set.
 *
 * Never throws: any failure to answer is itself a blocker, because an
 * unanswerable question must not be read as a yes.
 */
export async function checkReconciliationReadiness(
  now: number = Date.now(),
): Promise<ReconciliationReadiness> {
  let backfillComplete: boolean | null = null
  let lag: number | null = null

  try {
    const store = await getStore(now)
    const health = getStoreHealth()

    // A durable backend is configured but this instance is not using it: the
    // store is empty for reasons that have nothing to do with the chain.
    if (health.durableConfigured && !health.usingDurableStore) {
      return {
        ready: false,
        blocker: 'store_degraded',
        detail: `durable store configured but unreachable${
          health.lastDurableError ? `: ${health.lastDurableError}` : ''
        }`,
        lagSeconds: null,
        backfillComplete: null,
      }
    }

    const state = await store.getState()
    backfillComplete = state.backfillComplete
    lag = lagSeconds(state, now)

    if (state.lastRunAt === null) {
      return {
        ready: false,
        blocker: 'never_ingested',
        detail: 'indexer has never completed a run',
        lagSeconds: lag,
        backfillComplete,
      }
    }

    if (!state.backfillComplete) {
      return {
        ready: false,
        blocker: 'backfill_incomplete',
        detail: 'indexer backfill has not finished; token set is partial',
        lagSeconds: lag,
        backfillComplete,
      }
    }

    if (lag === null) {
      return {
        ready: false,
        blocker: 'never_ingested',
        detail: 'indexer has no ledger close time; lag is unknown',
        lagSeconds: null,
        backfillComplete,
      }
    }

    if (lag > LAG_WARNING_SECONDS) {
      return {
        ready: false,
        blocker: 'indexer_lagging',
        detail: `indexer is ${lag}s behind (limit ${LAG_WARNING_SECONDS}s)`,
        lagSeconds: lag,
        backfillComplete,
      }
    }

    return { ...READY, lagSeconds: lag, backfillComplete }
  } catch (err) {
    return {
      ready: false,
      blocker: 'store_unreachable',
      detail: `store query failed: ${err instanceof Error ? err.message : String(err)}`,
      lagSeconds: lag,
      backfillComplete,
    }
  }
}
