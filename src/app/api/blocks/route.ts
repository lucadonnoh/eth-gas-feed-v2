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

      const interval = intervalMap[timeRange];
      if (!interval) {
        return NextResponse.json(
          { error: 'Invalid timeRange. Use: 1h, 4h, 12h, or 24h' },
          { status: 400 }
        );
      }

      result = await pool.query<BlockRow>(
        `SELECT * FROM blocks
         WHERE created_at >= NOW() - INTERVAL '${interval}'
         ORDER BY block_number ASC`,
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
