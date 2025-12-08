-- Ethereum block data schema for eth-gas-feed v2
-- Run this against your Railway/Neon Postgres database

CREATE TABLE IF NOT EXISTS blocks (
  block_number BIGINT PRIMARY KEY,
  gas_limit BIGINT NOT NULL,
  gas_used BIGINT NOT NULL,
  base_fee NUMERIC(78, 0) NOT NULL,
  blob_count SMALLINT NOT NULL DEFAULT 0,
  blob_base_fee NUMERIC(78, 0) NOT NULL DEFAULT 0,
  excess_blob_gas BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-based queries (cleanup, recent blocks)
CREATE INDEX IF NOT EXISTS idx_blocks_created_at ON blocks (created_at DESC);

-- Index for block range queries (fetching latest blocks)
CREATE INDEX IF NOT EXISTS idx_blocks_block_number_desc ON blocks (block_number DESC);
