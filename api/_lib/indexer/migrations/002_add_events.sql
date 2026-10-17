-- Add event storage to the indexer (issue #23).
--
-- This migration adds a table to persist all 15 contract event topics, keyed
-- by token address and ledger sequence. Events can now be served from the
-- indexer rather than falling back to the RPC's bounded retention window.
--
-- This is applied idempotently after 001_init.sql and is safe to replay.

CREATE TABLE IF NOT EXISTS token_events (
  token_address TEXT     NOT NULL,
  ledger_seq    BIGINT   NOT NULL,
  topic         TEXT     NOT NULL,
  payload       JSONB    NOT NULL,
  tx_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (token_address, ledger_seq, topic)
);

-- Keyset pagination index: list events newest-first by ledger for a token
CREATE INDEX IF NOT EXISTS token_events_token_ledger_idx 
  ON token_events (token_address, ledger_seq DESC);

-- Backfill query index: list all events for a token unordered (reconciliation)
CREATE INDEX IF NOT EXISTS token_events_token_idx 
  ON token_events (token_address);
