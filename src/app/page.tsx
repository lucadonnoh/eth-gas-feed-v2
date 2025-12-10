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
import { getBlobLimits, isBPO1ActiveAtTimestamp, BPO1_UPGRADE_TIMESTAMP } from "@/lib/eth";

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
  timestamp?: string; // Optional: ISO timestamp for individual blocks
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
  const [isLoadingRange, setIsLoadingRange] = useState<boolean>(false);
  const TARGET_GAS_LIMIT = 60_000_000;
  const START_GAS_LIMIT = 45_000_000;

  // Custom label formatter for tooltips that shows timestamp range first, then block range (smaller)
  const tooltipLabelFormatter = (label: number | string, payload?: readonly unknown[]) => {
    const firstPayload = payload?.[0] as { payload?: Point } | undefined;

    // For bucketed data with timestamp range
    if (firstPayload?.payload?.blockRange) {
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
        return (
          <>
            {formatTime(start)} - {formatTime(end)}
            <br />
            ({firstPayload.payload.blockRange})
          </>
        );
      } else {
        return `Blocks: ${firstPayload.payload.blockRange}`;
      }
    }

    // For individual blocks with timestamp (30m range)
    if (firstPayload?.payload?.timestamp) {
      const formatTime = (iso: string) => {
        const date = new Date(iso);
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
      };
      return (
        <>
          {formatTime(firstPayload.payload.timestamp)}
          <br />
          (Block #{label})
        </>
      );
    }

    return `Block: ${label}`;
  };

  // BPO1 upgrade countdown
  const [bpo1Countdown, setBpo1Countdown] = useState<string>("");

  useEffect(() => {
    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const secondsUntilBPO1 = BPO1_UPGRADE_TIMESTAMP - now;

      if (secondsUntilBPO1 <= 0) {
        setBpo1Countdown("BPO1 is live! 🎉");
        return;
      }

      const days = Math.floor(secondsUntilBPO1 / 86400);
      const hours = Math.floor((secondsUntilBPO1 % 86400) / 3600);
      const minutes = Math.floor((secondsUntilBPO1 % 3600) / 60);
      const seconds = secondsUntilBPO1 % 60;

      setBpo1Countdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

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
                formatter={(value: number, name: string, props: { payload?: Point }) => {
                  const isBucketed = !!props.payload?.blockRange;
                  const suffix = isBucketed ? ' (avg)' : '';
                  return [value.toLocaleString() + suffix, name];
                }}
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
                formatter={(value: number, name: string, props: { payload?: Point }) => {
                  const isBucketed = !!props.payload?.blockRange;
                  if (name === "Base Fee") {
                    const suffix = isBucketed ? ' (avg)' : '';
                    return [`${(value / 1e9).toFixed(2)} Gwei${suffix}`, "Base Fee"];
                  }
                  if (name === "ETH Burned") {
                    const suffix = isBucketed ? ' (total)' : '';
                    return [`${value.toFixed(4)} ETH${suffix}`, "ETH Burned"];
                  }
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

    // Get current blob limits (will be 6/9 before Pectra, 10/15 after)
    const currentLimits = getBlobLimits(Date.now() / 1000, false);
    const { target, max } = currentLimits;

    let targetLine = target;   // Dynamic: 6 or 10 blobs per block
    let maxLine = max;         // Dynamic: 9 or 15 blobs per block
    let yAxisMax = max + 1;    // Dynamic Y-axis max

    if (isBucketed) {
      // Calculate average blocks per bucket based on time range
      const blocksPerBucket = timeRange === '4h' ? 10 :   // 2 min / 12 sec
                             timeRange === '12h' ? 50 :   // 10 min / 12 sec
                             timeRange === '24h' ? 75 :   // 15 min / 12 sec
                             10;

      targetLine = target * blocksPerBucket;
      maxLine = max * blocksPerBucket;
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
                formatter={(value: number, name: string, props: { payload?: Point }) => {
                  const isBucketed = !!props.payload?.blockRange;
                  if (name === "Blob Count") {
                    const suffix = isBucketed ? ' (total)' : '';
                    return [value.toString() + suffix, "Blob Count"];
                  }
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
      const floorBlobBaseFeeWei = (BLOB_BASE_COST * point.baseFee) / GAS_PER_BLOB;

      // The actual blob base fee from congestion (in wei)
      const actualBlobBaseFeeWei = point.blobBaseFee;

      // For stacked bar: show floor component and congestion component
      // If actual > floor, congestion = actual - floor, floor stays as is
      // If actual <= floor, congestion = 0, floor = actual (since floor dominates but we show actual)
      const floorComponentWei = Math.min(floorBlobBaseFeeWei, actualBlobBaseFeeWei);
      const congestionComponentWei = Math.max(0, actualBlobBaseFeeWei - floorBlobBaseFeeWei);

      // Convert to Gwei for display
      return {
        ...point,
        floorBlobBaseFee: floorBlobBaseFeeWei / 1e9,
        floorComponent: floorComponentWei / 1e9,
        congestionComponent: congestionComponentWei / 1e9,
        totalBlobBaseFee: actualBlobBaseFeeWei / 1e9,
      };
    });

    const maxBlobBaseFee = chartData.length > 0 ? Math.max(...chartData.map(d => d.totalBlobBaseFee)) : 1;

    // Round to nice numbers for Gwei values (typically 0.001 - 1000 Gwei)
    const getNiceNumber = (value: number) => {
      if (value <= 0.01) return Math.ceil(value * 1000) / 1000;  // Round to 3 decimal places (0.001 steps)
      if (value <= 0.1) return Math.ceil(value * 100) / 100;     // Round to 2 decimal places (0.01 steps)
      if (value <= 1) return Math.ceil(value * 20) / 20;         // Round to 0.05 steps (cleaner than 0.1)
      if (value <= 10) return Math.ceil(value * 2) / 2;          // Round to 0.5 steps
      if (value <= 100) return Math.ceil(value / 5) * 5;         // Round to nearest 5
      if (value <= 1000) return Math.ceil(value / 50) * 50;      // Round to nearest 50
      return Math.ceil(value / 500) * 500;                        // Round to nearest 500
    };

    const yAxisMax = getNiceNumber(maxBlobBaseFee * 1.2); // 20% padding with nice rounding

    return (
    <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
      <CardContent>
        <h3 className="text-lg font-semibold mb-4">Blob Base Fee</h3>
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
                  // Values are already in Gwei
                  if (v === 0) return '0';
                  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
                  if (v >= 1) return v.toFixed(1);
                  if (v >= 0.001) return v.toFixed(3);
                  return v.toFixed(6);
                }}
                width={35}
                label={{ value: "Blob Base Fee (Gwei)", angle: -90, position: "insideLeft", fill: "#39ff14", style: { fontSize: 10, opacity: 0.5 } }}
              />
              <Tooltip
                contentStyle={{ background: "#000", borderColor: "#39ff14" }}
                labelStyle={{ color: "#39ff14" }}
                formatter={(value: number, name: string, props: { payload?: { floorBlobBaseFee?: number; totalBlobBaseFee?: number; blockRange?: string } }) => {
                  const isBucketed = !!props.payload?.blockRange;
                  const avgSuffix = isBucketed ? ' avg' : '';

                  // Value is already in Gwei, format with appropriate precision
                  const formattedValue = value >= 1 ? value.toFixed(3) : value.toFixed(6);

                  if (name === "Floor (Execution)") {
                    return [`${formattedValue} Gwei${avgSuffix}`, "Floor"];
                  }
                  if (name === "Congestion") {
                    return [`${formattedValue} Gwei${avgSuffix}`, "Congestion"];
                  }
                  return [value.toString(), name];
                }}
                labelFormatter={(label, payload) => {
                  if (payload && payload[0]?.payload) {
                    const p = payload[0].payload as { totalBlobBaseFee?: number; excessBlobGas?: number; blockRange?: string; timestampRange?: string; timestamp?: string };

                    // Show timestamp range first (more important), then block range (for bucketed data)
                    if (p.timestampRange && p.blockRange) {
                      const [start, end] = p.timestampRange.split(',');
                      const formatTime = (iso: string) => {
                        const date = new Date(iso);
                        return date.toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        });
                      };
                      return (
                        <>
                          {formatTime(start)} - {formatTime(end)}
                          <br />
                          ({p.blockRange})
                        </>
                      );
                    }

                    // Fallback for bucketed data without timestamp
                    if (p.blockRange) {
                      return `Blocks: ${p.blockRange}`;
                    }

                    // For individual blocks with timestamp (30m range)
                    if (p.timestamp) {
                      const formatTime = (iso: string) => {
                        const date = new Date(iso);
                        return date.toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        });
                      };
                      return (
                        <>
                          {formatTime(p.timestamp)}
                          <br />
                          (Block #{label})
                        </>
                      );
                    }
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
        setIsLoadingRange(true);
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

            // Only update lastBlockTime if this is a new block
            setLatest(prevLatest => {
              const isNewBlock = !prevLatest || latestBlockData.block > prevLatest.block;
              if (isNewBlock) {
                setLastBlockTime(Date.now());
              }
              return latestBlockData;
            });

            // Fetch priority fees for latest block
            fetchPriorityFees(latestBlockData.block);
          }

          setIsConnecting(false);
          setHasError(false);
          setIsLoadingRange(false);
        }
      } catch (err) {
        console.error("Error loading initial blocks:", err);
        if (isMounted) {
          setHasError(true);
          setIsConnecting(false);
          setIsLoadingRange(false);
        }
      }
    };

    const pollForNewBlocks = async () => {
      if (latestBlockNumber === null) return;

      try {
        // Re-fetch the entire 30m window to maintain rolling time-based window
        const response = await fetch(`/api/blocks?timeRange=30m`);
        if (!response.ok) return;

        const { blocks: newBlocks, latestBlock } = await response.json();

        if (isMounted && newBlocks.length > 0) {
          // Check if there are actually new blocks
          const hasNewBlocks = latestBlock > latestBlockNumber;

          if (hasNewBlocks) {
            setData(newBlocks);
            latestBlockNumber = latestBlock;

            const latestNewBlock = newBlocks[newBlocks.length - 1];
            setLatest(latestNewBlock);
            setLastBlockTime(Date.now());
            setHasError(false);

            // Fetch priority fees for the latest block
            fetchPriorityFees(latestNewBlock.block);
          }
        }
      } catch (err) {
        console.error("Error polling for blocks:", err);
      }
    };

    // Initial load
    loadInitialBlocks();

    // Polling function for non-30m ranges to keep countdown accurate
    const pollLatestBlockOnly = async () => {
      if (!isMounted) return;

      try {
        const response = await fetch(`/api/blocks?limit=1`);
        if (!response.ok) return;

        const { blocks, latestBlock } = await response.json();

        if (isMounted && blocks.length > 0) {
          const latestBlockData = blocks[0];

          // Only update lastBlockTime if this is a new block
          setLatest(prevLatest => {
            const isNewBlock = !prevLatest || latestBlockData.block > prevLatest.block;
            if (isNewBlock) {
              setLastBlockTime(Date.now());
              setHasError(false);
            }
            return latestBlockData;
          });
        }
      } catch (err) {
        console.error("Error polling for latest block:", err);
      }
    };

    // Start polling: 30m mode updates chart data, others just update countdown
    let pollInterval: NodeJS.Timeout | undefined;
    if (timeRange === '30m') {
      pollInterval = setInterval(pollForNewBlocks, 12000);
    } else {
      // For other ranges, poll for latest block to keep countdown accurate
      pollInterval = setInterval(pollLatestBlockOnly, 12000);
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
        <div className="flex items-center gap-2 text-lg" suppressHydrationWarning>
          <div className="animate-spin text-2xl inline-block">●</div>
          <span suppressHydrationWarning>Connecting to Ethereum network...</span>
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

      {/* BPO1 Upgrade Countdown */}
      <Card className="bg-[#0d0d0d] w-full" style={{ color: "#39ff14" }}>
        <CardContent>
          <div className="text-center py-2">
            <div className="text-2xl mb-1">🚀</div>
            <h3 className="text-base font-semibold mb-1">BPO1 Upgrade Countdown</h3>
            <div className="text-2xl font-bold text-yellow-300 mb-1 tabular-nums">
              {bpo1Countdown || "Loading..."}
            </div>
            <div className="text-xs opacity-70 mb-1">
              Blob target: 6 → 10 | Max: 9 → 15
            </div>
            <div className="text-xs opacity-50">
              Slot 13205504 • {new Date(BPO1_UPGRADE_TIMESTAMP * 1000).toLocaleString()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="relative">
        {isLoadingRange && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 rounded">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin text-6xl">⏳</div>
              <div className="text-lg text-[#39ff14]">Loading {timeRange} data...</div>
            </div>
          </div>
        )}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 transition-opacity duration-200 ${isLoadingRange ? 'opacity-30' : 'opacity-100'}`}>
          {gasLimitChartComponent}
          {baseFeeChartComponent}
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6 transition-opacity duration-200 ${isLoadingRange ? 'opacity-30' : 'opacity-100'}`}>
          {blobCountChartComponent}
          {blobBaseFeeChartComponent}
        </div>
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
