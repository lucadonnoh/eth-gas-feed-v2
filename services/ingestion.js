// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
const { ethers } = require('ethers');
const { Pool } = require('pg');

// Structured logging with timestamps
function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// EIP-7691 parameters for blob basefee calculation
// Note: Parameter 5007716 is used for ALL blocks (both pre and post BPO1)
const MIN_BASE_FEE_PER_BLOB_GAS = 1;
const BLOB_BASE_FEE_UPDATE_FRACTION = 5007716;
const BLOB_GAS_PER_BLOB = 131072;

// BPO1 upgrade parameters
const BPO1_UPGRADE_TIMESTAMP = 1765290071;
const OLD_TARGET_BLOBS = 6;
const NEW_TARGET_BLOBS = 10;

// Fake exponential approximation from EIP-4844
function fakeExponential(factor, numerator, denominator) {
  let i = 1;
  let output = 0;
  let numeratorAccum = factor * denominator;

  while (numeratorAccum > 0) {
    output += numeratorAccum;
    numeratorAccum = Math.floor((numeratorAccum * numerator) / (denominator * i));
    i += 1;
  }

  return Math.floor(output / denominator);
}

// Calculate blob basefee
// Always uses parameter 5007716
// Pre-BPO1: Use raw excess blob gas
// Post-BPO1: Scale excess by old_target/new_target (6/10 = 0.6) due to target change
function calculateBlobBaseFee(excessBlobGas, blockTimestamp) {
  let effectiveExcess = excessBlobGas;

  // After BPO1, scale excess by old target / new target (6/10 = 0.6)
  const isBPO1Active = blockTimestamp && blockTimestamp >= BPO1_UPGRADE_TIMESTAMP;
  if (isBPO1Active) {
    effectiveExcess = Math.floor(excessBlobGas * OLD_TARGET_BLOBS / NEW_TARGET_BLOBS);
  }

  return fakeExponential(
    MIN_BASE_FEE_PER_BLOB_GAS,
    effectiveExcess,
    BLOB_BASE_FEE_UPDATE_FRACTION
  );
}

async function insertBlock(block) {
  const excessBlobGas = Number(block.excessBlobGas ?? 0);
  const blobCount = block.blobGasUsed
    ? Math.ceil(Number(block.blobGasUsed) / BLOB_GAS_PER_BLOB)
    : 0;

  // Convert block timestamp for blob base fee calculation
  const blockTimestampUnix = block.timestamp ? Number(block.timestamp) : null;
  const blobBaseFee = calculateBlobBaseFee(excessBlobGas, blockTimestampUnix);

  // Convert block timestamp to JS Date for database
  const blockTimestamp = blockTimestampUnix ? new Date(blockTimestampUnix * 1000) : null;

  const query = `
    INSERT INTO blocks (
      block_number, gas_limit, gas_used, base_fee,
      blob_count, blob_base_fee, excess_blob_gas, block_timestamp
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (block_number) DO NOTHING
  `;

  const values = [
    block.number,
    Number(block.gasLimit),
    Number(block.gasUsed),
    Number(block.baseFeePerGas || 0),
    blobCount,
    blobBaseFee,
    excessBlobGas,
    blockTimestamp,
  ];

  try {
    await pool.query(query, values);
    log('info', 'Block inserted', { blockNumber: block.number });
  } catch (err) {
    log('error', 'Failed to insert block', { blockNumber: block.number, error: err.message });
  }
}

async function cleanupOldBlocks() {
  try {
    log('info', 'Starting cleanup of old blocks');
    const result = await pool.query(`
      DELETE FROM blocks
      WHERE created_at < NOW() - INTERVAL '24 hours'
    `);
    if (result.rowCount > 0) {
      log('info', 'Cleanup completed', { deletedBlocks: result.rowCount });
    } else {
      log('info', 'Cleanup completed', { deletedBlocks: 0 });
    }
  } catch (err) {
    log('error', 'Cleanup failed', { error: err.message });
  }
}

async function backfillMissingBlocks(provider, fromBlock, toBlock) {
  const totalBlocks = toBlock - fromBlock + 1;
  log('info', 'Starting backfill', { fromBlock, toBlock, totalBlocks });

  const blockNumbers = [];
  for (let i = fromBlock; i <= toBlock; i++) {
    blockNumbers.push(i);
  }

  // Batch fetch blocks in chunks to avoid overwhelming RPC
  const chunkSize = 50;
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
        await insertBlock(block);
      }
    }
  }

  log('info', 'Backfill completed', { totalBlocks });
}

// Track last successful block insert for heartbeat monitoring
let lastBlockTimestamp = Date.now();
let isReconnecting = false;

async function setupWebSocketConnection() {
  if (isReconnecting) {
    log('warn', 'Reconnection already in progress, skipping');
    return null;
  }

  const wsUrl = process.env.ETH_WS_RPC_URL || 'wss://ethereum-rpc.publicnode.com';
  log('info', 'Connecting to WebSocket', { url: wsUrl });

  const provider = new ethers.WebSocketProvider(wsUrl);

  // WebSocket error handlers
  provider.websocket.on('error', (error) => {
    log('error', 'WebSocket error', { error: error.message });
  });

  provider.websocket.on('close', (code, reason) => {
    log('warn', 'WebSocket closed', { code, reason: reason.toString() });
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

  provider.websocket.on('open', () => {
    log('info', 'WebSocket connection established');
  });

  return provider;
}

// Heartbeat monitor: detect if we haven't processed blocks in 5 minutes
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
    } else {
      log('debug', 'Heartbeat check passed', { minutesSinceLastBlock });
    }
  }, 60000); // Check every minute
}

async function main() {
  log('info', 'Starting Ethereum block ingestion service');

  // Initialize database
  try {
    await pool.query('SELECT 1');
    log('info', 'Database connected');
  } catch (err) {
    log('error', 'Database connection failed', { error: err.message });
    process.exit(1);
  }

  // Setup WebSocket provider with error handling
  const provider = await setupWebSocketConnection();
  if (!provider) {
    log('error', 'Failed to setup WebSocket connection');
    return;
  }

  // Get latest block in database
  let lastDbBlock = null;
  try {
    const result = await pool.query('SELECT block_number FROM blocks ORDER BY block_number DESC LIMIT 1');
    if (result.rows.length > 0) {
      lastDbBlock = Number(result.rows[0].block_number);
      log('info', 'Latest block in database', { blockNumber: lastDbBlock });
    }
  } catch (err) {
    log('info', 'No blocks in database yet');
  }

  // Get current chain block
  const currentBlock = await provider.getBlockNumber();
  log('info', 'Current chain block', { blockNumber: currentBlock });

  // Backfill if needed (limit to last 110 blocks)
  if (lastDbBlock) {
    const startBlock = Math.max(lastDbBlock + 1, currentBlock - 109);
    if (startBlock <= currentBlock) {
      await backfillMissingBlocks(provider, startBlock, currentBlock);
    }
  } else {
    // Initial backfill - get last 110 blocks
    const startBlock = currentBlock - 109;
    await backfillMissingBlocks(provider, startBlock, currentBlock);
  }

  // Listen for new blocks
  provider.on('block', async (blockNumber) => {
    try {
      log('info', 'New block received', { blockNumber });
      const block = await provider.getBlock(blockNumber);
      if (block) {
        await insertBlock(block);
        lastBlockTimestamp = Date.now(); // Update heartbeat
      }
    } catch (err) {
      log('error', 'Error processing block', { blockNumber, error: err.message });
    }
  });

  // Start heartbeat monitor
  startHeartbeatMonitor();
  log('info', 'Heartbeat monitor started');

  // Cleanup old blocks on startup and then every hour
  await cleanupOldBlocks();
  setInterval(cleanupOldBlocks, 60 * 60 * 1000);

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    log('info', 'Received SIGTERM, shutting down gracefully');
    provider.destroy();
    await pool.end();
    process.exit(0);
  });

  log('info', 'Ingestion service running successfully');
}

main().catch((err) => {
  log('error', 'Fatal error in main', { error: err.message, stack: err.stack });
  process.exit(1);
});
