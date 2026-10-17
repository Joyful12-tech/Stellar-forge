/**
 * Scheduled ingest for the contract-event indexer (issue #943).
 *
 * Invoked every 5 minutes by the `crons` entry in the repo-root `vercel.json`,
 * which is the authoritative config because `api/` lives at the repo root —
 * see docs/indexer.md#deployment. Runs one full cycle:
 * backfill (while incomplete), steady-state event paging, then reconciliation.
 * See `.kiro/specs/contract-event-indexing/design.md`.
 *
 * Required environment:
 *   INDEXER_FACTORY_CONTRACT_ID  factory contract to index
 *   INDEXER_RPC_URL              Soroban RPC endpoint
 *   INDEXER_NETWORK_PASSPHRASE   network passphrase matching the RPC
 *   POSTGRES_URL / DATABASE_URL  durable store (in-memory fallback otherwise)
 *   CRON_SECRET                  set by Vercel; required in production
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runIngest } from '../_lib/indexer/ingest'
import { createSorobanChainReader } from '../_lib/indexer/sorobanChain'
import { getStore } from '../_lib/indexer/store'
import { requireCronAuth } from '../_lib/http'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ingest only writes chain-derived data, but it is not free to run, so an
  // unauthenticated endpoint would be a cheap way to burn RPC quota.
  if (!requireCronAuth(req, res)) return

  const factoryContractId = process.env['INDEXER_FACTORY_CONTRACT_ID']
  const rpcUrl = process.env['INDEXER_RPC_URL']
  const networkPassphrase = process.env['INDEXER_NETWORK_PASSPHRASE']

  if (!factoryContractId || !rpcUrl || !networkPassphrase) {
    res.status(500).json({
      error:
        'Indexer not configured: INDEXER_FACTORY_CONTRACT_ID, INDEXER_RPC_URL and INDEXER_NETWORK_PASSPHRASE are all required',
    })
    return
  }

  const startLedger = process.env['INDEXER_START_LEDGER']

  const store = await getStore()
  const chain = createSorobanChainReader({
    rpcUrl,
    networkPassphrase,
    factoryContractId,
    startLedger: startLedger ? Number(startLedger) : undefined,
  })

  const result = await runIngest(store, chain)

  // `runIngest` never throws: a failed run is reported as a 500 with the
  // details, and the cursor is left where it was so the next run retries the
  // same range instead of skipping past it.
  res.status(result.error ? 500 : 200).json(result)
}
