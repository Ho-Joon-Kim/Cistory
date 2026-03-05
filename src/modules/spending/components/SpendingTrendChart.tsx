"use client";

import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CumulativeDataPoint } from "../types";

interface SpendingTrendChartProps {
  data: CumulativeDataPoint[];
  todayDayNumber: number;
  predictedTotal: number;
}

function formatManwon(value: number): string {
  if (value >= 10000) {
    return `${Math.round(value / 10000)}만`;
  }
  if (value >= 1000) {
    return `${(value / 10000).toFixed(1)}만`;
  }
  return String(value);
}

export function SpendingTrendChart({ data, todayDayNumber, predictedTotal }: SpendingTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spendingBandGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="day"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          interval={4}
          tickFormatter={(d) => `${d}일`}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickFormatter={formatManwon}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          labelFormatter={(label) => `${label}일`}
          formatter={(value: number, name: string) => {
            const formatted = `${value.toLocaleString("ko-KR")}원`;
            const labels: Record<string, string> = {
              actual: "실제 누적",
              mid: "예측",
              upper: "상한",
              lower: "하한",
            };
            return [formatted, labels[name] || name];
          }}
        />

        {/* Confidence band */}
        <Area
          type="monotone"
          dataKey="upper"
          stroke="none"
          fill="url(#spendingBandGradient)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="lower"
          stroke="none"
          fill="hsl(var(--background))"
          connectNulls={false}
        />

        {/* Actual cumulative line */}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />

        {/* Predicted midline */}
        <Line
          type="monotone"
          dataKey="mid"
          stroke="#ef4444"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          connectNulls={false}
        />

        {/* Today marker */}
        <ReferenceLine
          x={todayDayNumber}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />

        {/* Predicted total label */}
        {predictedTotal > 0 && (
          <ReferenceLine
            y={predictedTotal}
            stroke="none"
            label={{
              value: `예측: ~${formatManwon(predictedTotal)}원`,
              position: "insideTopRight",
              fill: "hsl(var(--muted-foreground))",
              fontSize: 12,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
