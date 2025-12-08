// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
const { ethers } = require('ethers');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// EIP-7691 Prague parameters for blob basefee calculation
const MIN_BASE_FEE_PER_BLOB_GAS = 1;
const BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE = 5007716;
const BLOB_GAS_PER_BLOB = 131072;

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

// Calculate blob basefee using EIP-7691 parameters
function calculateBlobBaseFee(excessBlobGas) {
  return fakeExponential(
    MIN_BASE_FEE_PER_BLOB_GAS,
    excessBlobGas,
    BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE
  );
}

async function insertBlock(block) {
  const excessBlobGas = Number(block.excessBlobGas ?? 0);
  const blobCount = block.blobGasUsed
    ? Math.ceil(Number(block.blobGasUsed) / BLOB_GAS_PER_BLOB)
    : 0;
  const blobBaseFee = calculateBlobBaseFee(excessBlobGas);

  // Convert block timestamp to JS Date
  const blockTimestamp = block.timestamp ? new Date(Number(block.timestamp) * 1000) : null;

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
    console.log(`✓ Block ${block.number} inserted`);
  } catch (err) {
    console.error(`Error inserting block ${block.number}:`, err.message);
  }
}

async function cleanupOldBlocks() {
  try {
    const result = await pool.query(`
      DELETE FROM blocks
      WHERE created_at < NOW() - INTERVAL '24 hours'
    `);
    if (result.rowCount > 0) {
      console.log(`🧹 Cleaned up ${result.rowCount} old blocks`);
    }
  } catch (err) {
    console.error('Error cleaning up old blocks:', err.message);
  }
}

async function backfillMissingBlocks(provider, fromBlock, toBlock) {
  console.log(`📦 Backfilling blocks ${fromBlock} to ${toBlock}`);

  const blockNumbers = [];
  for (let i = fromBlock; i <= toBlock; i++) {
    blockNumbers.push(i);
  }

  // Batch fetch blocks
  const blocks = await Promise.all(
    blockNumbers.map(num => provider.getBlock(num).catch(() => null))
  );

  for (const block of blocks) {
    if (block) {
      await insertBlock(block);
    }
  }
}

async function main() {
  console.log('🚀 Starting Ethereum block ingestion service...');

  // Initialize database
  try {
    await pool.query('SELECT 1');
    console.log('✓ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Setup WebSocket provider
  const wsUrl = process.env.ETH_WS_RPC_URL || 'wss://ethereum-rpc.publicnode.com';
  console.log(`🔌 Connecting to ${wsUrl}`);

  const provider = new ethers.WebSocketProvider(wsUrl);

  // Get latest block in database
  let lastDbBlock = null;
  try {
    const result = await pool.query('SELECT block_number FROM blocks ORDER BY block_number DESC LIMIT 1');
    if (result.rows.length > 0) {
      lastDbBlock = Number(result.rows[0].block_number);
      console.log(`📊 Latest block in DB: ${lastDbBlock}`);
    }
  } catch (err) {
    console.log('📊 No blocks in database yet');
  }

  // Get current chain block
  const currentBlock = await provider.getBlockNumber();
  console.log(`⛓️  Current chain block: ${currentBlock}`);

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
      console.log(`📦 New block: ${blockNumber}`);
      const block = await provider.getBlock(blockNumber);
      if (block) {
        await insertBlock(block);
      }
    } catch (err) {
      console.error(`Error processing block ${blockNumber}:`, err.message);
    }
  });

  // Cleanup old blocks on startup and then every hour
  await cleanupOldBlocks();
  setInterval(cleanupOldBlocks, 60 * 60 * 1000);

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    provider.destroy();
    await pool.end();
    process.exit(0);
  });

  console.log('✅ Ingestion service running');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
