import { NextResponse } from 'next/server';
import { pool, rowToBlock, BlockRow } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Optional: cursor-based pagination
    const afterBlock = searchParams.get('after');
    const limit = Math.min(parseInt(searchParams.get('limit') || '110'), 200);

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
    } else {
      // Fetch most recent blocks
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
