// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const provider = new ethers.JsonRpcProvider(rpcUrl);

async function fixMissingTimestamps() {
  console.log('🔍 Finding blocks with missing timestamps...');

  const result = await pool.query(
    'SELECT block_number FROM blocks WHERE block_timestamp IS NULL ORDER BY block_number ASC'
  );

  const blocksToFix = result.rows;
  console.log(`📊 Found ${blocksToFix.length} blocks with missing timestamps`);

  if (blocksToFix.length === 0) {
    console.log('✅ All blocks have timestamps!');
    return;
  }

  for (const row of blocksToFix) {
    const blockNumber = Number(row.block_number);

    try {
      // Fetch block from Ethereum
      const block = await provider.getBlock(blockNumber);

      if (!block) {
        console.log(`⚠️  Block ${blockNumber} not found on chain`);
        continue;
      }

      const blockTimestamp = new Date(Number(block.timestamp) * 1000);

      // Update the database
      await pool.query(
        'UPDATE blocks SET block_timestamp = $1 WHERE block_number = $2',
        [blockTimestamp, blockNumber]
      );

      console.log(`✓ Updated block ${blockNumber} with timestamp ${blockTimestamp.toISOString()}`);

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (err) {
      console.error(`❌ Error fixing block ${blockNumber}:`, err.message);
    }
  }

  console.log('✅ Timestamp fix complete!');
}

fixMissingTimestamps()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    pool.end();
    process.exit(1);
  });
