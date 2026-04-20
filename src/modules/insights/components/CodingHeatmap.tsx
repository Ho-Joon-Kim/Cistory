"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommitHeatmapResult } from "../service";

interface CodingHeatmapProps {
  data: CommitHeatmapResult | null;
  isLoading: boolean;
  year: number;
}

const DAY_LABELS = ["", "월", "", "수", "", "금", ""];
const MONTH_LABELS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

function getColor(count: number, max: number): string {
  if (count === 0) return "bg-muted";
  const ratio = count / Math.max(max, 1);
  if (ratio <= 0.25) return "bg-emerald-200 dark:bg-emerald-900";
  if (ratio <= 0.5) return "bg-emerald-400 dark:bg-emerald-700";
  if (ratio <= 0.75) return "bg-emerald-500 dark:bg-emerald-500";
  return "bg-emerald-600 dark:bg-emerald-400";
}

export function CodingHeatmap({ data, isLoading, year }: CodingHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const { weeks, maxCount, monthPositions } = useMemo(() => {
    if (!data?.days?.length) {
      return { weeks: [], maxCount: 0, monthPositions: [] };
    }

    let max = 0;
    for (const d of data.days) {
      if (d.count > max) max = d.count;
    }

    // Build weeks grid: each week is a column of 7 days (Sun=0 to Sat=6)
    const weeksArr: { date: string; count: number; dayOfWeek: number }[][] = [];

    // Find the first day of the year and its day-of-week
    const firstDay = new Date(year, 0, 1);
    const startDayOfWeek = firstDay.getDay(); // 0=Sun

    // Start with a partial first week
    let currentWeek: { date: string; count: number; dayOfWeek: number }[] = [];

    // Add empty slots for days before Jan 1 in the first week
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push({ date: "", count: -1, dayOfWeek: i });
    }

    for (const d of data.days) {
      const [y, m, dayStr] = d.date.split("-").map(Number);
      const dt = new Date(y, m - 1, dayStr);
      const dow = dt.getDay();

      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }

      currentWeek.push({ date: d.date, count: d.count, dayOfWeek: dow });
    }

    if (currentWeek.length > 0) {
      weeksArr.push(currentWeek);
    }

    // Compute month label positions
    const positions: { month: number; weekIdx: number }[] = [];
    let lastMonth = -1;
    for (let wi = 0; wi < weeksArr.length; wi++) {
      for (const cell of weeksArr[wi]) {
        if (cell.date) {
          const month = parseInt(cell.date.split("-")[1], 10) - 1;
          if (month !== lastMonth) {
            positions.push({ month, weekIdx: wi });
            lastMonth = month;
          }
          break;
        }
      }
    }

    return { weeks: weeksArr, maxCount: max, monthPositions: positions };
  }, [data, year]);

  if (isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>커밋 히트맵</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[140px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || weeks.length === 0) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>커밋 히트맵</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </CardContent>
      </Card>
    );
  }

  const cellSize = 12;
  const cellGap = 2;
  const step = cellSize + cellGap;
  const dayLabelWidth = 28;
  const monthLabelHeight = 16;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>커밋 히트맵</CardTitle>
      </CardHeader>
      <CardContent className="relative overflow-x-auto">
        <svg
          width={dayLabelWidth + weeks.length * step + 4}
          height={monthLabelHeight + 7 * step + 4}
          className="block"
          role="img"
          aria-label="연중 일별 커밋 활동 히트맵"
        >
          <title>연중 일별 커밋 활동 히트맵</title>
          {/* Month labels */}
          {monthPositions.map((mp) => (
            <text
              key={mp.month}
              x={dayLabelWidth + mp.weekIdx * step}
              y={12}
              className="fill-muted-foreground"
              fontSize={10}
            >
              {MONTH_LABELS[mp.month]}
            </text>
          ))}

          {/* Day labels */}
          {DAY_LABELS.map((label, i) =>
            label ? (
              <text
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed DAY_LABELS array; index is the stable weekday id
                key={i}
                x={0}
                y={monthLabelHeight + i * step + cellSize - 1}
                className="fill-muted-foreground"
                fontSize={10}
              >
                {label}
              </text>
            ) : null
          )}

          {/* Cells */}
          {weeks.map((week, wi) =>
            week.map((cell) => {
              if (cell.count < 0) return null;
              const x = dayLabelWidth + wi * step;
              const y = monthLabelHeight + cell.dayOfWeek * step;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover-only tooltip on an SVG rect; the whole heatmap has an aria-label on the svg parent, individual cells aren't keyboard-focusable targets
                <rect
                  key={cell.date}
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  className={`${getColor(cell.count, maxCount)} transition-colors`}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGRectElement).getBoundingClientRect();
                    setTooltip({
                      text: `${cell.date}: ${cell.count}개 커밋`,
                      x: rect.left + rect.width / 2,
                      y: rect.top - 8,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })
          )}
        </svg>

        {tooltip && (
          <div
            className="fixed z-50 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md pointer-events-none whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            {tooltip.text}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
          <span>적음</span>
          <div className="w-3 h-3 rounded-sm bg-muted" />
          <div className="w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-900" />
          <div className="w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-700" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-500" />
          <div className="w-3 h-3 rounded-sm bg-emerald-600 dark:bg-emerald-400" />
          <span>많음</span>
        </div>
      </CardContent>
    </Card>
  );
}
