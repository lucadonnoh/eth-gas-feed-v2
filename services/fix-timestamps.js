/**
 * Timestamp Fix Service
 * Fetches and updates missing block timestamps from the Ethereum chain
 */

const { ethers } = require('ethers');
const { log, queryWithRetry, closePool } = require('./lib');

async function fixMissingTimestamps() {
  log('info', 'Finding blocks with missing timestamps');

  const rpcUrl = process.env.HTTPS_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const result = await queryWithRetry(
    'SELECT block_number FROM blocks WHERE block_timestamp IS NULL ORDER BY block_number ASC'
  );

  const blocksToFix = result.rows;
  log('info', 'Blocks with missing timestamps', { count: blocksToFix.length });

  if (blocksToFix.length === 0) {
    log('info', 'All blocks have timestamps');
    return;
  }

  let fixed = 0;
  let errors = 0;

  for (const row of blocksToFix) {
    const blockNumber = Number(row.block_number);

    try {
      const block = await provider.getBlock(blockNumber);

      if (!block) {
        log('warn', 'Block not found on chain', { blockNumber });
        errors++;
        continue;
      }

      const blockTimestamp = new Date(Number(block.timestamp) * 1000);

      await queryWithRetry(
        'UPDATE blocks SET block_timestamp = $1 WHERE block_number = $2',
        [blockTimestamp, blockNumber]
      );

      log('info', 'Block timestamp updated', {
        blockNumber,
        timestamp: blockTimestamp.toISOString()
      });
      fixed++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      log('error', 'Error fixing block', { blockNumber, error: err.message });
      errors++;
    }
  }

  log('info', 'Timestamp fix complete', { fixed, errors });
}

fixMissingTimestamps()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    log('error', 'Fatal error', { error: err.message });
    await closePool();
    process.exit(1);
  });
