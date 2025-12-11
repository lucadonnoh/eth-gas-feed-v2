/**
 * Gap Backfill Service
 * Backfills specific missing blocks by block number
 *
 * Usage: node services/backfill-gaps.js <block1> <block2> ...
 */

const { ethers } = require('ethers');
const { log, insertBlock, closePool } = require('./lib');

async function main() {
  const missingBlocks = process.argv.slice(2).map(Number).filter(n => !isNaN(n));

  if (missingBlocks.length === 0) {
    console.log('Usage: node services/backfill-gaps.js <block1> <block2> ...');
    process.exit(1);
  }

  log('info', 'Starting gap backfill', { blocks: missingBlocks });

  const wsUrl = process.env.ETH_WS_RPC_URL || 'wss://ethereum-rpc.publicnode.com';
  const provider = new ethers.WebSocketProvider(wsUrl);

  let inserted = 0;
  let errors = 0;

  for (const blockNum of missingBlocks) {
    try {
      log('info', 'Fetching block', { blockNumber: blockNum });
      const block = await provider.getBlock(blockNum);
      if (block) {
        const wasInserted = await insertBlock(block);
        if (wasInserted) inserted++;
      } else {
        log('warn', 'Block not found', { blockNumber: blockNum });
        errors++;
      }
    } catch (err) {
      log('error', 'Error fetching block', { blockNumber: blockNum, error: err.message });
      errors++;
    }
  }

  provider.destroy();
  await closePool();

  log('info', 'Gap backfill complete', { inserted, errors });
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log('error', 'Fatal error', { error: err.message });
  process.exit(1);
});
