import { Pool } from 'pg';

// Create a connection pool with resilience settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Handle pool errors to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

export { pool };

// Database row type (matches SQL schema)
export interface BlockRow {
  block_number: string; // BIGINT comes as string
  gas_limit: string;
  gas_used: string;
  base_fee: string; // NUMERIC comes as string
  blob_count: number;
  blob_base_fee: string;
  excess_blob_gas: string;
  created_at: Date;
  min_block?: string; // Optional: minimum block in bucket
  max_block?: string; // Optional: maximum block in bucket
  min_timestamp?: Date; // Optional: minimum timestamp in bucket
  max_timestamp?: Date; // Optional: maximum timestamp in bucket
}

// Application block type (matches frontend Point type)
export interface Block {
  block: number;
  gasLimit: number;
  gasUsed: number;
  baseFee: number;
  blobCount: number;
  blobBaseFee: number;
  excessBlobGas: number;
  timestamp?: string; // Optional: ISO timestamp for individual blocks
  blockRange?: string; // Optional: "123-125" for bucketed data
  timestampRange?: string; // Optional: ISO timestamp range for bucketed data
}

// Convert database row to application block
export function rowToBlock(row: BlockRow): Block {
  const blockRange = row.min_block && row.max_block
    ? `${row.min_block}-${row.max_block}`
    : undefined;

  const timestampRange = row.min_timestamp && row.max_timestamp
    ? `${row.min_timestamp.toISOString()},${row.max_timestamp.toISOString()}`
    : undefined;

  // Include timestamp for individual blocks (non-bucketed data)
  const timestamp = row.created_at && !blockRange
    ? row.created_at.toISOString()
    : undefined;

  return {
    block: Number(row.block_number),
    gasLimit: Number(row.gas_limit),
    gasUsed: Number(row.gas_used),
    baseFee: Number(row.base_fee),
    blobCount: Number(row.blob_count),
    blobBaseFee: Number(row.blob_base_fee),
    excessBlobGas: Number(row.excess_blob_gas),
    ...(timestamp && { timestamp }),
    ...(blockRange && { blockRange }),
    ...(timestampRange && { timestampRange }),
  };
}
