// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('🔄 Running database migrations...');

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ Table "blocks" created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_created_at
      ON blocks (created_at DESC);
    `);
    console.log('✓ Index "idx_blocks_created_at" created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_block_number_desc
      ON blocks (block_number DESC);
    `);
    console.log('✓ Index "idx_blocks_block_number_desc" created');

    console.log('✅ Migration complete!');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    await pool.end();
    process.exit(1);
  }
}

migrate();
