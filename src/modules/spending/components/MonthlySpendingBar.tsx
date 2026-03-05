"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyBarDataPoint } from "../types";

interface MonthlySpendingBarProps {
  data: MonthlyBarDataPoint[];
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

export function MonthlySpendingBar({ data }: MonthlySpendingBarProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickFormatter={(m) => `${Number.parseInt(m)}월`}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickFormatter={formatManwon}
          width={45}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
          labelFormatter={(label) => `${Number.parseInt(label)}월`}
          formatter={(value: number) => {
            return [`${value.toLocaleString("ko-KR")}원`, "지출"];
          }}
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={32}>
          {data.map((entry) => (
            <Cell
              key={`cell-${entry.month}`}
              fill={entry.isCurrent ? "#f87171" : "#ef4444"}
              fillOpacity={entry.isCurrent ? 0.45 : 0.75}
              stroke={entry.isCurrent ? "#ef4444" : "none"}
              strokeWidth={entry.isCurrent ? 1.5 : 0}
              strokeDasharray={entry.isCurrent ? "4 3" : ""}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
