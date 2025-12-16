/**
 * 7-day Historical Backfill Service
 * Fetches and inserts blocks from the last 7 days
 */

const { ethers } = require('ethers');
const { log, insertBlock, closePool } = require('./lib');

async function backfill() {
  log('info', 'Starting 7-day backfill');

  // Setup provider
  const rpcUrl = process.env.HTTPS_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  log('info', 'Connecting to RPC', { url: rpcUrl });
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    log('info', 'Current block', { blockNumber: currentBlock });

    // Calculate how many blocks for 7 days (assuming 12 second block time)
    // 7 days = 7 * 24 * 60 * 60 / 12 = 50400 blocks
    const blocksIn7d = 50400;
    const startBlock = currentBlock - blocksIn7d + 1;

    log('info', 'Backfill parameters', {
      startBlock,
      endBlock: currentBlock,
      totalBlocks: blocksIn7d
    });

    // Process in batches to avoid rate limits
    const batchSize = 100;
    let processed = 0;
    let inserted = 0;

    for (let i = startBlock; i <= currentBlock; i += batchSize) {
      const endBlock = Math.min(i + batchSize - 1, currentBlock);
      const blockNumbers = [];
      for (let j = i; j <= endBlock; j++) {
        blockNumbers.push(j);
      }

      // Fetch batch
      const blocks = await Promise.all(
        blockNumbers.map(async (num) => {
          try {
            return await provider.getBlock(num);
          } catch (err) {
            log('warn', 'Failed to fetch block', { blockNumber: num, error: err.message });
            return null;
          }
        })
      );

      // Insert batch
      for (const block of blocks) {
        if (block) {
          try {
            const wasInserted = await insertBlock(block, { silent: true });
            if (wasInserted) inserted++;
          } catch (err) {
            log('error', 'Failed to insert block', { blockNumber: block.number, error: err.message });
          }
        }
      }

      processed += blockNumbers.length;
      const progress = ((processed / blocksIn7d) * 100).toFixed(1);
      log('info', 'Progress', {
        percent: `${progress}%`,
        processed: `${processed}/${blocksIn7d}`,
        inserted
      });

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    log('info', 'Backfill complete', { totalInserted: inserted });
    await closePool();
    process.exit(0);
  } catch (err) {
    log('error', 'Backfill failed', { error: err.message, stack: err.stack });
    await closePool();
    process.exit(1);
  }
}

backfill();
