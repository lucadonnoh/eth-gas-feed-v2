import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

// RPC request timeout (10 seconds)
const RPC_TIMEOUT_MS = 10000;

// Cache for priority fee data (block data is immutable, so cache can be long-lived)
const priorityFeeCache = new Map<number, {
  data: Array<{ label: string; count: number; percentage: number }> | null;
  timestamp: number;
}>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Keep last 100 blocks

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const blockNumberParam = searchParams.get('block');

    if (!blockNumberParam) {
      return NextResponse.json(
        { error: 'Block number required' },
        { status: 400 }
      );
    }

    const blockNumber = parseInt(blockNumberParam, 10);
    if (isNaN(blockNumber) || blockNumber < 0) {
      return NextResponse.json(
        { error: 'Invalid block number. Must be a positive integer.' },
        { status: 400 }
      );
    }

    // Check cache first
    const cached = priorityFeeCache.get(blockNumber);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      const response = NextResponse.json({ priorityFeeDistribution: cached.data });
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    // Use server-side env variable (not exposed to client)
    const httpsUrl = process.env.HTTPS_ETH_RPC_URL ?? "https://rpc.ankr.com/eth";
    const httpProvider = new ethers.JsonRpcProvider(httpsUrl);

    // Fetch block with transactions (with timeout)
    const blockPromise = httpProvider.getBlock(blockNumber, true);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('RPC request timeout')), RPC_TIMEOUT_MS)
    );

    const block = await Promise.race([blockPromise, timeoutPromise]);
    
    if (!block || !block.prefetchedTransactions) {
      return NextResponse.json(
        { error: 'Block not found or no transactions' }, 
        { status: 404 }
      );
    }
    
    const baseFee = Number(block.baseFeePerGas || 0);
    const priorityFees = block.prefetchedTransactions
      .filter(tx => tx.maxPriorityFeePerGas != null && tx.maxFeePerGas != null)
      .map(tx => {
        // Calculate actual priority fee: min(maxPriorityFee, maxFee - baseFee)
        const maxPriorityFee = Number(tx.maxPriorityFeePerGas);
        const maxFee = Number(tx.maxFeePerGas);
        const actualPriorityFee = Math.min(maxPriorityFee, Math.max(0, maxFee - baseFee));
        return actualPriorityFee / 1e9; // Convert to Gwei
      });
    
    if (priorityFees.length === 0) {
      return NextResponse.json({ priorityFeeDistribution: null });
    }
    
    // Create dynamic buckets based on actual min/max
    const minFee = Math.min(...priorityFees);
    const maxFee = Math.max(...priorityFees);
    const range = maxFee - minFee;
    
    // Create 100 equal-width buckets
    const bucketCount = 100;
    const bucketWidth = range / bucketCount;
    const buckets: Array<{ min: number; max: number; count: number; label: string }> = [];
    
    for (let i = 0; i < bucketCount; i++) {
      const bucketMin = minFee + (i * bucketWidth);
      const bucketMax = i === bucketCount - 1 ? maxFee + 0.001 : minFee + ((i + 1) * bucketWidth);
      
      // Format label based on values
      let label: string;
      if (bucketWidth < 0.1) {
        label = `${bucketMin.toFixed(3)}-${bucketMax.toFixed(3)}`;
      } else if (bucketWidth < 1) {
        label = `${bucketMin.toFixed(2)}-${bucketMax.toFixed(2)}`;
      } else if (bucketWidth < 10) {
        label = `${bucketMin.toFixed(1)}-${bucketMax.toFixed(1)}`;
      } else {
        label = `${Math.round(bucketMin)}-${Math.round(bucketMax)}`;
      }
      
      buckets.push({
        min: bucketMin,
        max: bucketMax,
        count: 0,
        label
      });
    }
    
    // Count transactions in each bucket
    priorityFees.forEach(fee => {
      const bucket = buckets.find(b => fee >= b.min && fee < b.max);
      if (bucket) bucket.count++;
    });
    
    const priorityFeeDistribution = buckets.map(b => ({
      label: b.label,
      count: b.count,
      percentage: (b.count / priorityFees.length) * 100
    }));

    // Cache the result
    priorityFeeCache.set(blockNumber, {
      data: priorityFeeDistribution,
      timestamp: Date.now()
    });

    // Clean up old cache entries if cache is too large
    if (priorityFeeCache.size > MAX_CACHE_SIZE) {
      const sortedEntries = [...priorityFeeCache.entries()].sort((a, b) => a[0] - b[0]);
      const entriesToDelete = sortedEntries.slice(0, priorityFeeCache.size - MAX_CACHE_SIZE);
      entriesToDelete.forEach(([key]) => priorityFeeCache.delete(key));
    }

    const response = NextResponse.json({ priorityFeeDistribution });
    response.headers.set('X-Cache', 'MISS');
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching priority fees:', errorMessage);

    // Return more specific error messages
    if (errorMessage.includes('timeout')) {
      return NextResponse.json(
        { error: 'RPC request timed out. Please try again.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch priority fees' },
      { status: 500 }
    );
  }
}