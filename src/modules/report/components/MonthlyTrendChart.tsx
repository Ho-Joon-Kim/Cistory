"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { YearlyReportData } from "../types";

interface MonthlyTrendChartProps {
  monthlyTrend: YearlyReportData["monthlyTrend"];
}

export function MonthlyTrendChart({ monthlyTrend }: MonthlyTrendChartProps) {
  const data = useMemo(() => {
    return monthlyTrend.map((item) => ({
      month: item.month,
      commits: item.commits,
      codingHours: Math.round((item.codingSeconds / 3600) * 10) / 10,
      activeDays: item.activeDays,
    }));
  }, [monthlyTrend]);

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="month"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
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
          formatter={(value, name) => {
            if (name === "commits") return [`${value}건`, "커밋"];
            if (name === "codingHours") return [`${value}시간`, "코딩 시간"];
            if (name === "activeDays") return [`${value}일`, "활동일"];
            return [value, String(name)];
          }}
        />
        <Legend
          formatter={(value) => {
            if (value === "commits") return "커밋";
            if (value === "codingHours") return "코딩 시간";
            if (value === "activeDays") return "활동일";
            return value;
          }}
          wrapperStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="commits"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 4, fill: "#10b981" }}
          activeDot={{ r: 6 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="codingHours"
          stroke="#8b5cf6"
          strokeWidth={2}
          dot={{ r: 4, fill: "#8b5cf6" }}
          activeDot={{ r: 6 }}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="activeDays"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 4, fill: "#3b82f6" }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
