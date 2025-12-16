/**
 * Ethereum Block Ingestion Service
 * Real-time block streaming via WebSocket with automatic gap detection and backfill
 */

const { ethers } = require('ethers');
const {
  log,
  testConnection,
  insertBlock,
  getLatestBlockNumber,
  cleanupOldBlocks,
  findGaps,
  closePool,
} = require('./lib');

// Track last successful block insert for heartbeat monitoring
let lastBlockTimestamp = Date.now();
let isReconnecting = false;
let provider = null;
let lastProcessedBlockNumber = null;
let isCheckingGaps = false;

/**
 * Backfill missing blocks from RPC
 */
async function backfillMissingBlocks(fromBlock, toBlock) {
  const totalBlocks = toBlock - fromBlock + 1;
  log('info', 'Starting backfill', { fromBlock, toBlock, totalBlocks });

  const blockNumbers = [];
  for (let i = fromBlock; i <= toBlock; i++) {
    blockNumbers.push(i);
  }

  // Batch fetch blocks in chunks to avoid overwhelming RPC
  const chunkSize = 100;
  for (let i = 0; i < blockNumbers.length; i += chunkSize) {
    const chunk = blockNumbers.slice(i, i + chunkSize);
    log('info', 'Fetching block chunk', {
      chunkStart: chunk[0],
      chunkEnd: chunk[chunk.length - 1],
      progress: `${Math.min(i + chunkSize, blockNumbers.length)}/${blockNumbers.length}`
    });

    const blocks = await Promise.all(
      chunk.map(num => provider.getBlock(num).catch(err => {
        log('warn', 'Failed to fetch block', { blockNumber: num, error: err.message });
        return null;
      }))
    );

    for (const block of blocks) {
      if (block) {
        try {
          await insertBlock(block, { silent: true });
        } catch (err) {
          log('error', 'Failed to insert block', { blockNumber: block.number, error: err.message });
        }
      }
    }
  }

  log('info', 'Backfill completed', { totalBlocks });
}

/**
 * Check for and backfill all gaps in the database
 * @param {boolean} silent - If true, don't log "no gaps found" message
 */
async function detectAndBackfillGaps(silent = false) {
  // Prevent overlapping gap checks
  if (isCheckingGaps) {
    log('debug', 'Gap check already in progress, skipping');
    return;
  }

  isCheckingGaps = true;
  try {
    if (!silent) {
      log('info', 'Checking for gaps in database');
    }

    const gaps = await findGaps();

    if (gaps.length === 0) {
      if (!silent) {
        log('info', 'No gaps found in database');
      }
      return;
    }

    const totalMissing = gaps.reduce((sum, gap) => sum + Number(gap.missing_count), 0);
    log('info', 'Gaps detected', { gapCount: gaps.length, totalMissingBlocks: totalMissing });

    // Backfill each gap
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i];
      const fromBlock = Number(gap.after_block) + 1;
      const toBlock = Number(gap.before_block) - 1;

      log('info', 'Backfilling gap', {
        gapNumber: i + 1,
        totalGaps: gaps.length,
        fromBlock,
        toBlock,
        missingCount: gap.missing_count
      });

      await backfillMissingBlocks(fromBlock, toBlock);
    }

    log('info', 'All gaps backfilled successfully', { totalGaps: gaps.length, totalMissing });
  } catch (err) {
    log('error', 'Failed to detect/backfill gaps', { error: err.message });
  } finally {
    isCheckingGaps = false;
  }
}

/**
 * Start periodic gap detection (runs every 10 minutes)
 */
function startPeriodicGapCheck() {
  const TEN_MINUTES = 10 * 60 * 1000;

  setInterval(async () => {
    log('info', 'Running periodic gap check');
    await detectAndBackfillGaps(true); // silent mode - only log if gaps found
  }, TEN_MINUTES);

  log('info', 'Periodic gap check scheduled (every 10 minutes)');
}

/**
 * Setup WebSocket connection with error handling
 */
async function setupWebSocketConnection() {
  if (isReconnecting) {
    log('warn', 'Reconnection already in progress, skipping');
    return null;
  }

  const wsUrl = process.env.ETH_WS_RPC_URL || 'wss://ethereum-rpc.publicnode.com';
  log('info', 'Connecting to WebSocket', { url: wsUrl });

  const newProvider = new ethers.WebSocketProvider(wsUrl);

  // WebSocket error handlers
  newProvider.websocket.on('error', (error) => {
    log('error', 'WebSocket error', { error: error.message });
  });

  newProvider.websocket.on('close', (code, reason) => {
    log('warn', 'WebSocket closed', { code, reason: reason?.toString() || 'unknown' });
    if (!isReconnecting) {
      log('info', 'Scheduling reconnection in 5 seconds');
      isReconnecting = true;
      setTimeout(async () => {
        isReconnecting = false;
        log('info', 'Attempting to reconnect');
        await main();
      }, 5000);
    }
  });

  newProvider.websocket.on('open', () => {
    log('info', 'WebSocket connection established');
  });

  return newProvider;
}

/**
 * Heartbeat monitor: detect if we haven't processed blocks in 5 minutes
 */
function startHeartbeatMonitor() {
  setInterval(() => {
    const timeSinceLastBlock = Date.now() - lastBlockTimestamp;
    const minutesSinceLastBlock = Math.floor(timeSinceLastBlock / 60000);

    if (minutesSinceLastBlock >= 5) {
      log('error', 'Heartbeat failure: No blocks processed', {
        minutesSinceLastBlock,
        lastBlockTimestamp: new Date(lastBlockTimestamp).toISOString()
      });
      log('warn', 'Forcing process restart due to heartbeat failure');
      process.exit(1); // Railway will restart us
    }
  }, 60000); // Check every minute
}

/**
 * Main entry point
 */
async function main() {
  log('info', 'Starting Ethereum block ingestion service');

  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    log('error', 'Database connection failed');
    process.exit(1);
  }
  log('info', 'Database connected');

  // Setup WebSocket provider with error handling
  provider = await setupWebSocketConnection();
  if (!provider) {
    log('error', 'Failed to setup WebSocket connection');
    return;
  }

  // Get latest block in database
  const lastDbBlock = await getLatestBlockNumber();
  if (lastDbBlock) {
    log('info', 'Latest block in database', { blockNumber: lastDbBlock });
  } else {
    log('info', 'No blocks in database yet');
  }

  // Get current chain block
  const currentBlock = await provider.getBlockNumber();
  log('info', 'Current chain block', { blockNumber: currentBlock });

  // Check for and backfill any gaps in the database
  await detectAndBackfillGaps();

  // Backfill recent blocks (limit to last 110 blocks)
  if (lastDbBlock) {
    const startBlock = Math.max(lastDbBlock + 1, currentBlock - 109);
    if (startBlock <= currentBlock) {
      await backfillMissingBlocks(startBlock, currentBlock);
    }
  } else {
    // Initial backfill - get last 110 blocks
    const startBlock = currentBlock - 109;
    await backfillMissingBlocks(startBlock, currentBlock);
  }

  // Initialize lastProcessedBlockNumber to current block after backfill
  lastProcessedBlockNumber = currentBlock;

  // Listen for new blocks
  provider.on('block', async (blockNumber) => {
    try {
      log('info', 'New block received', { blockNumber });

      // Check for immediate gap: if we skipped blocks, backfill them
      if (lastProcessedBlockNumber !== null && blockNumber > lastProcessedBlockNumber + 1) {
        const missedCount = blockNumber - lastProcessedBlockNumber - 1;
        log('warn', 'Detected skipped blocks', {
          expected: lastProcessedBlockNumber + 1,
          received: blockNumber,
          missedCount
        });
        // Backfill the missed blocks in the background
        backfillMissingBlocks(lastProcessedBlockNumber + 1, blockNumber - 1).catch(err => {
          log('error', 'Failed to backfill skipped blocks', { error: err.message });
        });
      }

      const block = await provider.getBlock(blockNumber);
      if (block) {
        await insertBlock(block);
        lastBlockTimestamp = Date.now(); // Update heartbeat
        lastProcessedBlockNumber = blockNumber; // Track for gap detection
      }
    } catch (err) {
      log('error', 'Error processing block', { blockNumber, error: err.message });
    }
  });

  // Start heartbeat monitor
  startHeartbeatMonitor();
  log('info', 'Heartbeat monitor started');

  // Start periodic gap detection (every 10 minutes)
  startPeriodicGapCheck();

  // Cleanup old blocks on startup and then every hour
  await cleanupOldBlocks('7 days');
  setInterval(() => cleanupOldBlocks('7 days'), 60 * 60 * 1000);

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    log('info', `Received ${signal}, shutting down gracefully`);
    if (provider) {
      provider.destroy();
    }
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log('info', 'Ingestion service running successfully');
}

main().catch((err) => {
  log('error', 'Fatal error in main', { error: err.message, stack: err.stack });
  process.exit(1);
});
