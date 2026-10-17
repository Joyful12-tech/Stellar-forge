-- Contract event indexer schema (issue #943).
-- Apply once per environment before enabling the ingest cron.
--
-- The indexer is a read-optimization layer, never a source of truth: every
-- row here is re-derivable from the chain, so this schema may be dropped and
-- rebuilt by letting the backfill run again.

CREATE TABLE IF NOT EXISTS tokens (
  address       TEXT PRIMARY KEY,
  token_index   INTEGER  NOT NULL UNIQUE,   -- contract enumeration order
  name          TEXT     NOT NULL,
  symbol        TEXT     NOT NULL,
  decimals      SMALLINT NOT NULL,
  creator       TEXT     NOT NULL,
  created_at    BIGINT   NOT NULL,          -- unix seconds
  metadata_uri  TEXT,
  source        TEXT     NOT NULL CHECK (source IN ('backfill', 'event')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keyset pagination indexes: both listing paths order by token_index DESC and
-- seek with `token_index < cursor`, so page cost does not grow with depth.
CREATE INDEX IF NOT EXISTS tokens_creator_idx ON tokens (creator, token_index DESC);
CREATE INDEX IF NOT EXISTS tokens_index_idx   ON tokens (token_index DESC);

-- Single-row checkpoint. Survives function restarts and makes lag queryable.
-- The `id` column is a constant TRUE so the table can hold at most one row.
CREATE TABLE IF NOT EXISTS indexer_state (
  id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_cursor            TEXT,        -- getEvents paging token
  last_ledger            BIGINT,
  last_ledger_close_time TIMESTAMPTZ, -- drives the lag metric
  last_run_at            TIMESTAMPTZ,
  last_error             TEXT,
  backfill_complete      BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO indexer_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
