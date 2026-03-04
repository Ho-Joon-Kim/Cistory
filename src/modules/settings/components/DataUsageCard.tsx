"use client";

import { useMemo } from "react";
import { Label, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Database } from "lucide-react";
import { useDataUsage } from "../hooks";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  commits: "#10b981",
  location: "#f59e0b",
  coding: "#3b82f6",
  spending: "#8b5cf6",
  system: "#6b7280",
};

export function DataUsageCard() {
  const { data, isLoading, isRefreshing, refresh } = useDataUsage();

  const { chartConfig, chartData, categoryKeys } = useMemo(() => {
    if (!data?.categories.length) {
      return { chartConfig: {} as ChartConfig, chartData: [] as Record<string, number>[], categoryKeys: [] as string[] };
    }

    // Sort by totalBytes descending
    const sorted = [...data.categories].sort((a, b) => b.totalBytes - a.totalBytes);

    // Build chart config: each category becomes a key
    const config: ChartConfig = {};
    const row: Record<string, number> = {};
    const keys: string[] = [];

    for (const cat of sorted) {
      config[cat.category] = {
        label: cat.label,
        color: CATEGORY_COLORS[cat.category] ?? "#6b7280",
      };
      row[cat.category] = cat.totalBytes;
      keys.push(cat.category);
    }

    return { chartConfig: config, chartData: [row], categoryKeys: keys };
  }, [data]);

  const hasData = data && data.categories.length > 0 && data.grandTotalBytes > 0;

  return (
    <Card className="select-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
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
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Radial bar chart (semi-circle) */}
              <ChartContainer
                config={chartConfig}
                className="mx-auto aspect-square w-full max-w-[220px] shrink-0"
              >
                <RadialBarChart
                  data={chartData}
                  endAngle={180}
                  innerRadius={60}
                  outerRadius={100}
                >
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value, name) => {
                          const label = chartConfig[name as string]?.label ?? name;
                          const cat = data!.categories.find((c) => c.category === name);
                          return (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">{label as string}</span>
                              <span className="font-medium font-mono tabular-nums text-foreground">
                                {formatBytes(value as number)}
                                {cat ? ` · ${cat.totalRows.toLocaleString()}건` : ""}
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
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
                  </PolarRadiusAxis>
                  {categoryKeys.map((key) => (
                    <RadialBar
                      key={key}
                      dataKey={key}
                      stackId="a"
                      cornerRadius={4}
                      fill={`var(--color-${key})`}
                      className="stroke-transparent stroke-2"
                    />
                  ))}
                </RadialBarChart>
              </ChartContainer>

              {/* Category list */}
              <div className="flex-1 min-w-0 space-y-2 w-full">
                {data!.categories.map((cat) => {
                  const pct =
                    data!.grandTotalBytes > 0
                      ? ((cat.totalBytes / data!.grandTotalBytes) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <div
                      key={cat.category}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: CATEGORY_COLORS[cat.category] ?? "#6b7280",
                        }}
                      />
                      <span className="font-medium w-12 shrink-0">{cat.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {cat.totalRows.toLocaleString()}건
                      </span>
                      <span className="ml-auto text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatBytes(cat.totalBytes)}
                      </span>
                      <span className="text-muted-foreground/60 tabular-nums w-12 text-right text-xs">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Last calculated timestamp */}
            {data!.calculatedAt && (
              <p className="text-xs text-muted-foreground mt-4 text-right">
                마지막 갱신: {formatRelativeTime(data!.calculatedAt)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
