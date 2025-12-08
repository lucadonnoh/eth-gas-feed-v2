"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  BarChart,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { RollingNumber } from "@/components/RollingNumber";
import { FlashValue } from "@/components/FlashValue";

/**
 * Point represents a single Ethereum block entry for the chart & ticker.
 */
type Point = {
  block: number;
  gasLimit: number;
  gasUsed: number;
  baseFee: number;
  blobCount: number;
  blobBaseFee: number;
  excessBlobGas: number;
  blockRange?: string; // Optional: "123-125" for bucketed data
  timestampRange?: string; // Optional: ISO timestamp range for bucketed data
  priorityFeeDistribution?: Array<{
    label: string;
    count: number;
    percentage: number;
  }> | null;
};


/**
 * GasLimitMonitor – main page component showing a live terminal‑style dashboard
 * with a streaming line‑chart and a scrolling ticker of the most recent blocks.
 */
export default function GasLimitMonitor() {
  const [data, setData] = useState<Point[]>([]);
  const [latest, setLatest] = useState<Point | null>(null);
  const [lastBlockTime, setLastBlockTime] = useState<number>(0);
  const [timeToNext, setTimeToNext] = useState<number>(12);
  const [isConnecting, setIsConnecting] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [lastErrorTime, setLastErrorTime] = useState<number>(0);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(true);
  const [priorityFeeData, setPriorityFeeData] = useState<Array<{
    label: string;
    count: number;
    percentage: number;
  }> | null>(null);
  const [timeRange, setTimeRange] = useState<'30m' | '4h' | '12h' | '24h'>('30m');
  const TARGET_GAS_LIMIT = 60_000_000;
  const START_GAS_LIMIT = 45_000_000;

  // Custom label formatter for tooltips that shows block range and timestamp range if available
  const tooltipLabelFormatter = (label: number | string, payload?: readonly unknown[]) => {
    const firstPayload = payload?.[0] as { payload?: Point } | undefined;
    if (firstPayload?.payload?.blockRange) {
      let result = `Blocks: ${firstPayload.payload.blockRange}`;

      // Add timestamp range if available
      if (firstPayload?.payload?.timestampRange) {
        const [start, end] = firstPayload.payload.timestampRange.split(',');
        const formatTime = (iso: string) => {
          const date = new Date(iso);
          return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
        };
        result += `\n${formatTime(start)} - ${formatTime(end)}`;
      }

      return result;
    }
    return `Block: ${label}`;
  };

  // Function to fill gaps in block sequence
  // Calculate gas limit change statistics
  const gasLimitStats = useMemo(() => {
    if (data.length < 2) {
      return { 
        increases: 0, 
        decreases: 0, 
        unchanged: 0, 
        totalComparisons: 0,
        increasePercentage: 0,
        decreasePercentage: 0,
        unchangedPercentage: 0
      };
    }

    let increases = 0;
    let decreases = 0;
    let unchanged = 0;

    for (let i = 1; i < data.length; i++) {
      const current = data[i].gasLimit;
      const previous = data[i - 1].gasLimit;

      if (current > previous) increases++;
      else if (current < previous) decreases++;
      else unchanged++;
    }

    const totalComparisons = data.length - 1;

    return {
      increases,
      decreases,
      unchanged,
      totalComparisons,
      increasePercentage: totalComparisons > 0 ? (increases / totalComparisons * 100) : 0,
      decreasePercentage: totalComparisons > 0 ? (decreases / totalComparisons * 100) : 0,
      unchangedPercentage: totalComparisons > 0 ? (unchanged / totalComparisons * 100) : 0
    };
  }, [data]);

  // Tab visibility detection and reconnection logic
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsTabVisible(isVisible);
      
      if (isVisible && lastBlockTime > 0) {
        // Tab became visible - check if we need to reconnect
        const timeSinceLastBlock = Date.now() - lastBlockTime;
        
        // If more than 30 seconds without a block, try to recover
        if (timeSinceLastBlock > 30000) {
          console.log("Tab returned, checking connection health...");
          
          if (hasError) {
            // Clear error and attempt reconnection
            setHasError(false);
            setIsConnecting(true);
            window.location.reload();
          } else if (timeSinceLastBlock > 60000) {
            // Been away too long, show reconnecting state
            setIsConnecting(true);
            // Give it 10 seconds to recover, then reload if needed
            setTimeout(() => {
              if (Date.now() - lastBlockTime > 70000) {
                window.location.reload();
              }
            }, 10000);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lastBlockTime, hasError]);

  // Memoize charts to prevent re-renders from timeToNext updates
  const gasLimitChartComponent = useMemo(() => {
    // Show all data for all time ranges
    const chartData = data;

    return (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">Gas Limit</h3>
        {data.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">📊</div>
              <div className="text-lg">Waiting for block data...</div>
              <div className="text-sm opacity-70 mt-2">Chart will appear once blocks are received</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis
                dataKey="block"
                stroke="#39ff14"
                tick={{ fontSize: 10 }}
                allowDecimals={false}
              />
              <YAxis
                stroke="#39ff14"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${(v / 1e6).toFixed(1)} M`}
                label={{ value: "Gas Limit", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                labelFormatter={tooltipLabelFormatter}
                formatter={(value: number) => value.toLocaleString()}
              />
              <ReferenceLine
                y={START_GAS_LIMIT}
                stroke="#ffa500"
                strokeDasharray="2 2"
                label={{ value: "45M Baseline", fill: "#ffa500", position: "bottom" }}
              />
              <ReferenceLine
                y={TARGET_GAS_LIMIT}
                stroke="#f00"
                strokeDasharray="4 4"
                label={{ value: "60M Target", fill: "#f00", position: "top" }}
              />
              <Line
                type="monotone"
                dataKey="gasLimit"
                stroke="#39ff14"
                dot={{ fill: "#39ff14", strokeWidth: 0, r: 2 }}
                isAnimationActive={true}
                animationDuration={0}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
    );
  }, [data, TARGET_GAS_LIMIT]);

  const baseFeeChartComponent = useMemo(() => {
    // Show all data for all time ranges
    const chartData = data;

    // Calculate ETH burned for each block
    const dataWithBurned = chartData.map(point => ({
      ...point,
      ethBurned: (point.gasUsed * point.baseFee) / 1e18 // Convert to ETH
    }));

    // Find max values for Y-axis domains
    const maxEthBurned = Math.max(...dataWithBurned.map(d => d.ethBurned), 0.1);

    return (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">Base Fee & ETH Burned</h3>
        {data.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">📊</div>
              <div className="text-lg">Waiting for block data...</div>
              <div className="text-sm opacity-70 mt-2">Chart will appear once blocks are received</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={dataWithBurned} margin={{ top: 20, right: 0, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis
                dataKey="block"
                stroke="#39ff14"
                tick={{ fontSize: 10 }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="left"
                stroke="#39ff14"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${(v / 1e9).toFixed(2)}`}
                width={40}
                label={{ value: "Base Fee (Gwei)", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#39ff14"
                domain={[0, maxEthBurned * 1.1]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toFixed(2)}
                width={50}
                label={{ value: "ETH Burned (Ξ)", angle: -90, position: "insideRight", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                labelFormatter={tooltipLabelFormatter}
                formatter={(value: number, name: string) => {
                  if (name === "Base Fee") return [`${(value / 1e9).toFixed(2)} Gwei`, "Base Fee"];
                  if (name === "ETH Burned") return [`${value.toFixed(4)} ETH`, "ETH Burned"];
                  return [value.toString(), name];
                }}
              />
              <Bar
                yAxisId="right"
                dataKey="ethBurned"
                fill="#ff6b6b"
                fillOpacity={0.3}
                stroke="none"
                name="ETH Burned"
                isAnimationActive={true}
                animationDuration={0}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="baseFee"
                stroke="#ffa500"
                strokeWidth={2}
                dot={{ fill: "#ffa500", strokeWidth: 0, r: 2 }}
                isAnimationActive={true}
                animationDuration={0}
                name="Base Fee"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
    );
  }, [data]);

  // Calculate rolling average for blob count
  // Only for 30m (unbucketed) data - rolling average doesn't make sense for aggregated buckets
  const dataWithRollingAverage = useMemo(() => {
    const isBucketed = timeRange !== '30m';

    const dataWithAvg = data.map((point, index) => {
      let avgBlobCount: number | undefined;

      if (!isBucketed) {
        // For unbucketed data (30m), calculate true 10-block rolling average
        const start = Math.max(0, index - 9);
        const window = data.slice(start, index + 1);
        avgBlobCount = window.reduce((sum, p) => sum + p.blobCount, 0) / window.length;
      }
      // For bucketed data, don't calculate rolling average (blobCount is already a SUM)

      return {
        ...point,
        avgBlobCount: avgBlobCount !== undefined ? Number(avgBlobCount.toFixed(2)) : undefined
      };
    });

    return dataWithAvg;
  }, [data, timeRange]);

  const blobCountChartComponent = useMemo(() => {
    // Calculate reference lines based on bucketing
    // For bucketed data, blob count is SUM of all blobs in the bucket
    const isBucketed = timeRange !== '30m';

    let targetLine = 6;   // Default: 6 blobs per block
    let maxLine = 9;      // Default: 9 blobs per block
    let yAxisMax = 10;    // Default Y-axis max

    if (isBucketed) {
      // Calculate average blocks per bucket based on time range
      const blocksPerBucket = timeRange === '4h' ? 10 :   // 2 min / 12 sec
                             timeRange === '12h' ? 50 :   // 10 min / 12 sec
                             timeRange === '24h' ? 75 :   // 15 min / 12 sec
                             10;

      targetLine = 6 * blocksPerBucket;
      maxLine = 9 * blocksPerBucket;
      yAxisMax = Math.ceil(maxLine * 1.2); // 20% padding
    }

    return (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">Blob Count</h3>
        {data.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">📊</div>
              <div className="text-lg">Waiting for block data...</div>
              <div className="text-sm opacity-70 mt-2">Chart will appear once blocks are received</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={dataWithRollingAverage} margin={{ top: 20, right: 0, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis
                dataKey="block"
                stroke="#39ff14"
                tick={{ fontSize: 10 }}
                allowDecimals={false}
              />
              <YAxis
                stroke="#39ff14"
                domain={[0, yAxisMax]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toString()}
                width={30}
                label={{ value: "Blob Count", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                labelFormatter={tooltipLabelFormatter}
                formatter={(value: number, name: string) => {
                  if (name === "Blob Count") return [value.toString(), "Blob Count"];
                  if (name === "10-Block Avg") return [value.toFixed(2), "10-Block Avg"];
                  return [value.toString(), name];
                }}
              />
              <ReferenceLine
                y={targetLine}
                stroke="#ffa500"
                strokeDasharray="4 4"
                label={{ value: `${targetLine} Target`, fill: "#ffa500", position: "top" }}
              />
              <ReferenceLine
                y={maxLine}
                stroke="#f00"
                strokeDasharray="2 2"
                label={{ value: `${maxLine} Max`, fill: "#f00", position: "top" }}
              />
              <Bar
                dataKey="blobCount"
                fill="#9f7aea"
                fillOpacity={0.3}
                stroke="none"
                name="Blob Count"
                isAnimationActive={true}
                animationDuration={0}
              />
              <Line
                type="monotone"
                dataKey="avgBlobCount"
                stroke="#e879f9"
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
                name="10-Block Avg"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
    );
  }, [dataWithRollingAverage, data.length, timeRange]);

  const priorityFeeChartComponent = useMemo(() => (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">
          Priority Fee Distribution {latest && <span className="text-sm font-normal opacity-70">(Block #{latest.block})</span>}
        </h3>
        {!priorityFeeData ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">📊</div>
              <div className="text-lg">Waiting for transaction data...</div>
              <div className="text-sm opacity-70 mt-2">Distribution will appear once transactions are analyzed</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={priorityFeeData} margin={{ top: 20, right: 0, left: 0, bottom: 30 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                stroke="#39ff14"
                tick={{ fontSize: 9 }}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis
                stroke="#39ff14"
                tick={{ fontSize: 10 }}
                label={{ value: "Transaction Count", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                formatter={(value: number, name: string) => {
                  if (name === "count") {
                    const item = priorityFeeData.find(d => d.count === value);
                    return [`${value} txs (${item?.percentage.toFixed(1)}%)`, "Transactions"];
                  }
                  return [value.toString(), name];
                }}
                labelFormatter={(label, payload) => {
                  const blockInfo = tooltipLabelFormatter(label, payload);
                  return `${blockInfo} (${label} Gwei)`;
                }}
              />
              <Bar
                dataKey="count"
                fill="#00ffff"
                fillOpacity={0.7}
                stroke="#00ffff"
                strokeWidth={1}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  ), [priorityFeeData, latest]);

  // EIP-7918 constants for blob cost breakdown
  const BLOB_BASE_COST = 8192; // 2^13 - minimum execution gas cost per blob
  const GAS_PER_BLOB = 131072; // blob gas per blob

  const blobBaseFeeChartComponent = useMemo(() => {
    // Show all data for all time ranges
    const sourceData = data;

    // Calculate blob cost breakdown per EIP-7918
    // Floor cost (execution): BLOB_BASE_COST * base_fee_per_gas
    // Congestion cost: additional cost when blob_base_fee * GAS_PER_BLOB > floor
    const chartData = sourceData.map(point => {
      // Floor blob base fee equivalent (in wei per blob gas)
      // This is what the blob base fee would need to be to match the execution floor cost
      const floorBlobBaseFee = (BLOB_BASE_COST * point.baseFee) / GAS_PER_BLOB;

      // The actual blob base fee from congestion
      const actualBlobBaseFee = point.blobBaseFee;

      // For stacked bar: show floor component and congestion component
      // If actual > floor, congestion = actual - floor, floor stays as is
      // If actual <= floor, congestion = 0, floor = actual (since floor dominates but we show actual)
      const floorComponent = Math.min(floorBlobBaseFee, actualBlobBaseFee);
      const congestionComponent = Math.max(0, actualBlobBaseFee - floorBlobBaseFee);

      return {
        ...point,
        floorBlobBaseFee,
        floorComponent,
        congestionComponent,
        totalBlobBaseFee: actualBlobBaseFee,
      };
    });

    const maxBlobBaseFee = chartData.length > 0 ? Math.max(...chartData.map(d => d.totalBlobBaseFee)) : 1;

    // Round to nice numbers to avoid floating point precision issues
    const getNiceNumber = (value: number) => {
      if (value <= 10) return Math.ceil(value);
      if (value <= 100) return Math.ceil(value / 10) * 10;
      if (value <= 1000) return Math.ceil(value / 100) * 100;
      if (value <= 10000) return Math.ceil(value / 1000) * 1000;
      if (value <= 100000) return Math.ceil(value / 10000) * 10000;
      if (value <= 1000000) return Math.ceil(value / 100000) * 100000;
      return Math.ceil(value / 1000000) * 1000000;
    };

    const yAxisMax = getNiceNumber(maxBlobBaseFee * 1.2); // 20% padding with nice rounding

    return (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">Blob Base Fee & Excess Blob Gas</h3>
        <div className="flex gap-4 text-xs mb-2 opacity-80">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-[#22c55e]" style={{ opacity: 0.5 }}></div>
            <span>Floor (EIP-7918)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-[#f59e0b]" style={{ opacity: 0.5 }}></div>
            <span>Congestion</span>
          </div>
        </div>
        {data.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">📊</div>
              <div className="text-lg">Waiting for block data...</div>
              <div className="text-sm opacity-70 mt-2">Chart will appear once blocks are received</div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 4, bottom: 5 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis
                dataKey="block"
                stroke="#39ff14"
                tick={{ fontSize: 10 }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="left"
                stroke="#39ff14"
                domain={[0, yAxisMax]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => {
                  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
                  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
                  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                  return v.toString();
                }}
                width={35}
                label={{ value: "Blob Base Fee (wei)", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                formatter={(value: number, name: string, props: { payload?: { floorBlobBaseFee?: number; totalBlobBaseFee?: number } }) => {
                  if (name === "Floor (Execution)") {
                    const floor = props.payload?.floorBlobBaseFee ?? 0;
                    return [`${value.toLocaleString()} wei (floor: ${floor.toLocaleString()})`, "Floor Component"];
                  }
                  if (name === "Congestion") {
                    return [`${value.toLocaleString()} wei`, "Congestion Component"];
                  }
                  return [value.toString(), name];
                }}
                labelFormatter={(label, payload) => {
                  if (payload && payload[0]?.payload) {
                    const p = payload[0].payload as { totalBlobBaseFee?: number; excessBlobGas?: number; blockRange?: string };
                    const blockInfo = p.blockRange ? `Blocks: ${p.blockRange}` : `Block #${label}`;
                    const excessGas = p.excessBlobGas ? `${(p.excessBlobGas / 1e6).toFixed(2)}M` : '0';
                    return `${blockInfo} | Total: ${p.totalBlobBaseFee?.toLocaleString()} wei | Excess Gas: ${excessGas}`;
                  }
                  return `Block #${label}`;
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="floorComponent"
                fill="#22c55e"
                fillOpacity={0.5}
                stroke="none"
                name="Floor (Execution)"
                stackId="blobFee"
                isAnimationActive={true}
                animationDuration={0}
              />
              <Bar
                yAxisId="left"
                dataKey="congestionComponent"
                fill="#f59e0b"
                fillOpacity={0.5}
                stroke="none"
                name="Congestion"
                stackId="blobFee"
                isAnimationActive={true}
                animationDuration={0}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
    );
  }, [data]);

  useEffect(() => {
    let isMounted = true;
    let latestBlockNumber: number | null = null;

    const fetchPriorityFees = async (blockNumber: number) => {
      try {
        const res = await fetch(`/api/priority-fees?block=${blockNumber}`);
        const data = await res.json();
        if (isMounted && data.priorityFeeDistribution) {
          setPriorityFeeData(data.priorityFeeDistribution);
        }
      } catch (err) {
        console.error("Error fetching priority fees:", err);
      }
    };

    const loadInitialBlocks = async () => {
      try {
        const url = `/api/blocks?timeRange=${timeRange}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch initial blocks');
        }

        const { blocks, latestBlock } = await response.json();

        if (isMounted) {
          setData(blocks);
          latestBlockNumber = latestBlock;

          if (blocks.length > 0) {
            const latestBlockData = blocks[blocks.length - 1];
            setLatest(latestBlockData);
            setLastBlockTime(Date.now());

            // Fetch priority fees for latest block
            fetchPriorityFees(latestBlockData.block);
          }

          setIsConnecting(false);
          setHasError(false);
        }
      } catch (err) {
        console.error("Error loading initial blocks:", err);
        if (isMounted) {
          setHasError(true);
          setIsConnecting(false);
        }
      }
    };

    const pollForNewBlocks = async () => {
      if (latestBlockNumber === null) return;

      try {
        const response = await fetch(`/api/blocks?after=${latestBlockNumber}&limit=50`);
        if (!response.ok) return;

        const { blocks: newBlocks, latestBlock } = await response.json();

        if (isMounted && newBlocks.length > 0) {
          setData(prev => {
            // Merge new blocks, avoiding duplicates
            const existingBlockNumbers = new Set(prev.map(b => b.block));
            const uniqueNewBlocks = newBlocks.filter((b: Point) => !existingBlockNumbers.has(b.block));

            if (uniqueNewBlocks.length === 0) return prev;

            // Combine old and new blocks
            const combined = [...prev, ...uniqueNewBlocks];

            // Keep a reasonable maximum to prevent unbounded growth
            // For 30m we expect ~150 blocks, so keep last 200 as a buffer
            const maxBlocks = 200;
            return combined.slice(-maxBlocks);
          });

          latestBlockNumber = latestBlock;

          const latestNewBlock = newBlocks[newBlocks.length - 1];
          setLatest(latestNewBlock);
          setLastBlockTime(Date.now());
          setHasError(false);

          // Fetch priority fees for the latest block
          fetchPriorityFees(latestNewBlock.block);
        }
      } catch (err) {
        console.error("Error polling for blocks:", err);
      }
    };

    // Initial load
    loadInitialBlocks();

    // Start polling for 30m mode (every 12 seconds to match block time)
    let pollInterval: NodeJS.Timeout | undefined;
    if (timeRange === '30m') {
      pollInterval = setInterval(pollForNewBlocks, 12000);
    }

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [timeRange]);

  useEffect(() => {
    // Initialize lastBlockTime on mount if not set
    if (lastBlockTime === 0) {
      setLastBlockTime(Date.now());
    }
    
    const id = setInterval(() => {
      setTimeToNext(Math.max(0, 12 - (Date.now() - lastBlockTime) / 1000));
      
      // Only check for stale data if tab is visible
      // When tab is hidden, browsers throttle connections
      if (isTabVisible && Date.now() - lastBlockTime > 60000 && !isConnecting && !hasError) {
        setHasError(true);
        setLastErrorTime(Date.now());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lastBlockTime, isConnecting, hasError, isTabVisible]);

  return (
    <main className="min-h-screen bg-black font-mono p-4 pt-16 flex flex-col gap-6 max-w-[1400px] mx-auto" style={{ color: "#39ff14" }}>
      {/* Sticky Header */}
      {latest && dataWithRollingAverage.length > 0 && (
        <div className="fixed top-0 left-0 right-0 bg-[#0d0d0d] border-b border-[#39ff14]/20 z-50 shadow-lg">
          <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-1.5 sm:py-2">
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 overflow-x-auto">
                <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                  <span className="opacity-70">Gas:</span>
                  <FlashValue value={latest.gasLimit} className="rounded px-1">
                    <span className="font-bold text-yellow-300">
                      <RollingNumber 
                        value={latest.gasLimit / 1e6} 
                        formatFn={(v) => `${v.toFixed(1)}M`}
                        duration={300}
                      />
                    </span>
                  </FlashValue>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                  <span className="opacity-70">Base:</span>
                  <FlashValue value={latest.baseFee} className="rounded px-1">
                    <span className="font-bold text-orange-400">
                      <RollingNumber 
                        value={latest.baseFee / 1e9} 
                        formatFn={(v) => `${v.toFixed(2)} Gwei`}
                        duration={300}
                      />
                    </span>
                  </FlashValue>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                  <span className="opacity-70">Blobs:</span>
                  <FlashValue value={dataWithRollingAverage[dataWithRollingAverage.length - 1]?.avgBlobCount || 0} className="rounded px-1">
                    <span className="font-bold text-purple-400">
                      <RollingNumber 
                        value={dataWithRollingAverage[dataWithRollingAverage.length - 1]?.avgBlobCount || 0} 
                        formatFn={(v) => v.toFixed(2)}
                        duration={300}
                      />
                    </span>
                  </FlashValue>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-xs">
                <span className="text-yellow-300 whitespace-nowrap">#{latest.block}</span>
                <span className="opacity-70 whitespace-nowrap tabular-nums w-[20px] inline-block text-right">{timeToNext.toFixed(0)}s</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex justify-between items-center gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold">⛓ Ethereum Gas Limit Live Feed</h1>
        {latest && (
          <div className="text-right text-xs sm:text-sm">
            <div className="opacity-70 text-[10px] sm:text-xs">Last Update</div>
            <div className={`font-mono ${
              lastBlockTime === 0 ? 'text-green-400' :
              Date.now() - lastBlockTime > 30000 ? 'text-yellow-400' :
              Date.now() - lastBlockTime > 60000 ? 'text-red-400' :
              'text-green-400'
            }`}>
              {lastBlockTime === 0 ? '--:--:--' : new Date(lastBlockTime).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm opacity-70">Time Range:</span>
        {(['30m', '4h', '12h', '24h'] as const).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              timeRange === range
                ? 'bg-[#39ff14] text-black'
                : 'bg-[#1a1a1a] text-[#39ff14] hover:bg-[#2a2a2a] border border-[#39ff14]/30'
            }`}
          >
            {range.toUpperCase()}
          </button>
        ))}
      </div>

      {isConnecting && (
        <div className="flex items-center gap-2 text-lg">
          <div className="animate-spin text-2xl inline-block">●</div>
          <span>Connecting to Ethereum network...</span>
        </div>
      )}

      {hasError && (
        <div className="bg-red-900/20 border border-red-500/50 rounded p-4 text-center">
          <div className="text-red-400 text-xl mb-2">⚠️ Connection Issue</div>
          <div className="text-sm mb-3">
            Unable to receive new blocks from the Ethereum network. This could be due to network issues or server problems.
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            Refresh Page
          </button>
          <div className="text-xs opacity-70 mt-2">
            Last error: {new Date(lastErrorTime).toLocaleTimeString()}
          </div>
        </div>
      )}

      {latest && (
        <div className="w-full">
          <div className="flex justify-between text-sm mb-1">
            <span>Progress from 45M to 60M gas limit</span>
            <span>
              {(
                ((latest.gasLimit - START_GAS_LIMIT) /
                  (TARGET_GAS_LIMIT - START_GAS_LIMIT)) *
                100
              ).toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-3 bg-[#111]">
            <div
              className="h-full"
              style={{
                backgroundColor: "#39ff14",
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    ((latest.gasLimit - START_GAS_LIMIT) /
                      (TARGET_GAS_LIMIT - START_GAS_LIMIT)) * 100
                  )
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Gas Limit Change Statistics */}
      <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
        <CardContent>
          {gasLimitStats.totalComparisons > 0 ? (
            <>
              <div className="flex justify-between items-baseline mb-3">
              <h3 className="text-lg font-semibold">Gas Limit Changes</h3>
              <div className="text-sm opacity-60">(Last {gasLimitStats.totalComparisons} blocks)</div>
            </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-green-400">
                    {gasLimitStats.increasePercentage.toFixed(1)}%
                  </div>
                  <div className="text-sm opacity-80">
                    ↗ Increases ({gasLimitStats.increases})
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-red-400">
                    {gasLimitStats.decreasePercentage.toFixed(1)}%
                  </div>
                  <div className="text-sm opacity-80">
                    ↘ Decreases ({gasLimitStats.decreases})
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="text-2xl font-bold">
                    {gasLimitStats.unchangedPercentage.toFixed(1)}%
                  </div>
                  <div className="text-sm opacity-80">
                    → Unchanged ({gasLimitStats.unchanged})
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="animate-pulse text-4xl mb-3">📊</div>
              <h3 className="text-lg font-semibold mb-2">Gas Limit Statistics</h3>
              <div className="text-sm opacity-70">
                {data.length === 0
                  ? "Waiting for first block..."
                  : "Waiting for second block to calculate changes..."
                }
              </div>
              <div className="text-xs opacity-50 mt-1">
                Need at least 2 blocks to show statistics
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {gasLimitChartComponent}
        {baseFeeChartComponent}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {blobCountChartComponent}
        {blobBaseFeeChartComponent}
      </div>

      {/* Priority Fee Distribution Chart */}
      {priorityFeeChartComponent}

      {/* Scrolling ticker */}
      <Card className="bg-[#0d0d0d] max-h-64 overflow-y-auto" style={{ color: "#39ff14" }}>
        <CardContent className="space-y-2">
          {data.length === 0 ? (
            <div className="text-center py-8">
              <div className="animate-bounce text-4xl mb-2">⏳</div>
              <div>Block history will appear here...</div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {data
                .slice(-100)
                .slice()
                .reverse()
                .map((entry, index) => {
                  const previousEntry = data.slice(-100).slice().reverse()[index + 1];
                  const isIncrease = previousEntry && entry.gasLimit > previousEntry.gasLimit;
                  const isDecrease = previousEntry && entry.gasLimit < previousEntry.gasLimit;
                  const isFirst = !previousEntry;
                  const isLatest = index === 0; // Only highlight the very latest entry

                  return (
                    <motion.div
                      key={entry.block}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      transition={{ duration: 0.05 }} // 50ms slide
                      className={`flex justify-between items-center px-2 py-1 rounded ${
                        isIncrease ? 'bg-green-900/20' :
                        isDecrease ? 'bg-red-900/20' : 
                        ''
                      } ${
                        isLatest ? 'ring-1 ring-[#39ff14]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isIncrease && <span className="text-green-400">↗</span>}
                        {isDecrease && <span className="text-red-400">↘</span>}
                        {isFirst && <span className="text-blue-400">●</span>}
                        <a 
                          href={`https://etherscan.io/block/${entry.block}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline text-sm"
                        >
                          Block #{entry.block}
                        </a>
                      </div>
                      <div className="flex flex-col items-end text-xs leading-tight gap-0.5">
                        <div className="flex flex-row gap-3 items-end">
                          <span className={
                            isIncrease ? 'text-green-400' :
                              isDecrease ? 'text-red-400' : ''
                          }>
                            Gas: {(entry.gasLimit / 1e6).toFixed(1)}M
                          </span>
                          <span className="text-orange-400">
                            Base: {(entry.baseFee / 1e9).toFixed(1)}
                          </span>
                        </div>
                        <div className="flex flex-row gap-3 items-end">
                          <span className="text-purple-400">
                            Blobs: {entry.blobCount}
                          </span>
                          <span className="text-cyan-400">
                            Fee: {entry.blobBaseFee.toLocaleString()}w
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          )}
        </CardContent>
      </Card>

      {/* Latest block number */}
      {latest && (
        <div className="text-lg text-center">
          Latest Block&nbsp;
          <span className="text-yellow-300">#{latest.block}</span>
        </div>
      )}
      {latest && (
        <div className="text-sm text-yellow-300 text-center">
          Next block in {timeToNext.toFixed(0)}s
        </div>
      )}
    </main>
  );
}
