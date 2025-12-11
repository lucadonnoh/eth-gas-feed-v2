/**
 * Database Migration Service
 * Creates the blocks table and required indexes
 */

const { log, getPool, closePool } = require('./lib');

async function migrate() {
  log('info', 'Running database migrations');

  const pool = getPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        block_number BIGINT PRIMARY KEY,
        gas_limit BIGINT NOT NULL,
        gas_used BIGINT NOT NULL,
        base_fee NUMERIC(78, 0) NOT NULL,
        blob_count SMALLINT NOT NULL DEFAULT 0,
        blob_base_fee NUMERIC(78, 0) NOT NULL DEFAULT 0,
        excess_blob_gas BIGINT NOT NULL DEFAULT 0,
        block_timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log('info', 'Table "blocks" created or verified');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_created_at
      ON blocks (created_at DESC);
    `);
    log('info', 'Index "idx_blocks_created_at" created or verified');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_block_number_desc
      ON blocks (block_number DESC);
    `);
    log('info', 'Index "idx_blocks_block_number_desc" created or verified');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_block_timestamp
      ON blocks (block_timestamp DESC);
    `);
    log('info', 'Index "idx_blocks_block_timestamp" created or verified');

    log('info', 'Migration complete');
    await closePool();
    process.exit(0);
  } catch (err) {
    log('error', 'Migration failed', { error: err.message, stack: err.stack });
    await closePool();
    process.exit(1);
  }
}

migrate();
