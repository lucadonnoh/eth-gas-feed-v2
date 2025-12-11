import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

// Cache for gap detection (expensive query)
let gapCache: {
  data: { count: number; totalMissingBlocks: number; details: unknown[] } | null;
  timestamp: number;
} = { data: null, timestamp: 0 };
const GAP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    // Get database stats (lightweight query)
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_blocks,
        MIN(block_number) as oldest_block,
        MAX(block_number) as latest_block,
        MAX(created_at) as last_insert_time,
        EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) as seconds_since_last_insert
      FROM blocks
    `);

    const stats = statsResult.rows[0];

    // Check for gaps in recent blocks (cached - expensive query)
    const now = Date.now();
    let gaps: { count: number; totalMissingBlocks: number; details: unknown[] };

    if (gapCache.data && (now - gapCache.timestamp) < GAP_CACHE_TTL_MS) {
      // Use cached gap data
      gaps = gapCache.data;
    } else {
      // Fetch fresh gap data
      const gapsResult = await pool.query(`
        WITH block_sequence AS (
          SELECT
            block_number,
            block_number - LAG(block_number) OVER (ORDER BY block_number) as gap_size
          FROM blocks
          ORDER BY block_number DESC
          LIMIT 1000
        )
        SELECT
          COUNT(*) FILTER (WHERE gap_size > 1) as gap_count,
          SUM(gap_size - 1) FILTER (WHERE gap_size > 1) as total_missing_blocks,
          jsonb_agg(
            jsonb_build_object(
              'after_block', block_number - gap_size,
              'before_block', block_number,
              'missing_count', gap_size - 1
            ) ORDER BY block_number DESC
          ) FILTER (WHERE gap_size > 1) as gaps
        FROM block_sequence
        WHERE gap_size IS NOT NULL
      `);

      const gapData = gapsResult.rows[0];
      gaps = {
        count: Number(gapData.gap_count || 0),
        totalMissingBlocks: Number(gapData.total_missing_blocks || 0),
        details: gapData.gaps || [],
      };

      // Update cache
      gapCache = { data: gaps, timestamp: now };
    }

    interface GapDetail {
      after_block: number;
      before_block: number;
      missing_count: number;
    }

    const health: {
      status: 'ok' | 'warning' | 'error';
      database: {
        totalBlocks: number;
        oldestBlock: number;
        latestBlock: number;
        lastInsertTime: string;
        secondsSinceLastInsert: number;
      };
      gaps: {
        count: number;
        totalMissingBlocks: number;
        details: GapDetail[];
      };
      warnings: string[];
    } = {
      status: 'ok',
      database: {
        totalBlocks: Number(stats.total_blocks),
        oldestBlock: Number(stats.oldest_block),
        latestBlock: Number(stats.latest_block),
        lastInsertTime: stats.last_insert_time,
        secondsSinceLastInsert: Math.floor(Number(stats.seconds_since_last_insert)),
      },
      gaps: {
        count: gaps.count,
        totalMissingBlocks: gaps.totalMissingBlocks,
        details: gaps.details as GapDetail[],
      },
      warnings: [],
    };

    // Add warnings
    if (health.database.secondsSinceLastInsert > 300) {
      health.status = 'warning';
      health.warnings.push(`No blocks inserted in ${health.database.secondsSinceLastInsert} seconds`);
    }

    if (health.gaps.count > 0) {
      health.status = 'warning';
      health.warnings.push(`Found ${health.gaps.count} gap(s) with ${health.gaps.totalMissingBlocks} missing blocks`);
    }

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to fetch health status',
        details: String(error),
      },
      { status: 500 }
    );
  }
}
