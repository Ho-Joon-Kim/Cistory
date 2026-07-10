"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  SPENDING_CATEGORY_COLORS,
  SPENDING_CATEGORY_LABELS,
  type SpendingCategoryKey,
} from "../categories";
import type { CumulativeDataPoint } from "../types";

interface SpendingTrendChartProps {
  data: CumulativeDataPoint[];
  todayDayNumber: number;
  predictedTotal: number;
}

function formatManwon(value: number): string {
  if (value >= 10000) return `${Math.round(value / 10000)}만`;
  if (value >= 1000) return `${(value / 10000).toFixed(1)}만`;
  return String(value);
}

export function SpendingTrendChart({
  data,
  todayDayNumber,
  predictedTotal,
}: SpendingTrendChartProps) {
  const activeCategories = useMemo(() => {
    const latest = [...data].reverse().find((item) => item.actual !== null);
    return Object.entries(latest?.categories ?? {})
      .filter(([, total]) => (total ?? 0) > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([category]) => category as SpendingCategoryKey);
  }, [data]);

  return (
    <div className="w-full">
      <div className="h-[240px] md:h-[310px]">
        <ResponsiveContainer width="100%" height="100%">
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
              tickFormatter={(day) => `${day}일`}
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
              formatter={(value, name) => {
                if (value == null || typeof value !== "number") return ["", ""];
                const labels: Record<string, string> = {
                  actual: "전체 누적",
                  mid: "월말 예측",
                  upper: "예측 상한",
                  lower: "예측 하한",
                };
                return [`${value.toLocaleString("ko-KR")}원`, labels[String(name)] ?? String(name)];
              }}
            />
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill="url(#spendingBandGradient)"
              connectNulls={false}
              name="upper"
            />
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="hsl(var(--background))"
              connectNulls={false}
              name="lower"
            />
            {activeCategories.map((category) => (
              <Line
                key={category}
                type="monotone"
                dataKey={(item: CumulativeDataPoint) =>
                  item.actual === null ? null : (item.categories[category] ?? 0)
                }
                name={SPENDING_CATEGORY_LABELS[category]}
                stroke={SPENDING_CATEGORY_COLORS[category]}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                dot={false}
                connectNulls={false}
              />
            ))}
            <Line
              type="monotone"
              dataKey="actual"
              name="actual"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="mid"
              name="mid"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
            />
            <ReferenceLine
              x={todayDayNumber}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            {predictedTotal > 0 && (
              <ReferenceLine
                y={predictedTotal}
                stroke="none"
                label={{
                  value: `예측: ~${formatManwon(predictedTotal)}원`,
                  position: "insideTopRight",
                  className: "fill-muted-foreground text-xs",
                  fontSize: 12,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="h-0.5 w-3 bg-red-500" />
          전체 누적
        </span>
        {activeCategories.map((category) => (
          <span
            key={category}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              className="h-0.5 w-3"
              style={{ backgroundColor: SPENDING_CATEGORY_COLORS[category] }}
            />
            {SPENDING_CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
    </div>
  );
}
