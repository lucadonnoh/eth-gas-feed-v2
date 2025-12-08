import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const blockNumber = searchParams.get('block');
    
    if (!blockNumber) {
      return NextResponse.json(
        { error: 'Block number required' }, 
        { status: 400 }
      );
    }
    
    // Use server-side env variable (not exposed to client)
    const httpsUrl = process.env.HTTPS_ETH_RPC_URL ?? "https://rpc.ankr.com/eth";
    const httpProvider = new ethers.JsonRpcProvider(httpsUrl);
    
    // Fetch block with transactions
    const block = await httpProvider.getBlock(parseInt(blockNumber), true);
    
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
    
    return NextResponse.json({ priorityFeeDistribution });
  } catch (error) {
    console.error('Error fetching priority fees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch priority fees' }, 
      { status: 500 }
    );
  }
}