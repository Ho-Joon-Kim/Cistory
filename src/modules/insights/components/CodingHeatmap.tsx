"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CodingHeatmapProps {
  data: { days: { date: string; count: number }[] } | null;
  isLoading: boolean;
  year: number;
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function getColorClass(count: number): string {
  if (count === 0) return "bg-muted/30";
  if (count <= 2) return "bg-emerald-200 dark:bg-emerald-900";
  if (count <= 5) return "bg-emerald-400 dark:bg-emerald-700";
  if (count <= 10) return "bg-emerald-500 dark:bg-emerald-500";
  return "bg-emerald-700 dark:bg-emerald-300";
}

export function CodingHeatmap({ data, isLoading, year }: CodingHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ date: string; count: number; x: number; y: number } | null>(null);

  const { grid, monthPositions } = useMemo(() => {
    if (!data) return { grid: [], monthPositions: [] };

    // Build a lookup from date string to count
    const countMap: Record<string, number> = {};
    for (const d of data.days) {
      countMap[d.date] = d.count;
    }

    // Build the grid: 7 rows (days of week) x ~53 columns (weeks)
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    // Start from the Sunday of the week containing Jan 1
    const startDay = jan1.getDay();
    const startDate = new Date(year, 0, 1 - startDay);

    // End at the Saturday of the week containing Dec 31
    const endDay = dec31.getDay();
    const endDate = new Date(year, 11, 31 + (6 - endDay));

    const weeks: { date: string; count: number; inYear: boolean }[][] = [];
    const monthPos: { label: string; weekIndex: number }[] = [];
    let currentDate = new Date(startDate);
    let weekIndex = 0;
    let lastMonth = -1;

    while (currentDate <= endDate) {
      const week: { date: string; count: number; inYear: boolean }[] = [];

      for (let day = 0; day < 7; day++) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
        const inYear = currentDate.getFullYear() === year;
        const count = inYear ? (countMap[dateStr] || 0) : 0;

        // Track month boundaries
        if (inYear && currentDate.getMonth() !== lastMonth && day <= 3) {
          lastMonth = currentDate.getMonth();
          monthPos.push({ label: MONTH_LABELS[lastMonth], weekIndex });
        }

        week.push({ date: dateStr, count, inYear });
        currentDate = new Date(currentDate.getTime() + 86400000);
      }

      weeks.push(week);
      weekIndex++;
    }

    return { grid: weeks, monthPositions: monthPos };
  }, [data, year]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>커밋 히트맵</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
            불러오는 중...
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalCommits = data?.days.reduce((sum, d) => sum + d.count, 0) ?? 0;

  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>커밋 히트맵</span>
          <span className="text-sm font-normal text-muted-foreground">
            {totalCommits.toLocaleString()}개 커밋
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="overflow-x-auto">
          {/* Month labels */}
          <div className="flex ml-8">
            {monthPositions.map((mp, i) => (
              <div
                key={`${mp.label}-${i}`}
                className="text-xs text-muted-foreground"
                style={{
                  position: "absolute",
                  left: `${mp.weekIndex * 14 + 32}px`,
                }}
              >
                {mp.label}
              </div>
            ))}
          </div>

          <div className="flex gap-[2px] mt-5">
            {/* Day labels */}
            <div className="flex flex-col gap-[2px] mr-1 shrink-0">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className="h-[12px] text-[10px] leading-[12px] text-muted-foreground"
                  style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Heatmap grid */}
            {grid.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[2px]">
                {week.map((cell, di) => (
                  <div
                    key={cell.date}
                    className={`w-[12px] h-[12px] rounded-[2px] ${
                      cell.inYear ? getColorClass(cell.count) : "bg-transparent"
                    } transition-colors`}
                    onMouseEnter={(e) => {
                      if (cell.inYear) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          date: cell.date,
                          count: cell.count,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
            <span>적음</span>
            <div className="w-[12px] h-[12px] rounded-[2px] bg-muted/30" />
            <div className="w-[12px] h-[12px] rounded-[2px] bg-emerald-200 dark:bg-emerald-900" />
            <div className="w-[12px] h-[12px] rounded-[2px] bg-emerald-400 dark:bg-emerald-700" />
            <div className="w-[12px] h-[12px] rounded-[2px] bg-emerald-500 dark:bg-emerald-500" />
            <div className="w-[12px] h-[12px] rounded-[2px] bg-emerald-700 dark:bg-emerald-300" />
            <span>많음</span>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y - 30,
              transform: "translateX(-50%)",
            }}
          >
            {tooltip.date}: {tooltip.count}개 커밋
          </div>
        )}
      </CardContent>
    </Card>
  );
}
