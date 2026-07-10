"use client";

import { useMemo } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  SPENDING_CATEGORY_COLORS,
  SPENDING_CATEGORY_LABELS,
  type SpendingCategoryKey,
} from "../categories";

interface CategoryBreakdownItem {
  category: SpendingCategoryKey | null;
  count: number;
  total: number;
}

interface CategorySpendingChartProps {
  data: CategoryBreakdownItem[];
}

function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatCompactWon(value: number): string {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}억원`;
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}만원`;
  }
  return formatWon(value);
}

export function CategorySpendingChart({ data }: CategorySpendingChartProps) {
  const { categories, total } = useMemo(() => {
    const sorted = data
      .map((item) => {
        const category = item.category ?? "uncategorized";
        return {
          ...item,
          category,
          color: SPENDING_CATEGORY_COLORS[category],
          label: SPENDING_CATEGORY_LABELS[category],
        };
      })
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      categories: sorted,
      total: sorted.reduce((sum, item) => sum + item.total, 0),
    };
  }, [data]);

  const chartData = useMemo(
    () => [
      categories.reduce<Record<string, number>>((values, item) => {
        values[item.category] = item.total;
        return values;
      }, {}),
    ],
    [categories]
  );

  return (
    <div className="pt-2">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">지출 비중</span>
        <strong className="text-sm tabular-nums">총 {formatCompactWon(total)}</strong>
      </div>

      <div className="relative z-0 h-5 rounded-md bg-muted">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={0}
          >
            <XAxis type="number" hide />
            <YAxis type="category" hide />
            <Tooltip
              cursor={false}
              wrapperStyle={{ zIndex: 50 }}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
                fontSize: "12px",
              }}
              formatter={(value, name) => [formatWon(Number(value)), String(name)]}
            />
            {categories.map((item, index) => (
              <Bar
                key={item.category}
                dataKey={item.category}
                name={item.label}
                stackId="total"
                fill={item.color}
                radius={
                  index === 0 ? [5, 0, 0, 5] : index === categories.length - 1 ? [0, 5, 5, 0] : 0
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex gap-5 overflow-x-auto pb-1">
        {categories.map((item) => {
          const share = total > 0 ? (item.total / total) * 100 : 0;

          return (
            <div key={item.category} className="shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-xs font-medium">{item.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {share.toFixed(1)}%
                </span>
              </div>
              <p className="mt-1 text-[11px] tabular-nums">
                <span className="font-semibold">{formatWon(item.total)}</span>
                <span className="ml-1 text-muted-foreground">· {item.count}건</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
