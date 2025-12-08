import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Use server-side env variable (not exposed to client)
    const wsUrl = process.env.ETH_RPC_URL ?? "wss://rpc.ankr.com/eth/ws";
    
    return NextResponse.json({ wsUrl });
  } catch (error) {
    console.error('Error getting WebSocket URL:', error);
    return NextResponse.json(
      { error: 'Failed to get WebSocket URL' }, 
      { status: 500 }
    );
  }
}