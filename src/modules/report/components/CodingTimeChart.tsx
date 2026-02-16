"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface CodingTimeChartProps {
  dailyCodingSeconds: { date: string; seconds: number }[];
}

export function CodingTimeChart({ dailyCodingSeconds }: CodingTimeChartProps) {
  const data = dailyCodingSeconds.map((d) => ({
    date: d.date,
    hours: Math.round((d.seconds / 3600) * 10) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="codingGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          interval={4}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          unit="h"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          labelFormatter={(label) => `${label}`}
          formatter={(value) => [`${value}시간`, "코딩 시간"]}
        />
        <Area
          type="monotone"
          dataKey="hours"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#codingGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
