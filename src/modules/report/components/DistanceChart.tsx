"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface DistanceChartProps {
  dailyDistances: { date: string; meters: number }[];
}

export function DistanceChart({ dailyDistances }: DistanceChartProps) {
  const data = dailyDistances.map((d) => ({
    date: d.date,
    km: Math.round((d.meters / 1000) * 10) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
          unit="km"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          labelFormatter={(label) => `${label}`}
          formatter={(value) => [`${value}km`, "이동 거리"]}
        />
        <Bar dataKey="km" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
