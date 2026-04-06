"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface StreakGamificationProps {
  data: {
    currentCommitStreak: number;
    maxCommitStreak: number;
    calendar: Record<string, { hasCommit: boolean }>;
  } | null;
  isLoading: boolean;
  year: number;
}

const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export function StreakGamification({ data, isLoading, year }: StreakGamificationProps) {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const monthGrid = useMemo(() => {
    if (!data) return null;

    const month = selectedMonth ?? new Date().getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const cells: { date: string; hasCommit: boolean; inMonth: boolean }[] = [];

    // Fill leading empty cells
    for (let i = 0; i < startDow; i++) {
      cells.push({ date: "", hasCommit: false, inMonth: false });
    }

    // Fill month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const entry = data.calendar[dateStr];
      cells.push({
        date: dateStr,
        hasCommit: entry?.hasCommit ?? false,
        inMonth: true,
      });
    }

    return cells;
  }, [data, year, selectedMonth]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>스트릭</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            불러오는 중...
          </div>
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
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            데이터 없음
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentMonth = selectedMonth ?? new Date().getMonth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>스트릭</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Streak numbers */}
        <div className="flex gap-4">
          <div className="flex-1 text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">
              {data.currentCommitStreak > 0 && "🔥 "}
              {data.currentCommitStreak}
            </div>
            <div className="text-xs text-muted-foreground mt-1">현재 스트릭</div>
          </div>
          <div className="flex-1 text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">{data.maxCommitStreak}</div>
            <div className="text-xs text-muted-foreground mt-1">최대 스트릭</div>
          </div>
        </div>

        {/* Month selector */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMonth(Math.max(0, currentMonth - 1))}
            disabled={currentMonth === 0}
          >
            &lt;
          </Button>
          <span className="text-sm font-medium">{MONTH_LABELS[currentMonth]}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMonth(Math.min(11, currentMonth + 1))}
            disabled={currentMonth === 11}
          >
            &gt;
          </Button>
        </div>

        {/* Mini calendar */}
        <div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
              <div key={d} className="text-center text-[10px] text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid?.map((cell, i) => (
              <div
                key={cell.date || `empty-${i}`}
                className={`aspect-square rounded-sm flex items-center justify-center text-[10px] ${
                  !cell.inMonth
                    ? "bg-transparent"
                    : cell.hasCommit
                      ? "bg-emerald-500 dark:bg-emerald-400 text-white dark:text-black font-medium"
                      : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {cell.inMonth ? parseInt(cell.date.slice(-2), 10) : ""}
              </div>
            ))}
          </div>
        </div>

        {/* Active days count */}
        <div className="text-center text-xs text-muted-foreground">
          {monthGrid
            ? `${monthGrid.filter((c) => c.inMonth && c.hasCommit).length}일 활동`
            : ""}
        </div>
      </CardContent>
    </Card>
  );
}
