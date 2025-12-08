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

  await pool.query(query, values);
}

async function backfill() {
  console.log('🚀 Starting 24h backfill...');

  // Setup provider
  const rpcUrl = process.env.HTTPS_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  console.log(`🔌 Connecting to ${rpcUrl}`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    console.log(`⛓️  Current block: ${currentBlock}`);

    // Calculate how many blocks for 24h (assuming 12 second block time)
    // 24 hours = 24 * 60 * 60 / 12 = 7200 blocks
    const blocksIn24h = 7200;
    const startBlock = currentBlock - blocksIn24h + 1;

    console.log(`📦 Backfilling ${blocksIn24h} blocks (${startBlock} to ${currentBlock})`);
    console.log('⏱️  This may take 10-15 minutes depending on RPC rate limits...\n');

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
            console.error(`  ⚠️  Failed to fetch block ${num}: ${err.message}`);
            return null;
          }
        })
      );

      // Insert batch
      for (const block of blocks) {
        if (block) {
          try {
            await insertBlock(block);
            inserted++;
          } catch (err) {
            console.error(`  ⚠️  Failed to insert block ${block.number}: ${err.message}`);
          }
        }
      }

      processed += blockNumbers.length;
      const progress = ((processed / blocksIn24h) * 100).toFixed(1);
      console.log(`  Progress: ${progress}% (${processed}/${blocksIn24h} blocks, ${inserted} inserted)`);

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✅ Backfill complete! Inserted ${inserted} blocks.`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    await pool.end();
    process.exit(1);
  }
}

backfill();
