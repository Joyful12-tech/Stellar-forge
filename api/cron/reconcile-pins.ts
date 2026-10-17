/**
 * Scheduled IPFS pin reconciliation.
 *
 * Runs on the schedule configured in repo-root `vercel.json`. Lists all pins
 * from the Pinata account, cross-references them against on-chain `meta`
 * events stored by the indexer, and unpins anything orphaned past a 24-hour
 * grace window.
 *
 * The indexer's token set is only a valid "still referenced" set when the
 * indexer is durable, fully backfilled and current. Anything less looks
 * identical to "these CIDs are unreferenced" and would mass-unpin live user
 * metadata (issue #1156), so the unpin phase runs behind
 * `checkReconciliationReadiness()` and a per-run circuit breaker.
 *
 * Operator controls (query params on an authenticated invocation, or env):
 *
 * - `?dryRun=1` / `RECONCILE_PINS_DRY_RUN=true` — classify and log what would
 *   be unpinned without calling Pinata. Use this after any ingest or store
 *   change before letting a destructive run happen.
 * - `?override=1` / `RECONCILE_PINS_OVERRIDE_CIRCUIT_BREAKER=true` — allow a
 *   run to exceed the mass-unpin ratio. Manual, deliberate, and only after the
 *   reference set has been verified by a dry run.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runReconciliation, type ReconciliationResult } from '../_lib/pinReconciliation'
import { getStore } from '../_lib/indexer/store'
import {
  checkReconciliationReadiness,
  type ReconciliationReadiness,
} from '../_lib/reconciliationReadiness'
import { firstQueryValue, requireCronAuth } from '../_lib/http'

/** Read a boolean toggle from either a query parameter or an env var. */
function flagEnabled(req: VercelRequest, param: string, envVar: string): boolean {
  const value = firstQueryValue(req.query?.[param])
  if (value === '1' || value === 'true') return true
  return process.env[envVar] === 'true'
}

/**
 * Collect all on-chain metadata URIs from the indexer store.
 *
 * The caller must have passed `checkReconciliationReadiness()` first: this
 * function cannot tell a complete token set from a partial one, and a partial
 * one read as complete is what deletes live metadata.
 */
async function getMetadataUrisFromIndexer(): Promise<string[]> {
  const store = await getStore()
  const uris: string[] = []
  let cursor: number | undefined = undefined

  for (;;) {
    const result = await store.listTokens({ limit: 100, cursor })
    for (const token of result.tokens) {
      if (token.metadataUri) {
        uris.push(token.metadataUri)
      }
    }
    if (!result.nextCursor) break
    cursor = Number(result.nextCursor)
  }

  return uris
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Reconciliation is read-heavy (Pinata pinList) and write-heavy for
  // orphaned pins, so it must be authenticated.
  if (!requireCronAuth(req, res)) return

  const dryRun = flagEnabled(req, 'dryRun', 'RECONCILE_PINS_DRY_RUN')
  const overrideCircuitBreaker = flagEnabled(
    req,
    'override',
    'RECONCILE_PINS_OVERRIDE_CIRCUIT_BREAKER',
  )

  // Evaluated once and reported, so the refusal is observable in the cron
  // response as well as in the logs and `/api/health/indexer`.
  let readiness: ReconciliationReadiness | null = null
  const result: ReconciliationResult = await runReconciliation(
    () => getMetadataUrisFromIndexer(),
    Date.now(),
    {
      checkReadiness: async () => {
        readiness = await checkReconciliationReadiness()
        return { ready: readiness.ready, detail: readiness.detail }
      },
      dryRun,
      overrideCircuitBreaker,
    },
  )

  // Always return 200 so the cron scheduler doesn't retry on expected
  // outcomes (e.g. not-ready indexer, no orphaned pins). The response body
  // carries the actual status.
  res.status(200).json({
    ...result,
    readiness,
    overrideCircuitBreaker,
  })
}
