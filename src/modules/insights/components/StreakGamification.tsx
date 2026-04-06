"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StreaksResult } from "../service";

interface StreakGamificationProps {
  data: StreaksResult | null;
  isLoading: boolean;
  year: number;
}

const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export function StreakGamification({ data, isLoading, year }: StreakGamificationProps) {
  const calendarWeeks = useMemo(() => {
    if (!data?.calendar) return [];

    const entries = Object.entries(data.calendar).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return [];

    const weeks: { date: string; hasCommit: boolean; dayOfWeek: number; month: number }[][] = [];
    let currentWeek: { date: string; hasCommit: boolean; dayOfWeek: number; month: number }[] = [];

    // Parse first date to get day of week
    const [firstY, firstM, firstD] = entries[0][0].split("-").map(Number);
    const firstDate = new Date(firstY, firstM - 1, firstD);
    const firstDow = firstDate.getDay();

    // Pad first week
    for (let i = 0; i < firstDow; i++) {
      currentWeek.push({ date: "", hasCommit: false, dayOfWeek: i, month: -1 });
    }

    for (const [dateStr, val] of entries) {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();

      if (dow === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      currentWeek.push({ date: dateStr, hasCommit: val.hasCommit, dayOfWeek: dow, month: m });
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>스트릭</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>스트릭</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>스트릭</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Streak numbers */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {data.currentCommitStreak}
            </div>
            <div className="text-xs text-muted-foreground mt-1">현재 스트릭</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {data.maxCommitStreak}
            </div>
            <div className="text-xs text-muted-foreground mt-1">최대 스트릭</div>
          </div>
        </div>

        {/* Mini calendar */}
        <div className="overflow-x-auto">
          <div className="flex gap-[2px]" style={{ minWidth: "fit-content" }}>
            {calendarWeeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[2px]">
                {week.map((cell, ci) => (
                  <div
                    key={cell.date || `empty-${wi}-${ci}`}
                    className={`w-2.5 h-2.5 rounded-[2px] ${
                      !cell.date
                        ? "bg-transparent"
                        : cell.hasCommit
                          ? "bg-emerald-500 dark:bg-emerald-400"
                          : "bg-muted"
                    }`}
                    title={cell.date ? `${cell.date}: ${cell.hasCommit ? "활동" : "비활동"}` : ""}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
