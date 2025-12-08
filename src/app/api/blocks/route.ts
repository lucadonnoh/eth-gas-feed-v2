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
      // Fetch blocks from the specified time range with time-based bucketing
      const intervalMap: Record<string, string> = {
        '1h': '1 hour',
        '4h': '4 hours',
        '12h': '12 hours',
        '24h': '24 hours',
      };

      // Time bucket sizes to keep ~50-60 points per chart
      const bucketMap: Record<string, string> = {
        '1h': '1 minute',   // ~60 points
        '4h': '5 minutes',  // ~48 points
        '12h': '15 minutes', // ~48 points
        '24h': '30 minutes', // ~48 points
      };

      const interval = intervalMap[timeRange];
      const bucket = bucketMap[timeRange];

      if (!interval || !bucket) {
        return NextResponse.json(
          { error: 'Invalid timeRange. Use: 1h, 4h, 12h, or 24h' },
          { status: 400 }
        );
      }

      // Aggregate blocks into time buckets
      // Only query blocks that have timestamps (backfilled data)
      result = await pool.query<BlockRow>(
        `SELECT
          MAX(block_number) as block_number,
          ROUND(AVG(gas_limit)) as gas_limit,
          ROUND(AVG(gas_used)) as gas_used,
          ROUND(AVG(base_fee)) as base_fee,
          ROUND(AVG(blob_count)) as blob_count,
          ROUND(AVG(blob_base_fee)) as blob_base_fee,
          ROUND(AVG(excess_blob_gas)) as excess_blob_gas,
          MAX(block_timestamp) as created_at
         FROM blocks
         WHERE block_timestamp IS NOT NULL
         AND block_timestamp >= NOW() - INTERVAL '${interval}'
         GROUP BY date_trunc('${bucket}', block_timestamp)
         ORDER BY MAX(block_number) ASC`,
        []
      );
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
