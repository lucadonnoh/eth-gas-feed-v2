import { NextResponse } from 'next/server';
import { pool, rowToBlock, BlockRow } from '@/lib/db';

const VALID_TIME_RANGES = ['30m', '4h', '12h', '24h', '7d'] as const;
type TimeRange = typeof VALID_TIME_RANGES[number];

function isValidTimeRange(value: string): value is TimeRange {
  return VALID_TIME_RANGES.includes(value as TimeRange);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Optional: cursor-based pagination with validation
    const afterBlockParam = searchParams.get('after');
    const afterBlock = afterBlockParam ? parseInt(afterBlockParam, 10) : null;
    if (afterBlockParam && (isNaN(afterBlock!) || afterBlock! < 0)) {
      return NextResponse.json(
        { error: 'Invalid "after" parameter. Must be a positive integer.' },
        { status: 400 }
      );
    }

    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 110;
    if (limitParam && (isNaN(parsedLimit) || parsedLimit < 1)) {
      return NextResponse.json(
        { error: 'Invalid "limit" parameter. Must be a positive integer.' },
        { status: 400 }
      );
    }
    const limit = Math.min(parsedLimit, 200);

    // Optional: time-based filtering
    const timeRange = searchParams.get('timeRange');

    let result;

    if (afterBlock !== null) {
      // Fetch blocks newer than the cursor
      result = await pool.query<BlockRow>(
        `SELECT * FROM blocks
         WHERE block_number > $1
         ORDER BY block_number ASC
         LIMIT $2`,
        [afterBlock, limit]
      );
    } else if (timeRange) {
      // Fetch blocks from the specified time range
      const intervalMap: Record<string, string> = {
        '30m': '30 minutes',
        '4h': '4 hours',
        '12h': '12 hours',
        '24h': '24 hours',
        '7d': '7 days',
      };

      // Time bucket sizes (in seconds) - only for 4h, 12h, 24h, 7d
      // 30m shows all blocks without bucketing (~150 blocks)
      const bucketSecondsMap: Record<string, number | null> = {
        '30m': null,     // No bucketing - show all blocks (~150 blocks)
        '4h': 120,       // 2 minutes = 120 seconds (~120 points)
        '12h': 600,      // 10 minutes = 600 seconds (~72 points)
        '24h': 900,      // 15 minutes = 900 seconds (~96 points)
        '7d': 3600,      // 1 hour = 3600 seconds (~168 points)
      };

      if (!isValidTimeRange(timeRange)) {
        return NextResponse.json(
          { error: 'Invalid timeRange. Use: 30m, 4h, 12h, 24h, or 7d' },
          { status: 400 }
        );
      }

      const interval = intervalMap[timeRange];
      const bucketSeconds = bucketSecondsMap[timeRange];

      // For 30m: fetch all blocks without bucketing
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
        // IMPORTANT: Calculate congestion per-block BEFORE averaging
        // This preserves congestion information that would be lost if we averaged
        // blob_base_fee and base_fee separately (avg blob_base_fee could fall below avg floor)
        //
        // Aggregation strategy:
        // - gas_limit: AVG (average limit)
        // - gas_used: SUM (total for ETH burned calculation)
        // - base_fee: AVG (average fee level) - for display/reference
        // - blob_count: SUM (total blobs in bucket)
        // - blob_base_fee: AVG of per-block congestion + AVG of base costs
        // - excess_blob_gas: AVG (average excess)
        result = await pool.query<BlockRow>(
          `WITH block_components AS (
            SELECT
              floor(extract(epoch from block_timestamp) / ${bucketSeconds}) as time_bucket,
              block_number,
              block_timestamp,
              gas_limit,
              gas_used,
              base_fee,
              blob_count,
              blob_base_fee,
              excess_blob_gas,
              -- Calculate per-block floor: (8192 * base_fee) / 131072
              GREATEST(0, (8192.0 * base_fee / 131072.0)) as floor_blob_base_fee,
              -- Calculate per-block congestion: max(0, blob_base_fee - floor)
              GREATEST(0, blob_base_fee - (8192.0 * base_fee / 131072.0)) as congestion
            FROM blocks
            WHERE block_timestamp IS NOT NULL
            AND block_timestamp >= NOW() - INTERVAL '${interval}'
          )
          SELECT
            MAX(block_number) as block_number,
            MIN(block_number) as min_block,
            MAX(block_number) as max_block,
            to_timestamp(MIN(time_bucket) * ${bucketSeconds}) as min_timestamp,
            to_timestamp((MIN(time_bucket) + 1) * ${bucketSeconds}) as max_timestamp,
            ROUND(AVG(gas_limit)) as gas_limit,
            SUM(gas_used) as gas_used,
            ROUND(AVG(base_fee)) as base_fee,
            SUM(blob_count) as blob_count,
            -- Reconstruct blob_base_fee as: avg(floor) + avg(congestion)
            -- This preserves congestion information across aggregation
            AVG(floor_blob_base_fee) + AVG(congestion) as blob_base_fee,
            AVG(excess_blob_gas) as excess_blob_gas,
            MAX(block_timestamp) as created_at
          FROM block_components
          GROUP BY time_bucket
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

    // Get latest block from result set (avoid extra query)
    // For DESC queries, first row is latest; for ASC queries, last row is latest
    const latestBlock = blocks.length > 0
      ? Math.max(...blocks.map(b => b.block))
      : null;

    const response = NextResponse.json({
      blocks,
      latestBlock,
      hasMore: blocks.length === limit,
    });

    // Add caching headers for performance (5s cache, 10s stale-while-revalidate)
    response.headers.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');

    return response;
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocks', details: String(error) },
      { status: 500 }
    );
  }
}
