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
import {
  SPENDING_CATEGORY_COLORS,
  SPENDING_CATEGORY_LABELS,
  type SpendingCategoryKey,
} from "../categories";
import type { MonthlyBarDataPoint } from "../types";

interface MonthlySpendingBarProps {
  data: MonthlyBarDataPoint[];
}

function formatManwon(value: number): string {
  if (value >= 10000) return `${Math.round(value / 10000)}만`;
  if (value >= 1000) return `${(value / 10000).toFixed(1)}만`;
  return String(value);
}

export function MonthlySpendingBar({ data }: MonthlySpendingBarProps) {
  const activeCategories = useMemo(() => {
    const totals = new Map<SpendingCategoryKey, number>();
    for (const item of data) {
      for (const [category, total] of Object.entries(item.categories)) {
        const key = category as SpendingCategoryKey;
        totals.set(key, (totals.get(key) ?? 0) + (total ?? 0));
      }
    }
    return Array.from(totals.entries())
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);
  }, [data]);

  return (
    <div className="w-full">
      <div className="h-[190px] md:h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickFormatter={(month) => `${Number.parseInt(month, 10)}월`}
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
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
              labelFormatter={(label) => `${Number.parseInt(String(label), 10)}월`}
              formatter={(value, name) => [
                `${Number(value).toLocaleString("ko-KR")}원`,
                String(name),
              ]}
            />
            {activeCategories.map((category) => (
              <Bar
                key={category}
                dataKey={(item: MonthlyBarDataPoint) => item.categories[category] ?? 0}
                name={SPENDING_CATEGORY_LABELS[category]}
                stackId="category"
                fill={SPENDING_CATEGORY_COLORS[category]}
                maxBarSize={36}
              >
                {data.map((entry) => (
                  <Cell
                    key={`${entry.month}-${category}`}
                    fill={SPENDING_CATEGORY_COLORS[category]}
                    fillOpacity={entry.isCurrent ? 0.58 : 0.9}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {activeCategories.map((category) => (
          <span
            key={category}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: SPENDING_CATEGORY_COLORS[category] }}
            />
            {SPENDING_CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
    </div>
  );
}
