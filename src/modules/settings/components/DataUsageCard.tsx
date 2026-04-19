"use client";

import { Database, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Cell, Label, Pie, PieChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatBytes, formatRelativeTime } from "@/lib/utils";
import { useDataUsage } from "../hooks";

const CATEGORY_COLORS: Record<string, string> = {
  commits: "#10b981",
  location: "#f59e0b",
  coding: "#3b82f6",
  spending: "#8b5cf6",
  system: "#6b7280",
};

export function DataUsageCard() {
  const { data, isLoading, isRefreshing, refresh } = useDataUsage();

  const { chartConfig, chartData } = useMemo(() => {
    if (!data?.categories.length) {
      return {
        chartConfig: {} as ChartConfig,
        chartData: [] as { category: string; bytes: number; rows: number; fill: string }[],
      };
    }

    const sorted = [...data.categories].sort((a, b) => b.totalBytes - a.totalBytes);

    const config: ChartConfig = {};
    const pieData: { category: string; bytes: number; rows: number; fill: string }[] = [];

    for (const cat of sorted) {
      const color = CATEGORY_COLORS[cat.category] ?? "#6b7280";
      config[cat.category] = {
        label: cat.label,
        color,
      };
      pieData.push({
        category: cat.category,
        bytes: cat.totalBytes,
        rows: cat.totalRows,
        fill: color,
      });
    }

    return { chartConfig: config, chartData: pieData };
  }, [data]);

  const hasData = data && data.categories.length > 0 && data.grandTotalBytes > 0;

  return (
    <Card className="select-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">데이터 용량</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          className="focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5">{isRefreshing ? "계산 중..." : "새로고침"}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Database className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">데이터 없음</p>
            <p className="text-xs mt-1">새로고침 버튼을 눌러 용량을 계산하세요</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {/* Pie donut chart (semi-circle) */}
              {/*
                Semi-circle layout math:
                - Container: 260w × 150h (CSS)
                - SVG viewBox auto-sized by ResponsiveContainer inside ChartContainer
                - cy={130}: arc center near bottom, leaving 20px below for "건" text
                - outerRadius=120: arc top at y=10, fits within 150h
                - innerRadius=70: donut hole for center text
                - cx="50%": horizontally centered, 120 fits within 130 (260/2)
              */}
              <ChartContainer
                config={chartConfig}
                className="w-[260px] h-[150px] shrink-0 overflow-hidden"
              >
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideLabel
                        nameKey="category"
                        formatter={(_value, _name, item) => {
                          const cat = item.payload as {
                            category: string;
                            bytes: number;
                            rows: number;
                            fill: string;
                          };
                          const label = chartConfig[cat.category]?.label ?? cat.category;
                          return (
                            <div className="flex items-center gap-2 text-xs">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-[2px] shrink-0"
                                style={{ backgroundColor: cat.fill }}
                              />
                              <span className="text-muted-foreground">{label as string}</span>
                              <span className="font-medium tabular-nums text-foreground">
                                {formatBytes(cat.bytes)} · {cat.rows.toLocaleString()}건
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Pie
                    data={chartData}
                    dataKey="bytes"
                    nameKey="category"
                    cx="50%"
                    cy={130}
                    startAngle={180}
                    endAngle={0}
                    innerRadius={70}
                    outerRadius={120}
                    paddingAngle={1.5}
                    strokeWidth={0}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.category} fill={entry.fill} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) - 16}
                                className="fill-foreground text-xl font-bold"
                              >
                                {formatBytes(data!.grandTotalBytes)}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) + 4}
                                className="fill-muted-foreground text-xs"
                              >
                                {data!.grandTotalRows.toLocaleString()}건
                              </tspan>
                            </text>
                          );
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>

              {/* Category list */}
              <div className="flex-1 min-w-0 space-y-1.5">
                {data!.categories.map((cat) => {
                  const pct =
                    data!.grandTotalBytes > 0
                      ? ((cat.totalBytes / data!.grandTotalBytes) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <div key={cat.category} className="flex items-center gap-2.5 text-sm">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: CATEGORY_COLORS[cat.category] ?? "#6b7280",
                        }}
                      />
                      <span className="font-medium w-10 shrink-0">{cat.label}</span>
                      <span className="text-muted-foreground tabular-nums text-xs">
                        {cat.totalRows.toLocaleString()}건
                      </span>
                      <span className="ml-auto text-muted-foreground tabular-nums whitespace-nowrap text-xs">
                        {formatBytes(cat.totalBytes)}
                      </span>
                      <span className="text-muted-foreground/50 tabular-nums w-10 text-right text-xs">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {data!.calculatedAt && (
              <p className="text-xs text-muted-foreground mt-3 text-right">
                마지막 갱신: {formatRelativeTime(data!.calculatedAt)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
