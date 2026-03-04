"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Database } from "lucide-react";
import { useDataUsage } from "../hooks";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

const CATEGORY_COLORS = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#6b7280", // gray
  "#ef4444", // red
  "#ec4899", // pink
];

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; rows: number; fill: string } }> }) {
  if (!active || !payload?.[0]) return null;

  const { name, value, rows, fill: color } = payload[0].payload;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-lg text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-150">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium text-sm">{name}</span>
      </div>
      <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
        <span>{formatBytes(value)}</span>
        <span>{rows.toLocaleString()}건</span>
      </div>
    </div>
  );
}

export function DataUsageCard() {
  const { data, isLoading, isRefreshing, refresh } = useDataUsage();

  const chartData = useMemo(() => {
    if (!data?.categories.length) return [];
    return data.categories.map((cat, index) => ({
      name: cat.label,
      value: cat.totalBytes,
      rows: cat.totalRows,
      fill: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));
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
      <CardContent className="[&_*]:outline-none">
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
              {/* Semi-circle donut chart */}
              <div className="relative w-[220px] h-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="100%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={1}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={<CustomTooltip />}
                      wrapperStyle={{ outline: "none" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center text overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
                  <span className="text-lg font-bold leading-tight">
                    {formatBytes(data!.grandTotalBytes)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data!.grandTotalRows.toLocaleString()}건
                  </span>
                </div>
              </div>

              {/* Category list */}
              <div className="flex-1 min-w-0 space-y-2 w-full">
                {data!.categories.map((cat, index) => {
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
                          backgroundColor:
                            CATEGORY_COLORS[index % CATEGORY_COLORS.length],
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
