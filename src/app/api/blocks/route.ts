import { NextResponse } from 'next/server';
import { pool, rowToBlock, BlockRow } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Optional: cursor-based pagination
    const afterBlock = searchParams.get('after');
    const limit = Math.min(parseInt(searchParams.get('limit') || '110'), 200);

    // Optional: time-based filtering
    const timeRange = searchParams.get('timeRange'); // '1h', '4h', '12h', '24h', or null for 'recent'

    let result;

    if (afterBlock) {
      // Fetch blocks newer than the cursor
      result = await pool.query<BlockRow>(
        `SELECT * FROM blocks
         WHERE block_number > $1
         ORDER BY block_number ASC
         LIMIT $2`,
        [parseInt(afterBlock), limit]
      );
    } else if (timeRange) {
      // Fetch blocks from the specified time range
      const intervalMap: Record<string, string> = {
        '1h': '1 hour',
        '4h': '4 hours',
        '12h': '12 hours',
        '24h': '24 hours',
      };

      // Time bucket sizes (in seconds) - only for 4h, 12h, 24h
      // 1h shows all blocks without bucketing (~300 blocks)
      const bucketSecondsMap: Record<string, number | null> = {
        '1h': null,      // No bucketing - show all blocks (~300 blocks)
        '4h': 120,       // 2 minutes = 120 seconds (~120 points)
        '12h': 600,      // 10 minutes = 600 seconds (~72 points)
        '24h': 900,      // 15 minutes = 900 seconds (~96 points)
      };

      const interval = intervalMap[timeRange];
      const bucketSeconds = bucketSecondsMap[timeRange];

      if (!interval) {
        return NextResponse.json(
          { error: 'Invalid timeRange. Use: 1h, 4h, 12h, or 24h' },
          { status: 400 }
        );
      }

      // For 1h: fetch all blocks without bucketing
      if (bucketSeconds === null) {
        result = await pool.query<BlockRow>(
          `SELECT * FROM blocks
           WHERE block_timestamp IS NOT NULL
           AND block_timestamp >= NOW() - INTERVAL '${interval}'
           ORDER BY block_number ASC`,
          []
        );
      } else {
        // For 4h, 12h, 24h: aggregate blocks into time buckets
        // Aggregation strategy:
        // - gas_limit: AVG (average limit)
        // - gas_used: SUM (total for ETH burned calculation)
        // - base_fee: AVG (average fee level)
        // - blob_count: SUM (total blobs in bucket)
        // - blob_base_fee: AVG (average blob fee)
        // - excess_blob_gas: AVG (average excess)
        result = await pool.query<BlockRow>(
          `SELECT
            MAX(block_number) as block_number,
            MIN(block_number) as min_block,
            MAX(block_number) as max_block,
            ROUND(AVG(gas_limit)) as gas_limit,
            SUM(gas_used) as gas_used,
            ROUND(AVG(base_fee)) as base_fee,
            SUM(blob_count) as blob_count,
            ROUND(AVG(blob_base_fee)) as blob_base_fee,
            ROUND(AVG(excess_blob_gas)) as excess_blob_gas,
            MAX(block_timestamp) as created_at
           FROM blocks
           WHERE block_timestamp IS NOT NULL
           AND block_timestamp >= NOW() - INTERVAL '${interval}'
           GROUP BY floor(extract(epoch from block_timestamp) / ${bucketSeconds})
           ORDER BY MAX(block_number) ASC`,
          []
        );
      }
    } else {
      // Fetch most recent blocks (default: last 110)
      result = await pool.query<BlockRow>(
        `SELECT * FROM blocks
         ORDER BY block_number DESC
         LIMIT $1`,
        [limit]
      );
      // Reverse to chronological order
      result.rows.reverse();
    }

    const blocks = result.rows.map(rowToBlock);

    // Include metadata for polling
    const latestResult = await pool.query<{ block_number: string }>(
      'SELECT block_number FROM blocks ORDER BY block_number DESC LIMIT 1'
    );

    return NextResponse.json({
      blocks,
      latestBlock: latestResult.rows[0]?.block_number
        ? Number(latestResult.rows[0].block_number)
        : null,
      hasMore: blocks.length === limit,
    });
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocks', details: String(error) },
      { status: 500 }
    );
  }
}
