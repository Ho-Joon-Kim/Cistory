"use client";

import { useMemo } from "react";
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
import type { MonthlyReportData } from "../types";

const TYPE_LABELS: Record<string, string> = {
  feat: "기능",
  fix: "버그수정",
  refactor: "리팩토링",
  docs: "문서",
  style: "스타일",
  test: "테스트",
  chore: "기타작업",
  perf: "성능개선",
  ci: "CI/CD",
  build: "빌드",
  revert: "되돌리기",
};

const TYPE_COLORS: Record<string, string> = {
  feat: "#10b981",
  fix: "#ef4444",
  refactor: "#f59e0b",
  docs: "#3b82f6",
  style: "#ec4899",
  test: "#8b5cf6",
  chore: "#6b7280",
  perf: "#14b8a6",
  ci: "#f97316",
  build: "#a855f7",
  revert: "#e11d48",
};

const DEFAULT_COLOR = "#6b7280";

interface CommitTypeBreakdownProps {
  breakdown: MonthlyReportData["commitTypeBreakdown"];
}

export function CommitTypeBreakdown({ breakdown }: CommitTypeBreakdownProps) {
  const data = useMemo(() => {
    return [...breakdown]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        type: item.type,
        label: TYPE_LABELS[item.type] || item.type,
        count: item.count,
        color: TYPE_COLORS[item.type] || DEFAULT_COLOR,
      }));
  }, [breakdown]);

  return (
    <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          width={70}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          formatter={(value) => [`${value}건`, "커밋"]}
          labelFormatter={(label) => `${label}`}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.type} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
