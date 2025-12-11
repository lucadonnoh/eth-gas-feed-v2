/**
 * Shared database utilities for all services
 * Provides connection pooling, structured logging, and block operations
 */

const { Pool } = require('pg');
const { calculateBlobBaseFee } = require('./blob-fee');
const { BLOB_GAS_PER_BLOB } = require('./constants');

// Load .env.local for local development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

// Structured logging with timestamps
function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`);
}

// Create database pool with retry logic
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Connection pool settings for resilience and performance
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Handle pool errors
    pool.on('error', (err) => {
      log('error', 'Unexpected database pool error', { error: err.message });
    });
  }
  return pool;
}

/**
 * Execute a database query with automatic retry on transient failures
 * @param {string} query - SQL query string
 * @param {Array} values - Query parameters
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<Object>} Query result
 */
async function queryWithRetry(query, values = [], maxRetries = 3) {
  const p = getPool();
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await p.query(query, values);
    } catch (err) {
      lastError = err;
      const isTransient = err.code === 'ECONNRESET' ||
                          err.code === 'ETIMEDOUT' ||
                          err.code === '57P01' || // admin_shutdown
                          err.code === '08006' || // connection_failure
                          err.code === '08001' || // sqlclient_unable_to_establish_sqlconnection
                          err.message?.includes('Connection terminated');

      if (isTransient && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        log('warn', `Database query failed, retrying`, {
          attempt,
          maxRetries,
          delayMs: delay,
          error: err.message
        });
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
  try {
    await queryWithRetry('SELECT 1');
    return true;
  } catch (err) {
    log('error', 'Database connection test failed', { error: err.message });
    return false;
  }
}

/**
 * Insert a block into the database
 * @param {Object} block - Block object from ethers provider
 * @param {Object} options - Options
 * @param {boolean} options.silent - Don't log success (default: false)
 * @returns {Promise<boolean>} True if inserted, false if already exists
 */
async function insertBlock(block, options = {}) {
  const { silent = false } = options;

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
    RETURNING block_number
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

  const result = await queryWithRetry(query, values);
  const inserted = result.rowCount > 0;

  if (!silent && inserted) {
    log('info', 'Block inserted', { blockNumber: block.number });
  }

  return inserted;
}

/**
 * Get the latest block number in the database
 * @returns {Promise<number|null>} Latest block number or null if no blocks
 */
async function getLatestBlockNumber() {
  const result = await queryWithRetry(
    'SELECT block_number FROM blocks ORDER BY block_number DESC LIMIT 1'
  );
  return result.rows.length > 0 ? Number(result.rows[0].block_number) : null;
}

/**
 * Delete blocks older than a specified interval
 * @param {string} interval - PostgreSQL interval string (e.g., '24 hours')
 * @returns {Promise<number>} Number of deleted blocks
 */
async function cleanupOldBlocks(interval = '24 hours') {
  log('info', 'Starting cleanup of old blocks');
  const result = await queryWithRetry(
    `DELETE FROM blocks WHERE created_at < NOW() - INTERVAL '${interval}'`
  );
  const deletedCount = result.rowCount || 0;
  log('info', 'Cleanup completed', { deletedBlocks: deletedCount });
  return deletedCount;
}

/**
 * Find gaps in block sequence
 * @returns {Promise<Array>} Array of gap objects with after_block, before_block, missing_count
 */
async function findGaps() {
  const result = await queryWithRetry(`
    WITH block_sequence AS (
      SELECT
        block_number,
        block_number - LAG(block_number) OVER (ORDER BY block_number) as gap_size
      FROM blocks
      ORDER BY block_number
    )
    SELECT
      block_number - gap_size as after_block,
      block_number as before_block,
      gap_size - 1 as missing_count
    FROM block_sequence
    WHERE gap_size > 1
    ORDER BY block_number
  `);
  return result.rows;
}

/**
 * Close the database pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  log,
  getPool,
  queryWithRetry,
  testConnection,
  insertBlock,
  getLatestBlockNumber,
  cleanupOldBlocks,
  findGaps,
  closePool,
};
