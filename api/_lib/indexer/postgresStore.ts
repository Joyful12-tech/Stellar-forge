/**
 * Postgres-backed `TokenStore` for the contract-event indexer (issue #943).
 *
 * Written against a minimal `SqlExecutor` rather than a concrete driver, so
 * this module has no hard dependency on a Postgres client and stays unit
 * testable. `createPostgresStore` adapts whichever driver the deployment
 * provides; `getStore` in `./store.ts` wires it up from the environment.
 *
 * Schema: `./migrations/001_init.sql`, then `./migrations/002_add_events.sql`.
 */

import {
  EMPTY_STATE,
  MAX_PAGE_LIMIT,
  type IndexedToken,
  type IndexerState,
  type ListEventsOptions,
  type ListEventsResult,
  type ListTokensOptions,
  type ListTokensResult,
  type StoredEvent,
  type TokenStore,
} from './types'

/**
 * Executes a parameterized query and returns the rows.
 *
 * Parameters are always passed out-of-band as `$1, $2, …` placeholders — never
 * interpolated into the SQL string — so a hostile `creator` or `cursor` from
 * the query string cannot alter the statement.
 */
export type SqlExecutor = <T = Record<string, unknown>>(
  text: string,
  params: unknown[],
) => Promise<T[]>

interface TokenRow {
  address: string
  token_index: number | string
  name: string
  symbol: string
  decimals: number | string
  creator: string
  created_at: number | string
  metadata_uri: string | null
  source: string
}

/** Postgres returns BIGINT as a string to avoid precision loss; normalize. */
function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' ? value : Number(value)
}

interface EventRow {
  token_address: string
  ledger_seq: number | string
  topic: string
  payload: unknown
  tx_hash: string | null
}

function toEvent(row: EventRow): StoredEvent {
  return {
    tokenAddress: row.token_address,
    ledgerSeq: num(row.ledger_seq),
    topic: row.topic,
    payload: row.payload,
    txHash: row.tx_hash,
  }
}

function toToken(row: TokenRow): IndexedToken {
  return {
    address: row.address,
    tokenIndex: num(row.token_index),
    name: row.name,
    symbol: row.symbol,
    decimals: num(row.decimals),
    creator: row.creator,
    createdAt: num(row.created_at),
    metadataUri: row.metadata_uri,
    source: row.source === 'event' ? 'event' : 'backfill',
  }
}

export function createPostgresStore(sql: SqlExecutor): TokenStore {
  return {
    async upsertTokens(tokens: IndexedToken[]): Promise<void> {
      for (const t of tokens) {
        // `COALESCE(EXCLUDED.metadata_uri, tokens.metadata_uri)` preserves a
        // URI already learned from a `meta` event: `get_token_info` does not
        // carry one, so a backfill re-read would otherwise null it out.
        await sql(
          `INSERT INTO tokens
             (address, token_index, name, symbol, decimals, creator, created_at, metadata_uri, source, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (address) DO UPDATE SET
             token_index  = EXCLUDED.token_index,
             name         = EXCLUDED.name,
             symbol       = EXCLUDED.symbol,
             decimals     = EXCLUDED.decimals,
             creator      = EXCLUDED.creator,
             created_at   = EXCLUDED.created_at,
             metadata_uri = COALESCE(EXCLUDED.metadata_uri, tokens.metadata_uri),
             source       = EXCLUDED.source,
             updated_at   = now()`,
          [
            t.address,
            t.tokenIndex,
            t.name,
            t.symbol,
            t.decimals,
            t.creator,
            t.createdAt,
            t.metadataUri,
            t.source,
          ],
        )
      }
    },

    async setMetadataUri(address: string, metadataUri: string): Promise<void> {
      await sql(`UPDATE tokens SET metadata_uri = $2, updated_at = now() WHERE address = $1`, [
        address,
        metadataUri,
      ])
    },

    async getToken(address: string): Promise<IndexedToken | null> {
      const rows = await sql<TokenRow>(`SELECT * FROM tokens WHERE address = $1`, [address])
      return rows[0] ? toToken(rows[0]) : null
    },

    async listTokens(options: ListTokensOptions): Promise<ListTokensResult> {
      const limit = Math.min(Math.max(options.limit, 1), MAX_PAGE_LIMIT)

      const conditions: string[] = []
      const params: unknown[] = []

      if (options.creator) {
        params.push(options.creator)
        conditions.push(`creator = $${params.length}`)
      }
      if (options.cursor !== undefined) {
        params.push(options.cursor)
        conditions.push(`token_index < $${params.length}`)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      // Fetch one extra row to learn whether a further page exists without a
      // second COUNT query.
      params.push(limit + 1)

      const rows = await sql<TokenRow>(
        `SELECT * FROM tokens ${where} ORDER BY token_index DESC LIMIT $${params.length}`,
        params,
      )

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit).map(toToken)
      const last = page[page.length - 1]

      return {
        tokens: page,
        nextCursor: hasMore && last ? String(last.tokenIndex) : null,
      }
    },

    async countTokens(): Promise<number> {
      const rows = await sql<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM tokens`,
        [],
      )
      return num(rows[0]?.count)
    },

    async presentIndices(indices: number[]): Promise<Set<number>> {
      if (indices.length === 0) return new Set()
      const rows = await sql<{ token_index: number | string }>(
        `SELECT token_index FROM tokens WHERE token_index = ANY($1)`,
        [indices],
      )
      return new Set(rows.map((r) => num(r.token_index)))
    },

    async getState(): Promise<IndexerState> {
      const rows = await sql<{
        last_cursor: string | null
        last_ledger: number | string | null
        last_ledger_close_time: Date | string | null
        last_run_at: Date | string | null
        last_error: string | null
        backfill_complete: boolean
      }>(`SELECT * FROM indexer_state WHERE id = TRUE`, [])

      const row = rows[0]
      if (!row) return { ...EMPTY_STATE }

      const ms = (v: Date | string | null): number | null =>
        v === null ? null : new Date(v).getTime()

      return {
        lastCursor: row.last_cursor,
        lastLedger: row.last_ledger === null ? null : num(row.last_ledger),
        lastLedgerCloseTime: ms(row.last_ledger_close_time),
        lastRunAt: ms(row.last_run_at),
        lastError: row.last_error,
        backfillComplete: Boolean(row.backfill_complete),
      }
    },

    async saveState(patch: Partial<IndexerState>): Promise<void> {
      // Map camelCase fields to columns explicitly — never build column names
      // from caller input.
      const columns: Record<keyof IndexerState, string> = {
        lastCursor: 'last_cursor',
        lastLedger: 'last_ledger',
        lastLedgerCloseTime: 'last_ledger_close_time',
        lastRunAt: 'last_run_at',
        lastError: 'last_error',
        backfillComplete: 'backfill_complete',
      }

      const sets: string[] = []
      const params: unknown[] = []

      for (const [key, column] of Object.entries(columns) as [keyof IndexerState, string][]) {
        if (!(key in patch)) continue
        const value = patch[key]
        params.push(
          key === 'lastLedgerCloseTime' || key === 'lastRunAt'
            ? value === null || value === undefined
              ? null
              : new Date(value as number).toISOString()
            : value,
        )
        sets.push(`${column} = $${params.length}`)
      }

      if (sets.length === 0) return

      await sql(
        `INSERT INTO indexer_state (id) VALUES (TRUE)
         ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')}`,
        params,
      )
    },

    async upsertEvents(events: StoredEvent[]): Promise<void> {
      for (const e of events) {
        // Idempotent on the (token_address, ledger_seq, topic) primary key, so
        // re-ingesting a ledger range after a crash rewrites rows instead of
        // duplicating them.
        await sql(
          `INSERT INTO token_events
             (token_address, ledger_seq, topic, payload, tx_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (token_address, ledger_seq, topic) DO UPDATE SET
             payload = EXCLUDED.payload,
             tx_hash = EXCLUDED.tx_hash`,
          [e.tokenAddress, e.ledgerSeq, e.topic, JSON.stringify(e.payload), e.txHash],
        )
      }
    },

    async listEvents(options: ListEventsOptions): Promise<ListEventsResult> {
      const limit = Math.min(Math.max(options.limit, 1), MAX_PAGE_LIMIT)

      const params: unknown[] = [options.tokenAddress]
      let where = `token_address = $1`

      if (options.cursor !== undefined) {
        params.push(options.cursor)
        where += ` AND ledger_seq < $${params.length}`
      }

      // One extra row to detect a further page without a second COUNT.
      params.push(limit + 1)

      const rows = await sql<EventRow>(
        `SELECT token_address, ledger_seq, topic, payload, tx_hash
           FROM token_events
          WHERE ${where}
          ORDER BY ledger_seq DESC, topic ASC
          LIMIT $${params.length}`,
        params,
      )

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit).map(toEvent)
      const last = page[page.length - 1]

      return {
        events: page,
        nextCursor: hasMore && last ? String(last.ledgerSeq) : null,
      }
    },
  }
}
