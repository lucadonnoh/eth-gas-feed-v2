import { Pool } from 'pg';

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  blockRange?: string; // Optional: "123-125" for bucketed data
}

// Convert database row to application block
export function rowToBlock(row: BlockRow): Block {
  const blockRange = row.min_block && row.max_block
    ? `${row.min_block}-${row.max_block}`
    : undefined;

  return {
    block: Number(row.block_number),
    gasLimit: Number(row.gas_limit),
    gasUsed: Number(row.gas_used),
    baseFee: Number(row.base_fee),
    blobCount: row.blob_count,
    blobBaseFee: Number(row.blob_base_fee),
    excessBlobGas: Number(row.excess_blob_gas),
    ...(blockRange && { blockRange }),
  };
}
