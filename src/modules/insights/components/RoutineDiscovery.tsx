"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoutinePatternsResult } from "../service";

interface RoutineDiscoveryProps {
  data: RoutinePatternsResult | null;
  isLoading: boolean;
}

const DAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"];

export function RoutineDiscovery({ data, isLoading }: RoutineDiscoveryProps) {
  const chartData = useMemo(() => {
    if (!data?.dayPatterns) return null;

    const maxCommits = Math.max(...data.dayPatterns.map((d) => d.commits), 1);

    return data.dayPatterns.map((dp) => ({
      ...dp,
      barHeight: (dp.commits / maxCommits) * 100,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>요일별 루틴</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || !chartData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>요일별 루틴</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </CardContent>
      </Card>
    );
  }

  const _maxCommits = Math.max(...data.dayPatterns.map((d) => d.commits), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>요일별 루틴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bar chart */}
        <div className="flex items-end justify-between gap-2 h-40">
          {chartData.map((dp) => (
            <div key={dp.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-xs text-muted-foreground">{dp.commits}</div>
              <div className="w-full relative h-28">
                <div
                  className="absolute bottom-0 left-0 right-0 bg-emerald-500 dark:bg-emerald-400 rounded-t-md transition-all"
                  style={{ height: `${dp.barHeight}%`, minHeight: dp.commits > 0 ? 4 : 0 }}
                />
              </div>
              <div className="text-xs font-medium">{DAY_SHORT[dp.day]}</div>
            </div>
          ))}
        </div>

        {/* Summary table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-2 py-1.5 text-left font-medium">요일</th>
                <th className="px-2 py-1.5 text-right font-medium">커밋</th>
                <th className="px-2 py-1.5 text-right font-medium">코딩</th>
                <th className="px-2 py-1.5 text-right font-medium">거래</th>
              </tr>
            </thead>
            <tbody>
              {data.dayPatterns.map((dp) => (
                <tr key={dp.day} className="border-b last:border-b-0">
                  <td className="px-2 py-1.5 font-medium">{DAY_SHORT[dp.day]}</td>
                  <td className="px-2 py-1.5 text-right">{dp.commits}</td>
                  <td className="px-2 py-1.5 text-right">
                    {dp.codingSeconds > 0 ? `${Math.round(dp.codingSeconds / 3600)}시간` : "-"}
                  </td>
                  <td className="px-2 py-1.5 text-right">{dp.transactions || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
