// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
const { Pool } = require('pg');

async function addTimestampColumn() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('🔄 Adding block_timestamp column...');

  try {
    // Add block_timestamp column
    await pool.query(`
      ALTER TABLE blocks
      ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
    `);
    console.log('✓ Column "block_timestamp" added');

    // Create index on block_timestamp
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_block_timestamp
      ON blocks (block_timestamp DESC);
    `);
    console.log('✓ Index "idx_blocks_block_timestamp" created');

    console.log('✅ Migration complete!');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    await pool.end();
    process.exit(1);
  }
}

addTimestampColumn();
