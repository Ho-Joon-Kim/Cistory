"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ActivityHeatmapProps {
  dailyCommits: { date: string; count: number }[];
  startDate: string;
  endDate: string;
}

function getColorClass(count: number): string {
  if (count === 0) return "bg-muted dark:bg-muted";
  if (count <= 2) return "bg-emerald-100 dark:bg-emerald-900";
  if (count <= 5) return "bg-emerald-200 dark:bg-emerald-800";
  if (count <= 8) return "bg-emerald-400 dark:bg-emerald-600";
  return "bg-emerald-600 dark:bg-emerald-400";
}

function formatDateKo(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

interface DayCell {
  date: string;
  count: number;
  dayOfWeek: number;
  weekIndex: number;
}

export function ActivityHeatmap({ dailyCommits, startDate, endDate }: ActivityHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<DayCell | null>(null);

  const { cells, totalWeeks, isYearly } = useMemo(() => {
    const commitMap = new Map<string, number>();
    for (const dc of dailyCommits) {
      commitMap.set(dc.date, dc.count);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const yearly = diffDays > 60;

    const result: DayCell[] = [];
    const current = new Date(start);
    const startDayOfWeek = current.getDay();

    let weekIdx = 0;
    let prevDayOfWeek = startDayOfWeek;

    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      const dayOfWeek = current.getDay();

      if (result.length > 0 && dayOfWeek < prevDayOfWeek) {
        weekIdx++;
      }
      prevDayOfWeek = dayOfWeek;

      result.push({
        date: dateStr,
        count: commitMap.get(dateStr) ?? 0,
        dayOfWeek,
        weekIndex: weekIdx,
      });

      current.setDate(current.getDate() + 1);
    }

    return {
      cells: result,
      totalWeeks: weekIdx + 1,
      isYearly: yearly,
    };
  }, [dailyCommits, startDate, endDate]);

  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  if (isYearly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">활동 히트맵</CardTitle>
        </CardHeader>
        <CardContent>
          <TooltipProvider delayDuration={100}>
            <div className="flex gap-0.5">
              {/* Day labels */}
              <div className="flex flex-col gap-0.5 pr-1.5 pt-0">
                {dayLabels.map((label, i) => (
                  <div
                    key={label}
                    className={cn(
                      "h-[13px] text-[10px] leading-[13px] text-muted-foreground",
                      i % 2 === 0 ? "invisible" : ""
                    )}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Grid */}
              <div
                className="grid gap-0.5 overflow-x-auto"
                style={{
                  gridTemplateRows: "repeat(7, 13px)",
                  gridTemplateColumns: `repeat(${totalWeeks}, 13px)`,
                  gridAutoFlow: "column",
                }}
              >
                {(() => {
                  const elements: React.ReactNode[] = [];
                  // Fill empty cells before the first day
                  const firstDay = cells[0];
                  if (firstDay) {
                    for (let i = 0; i < firstDay.dayOfWeek; i++) {
                      elements.push(<div key={`empty-${i}`} className="h-[13px] w-[13px]" />);
                    }
                  }
                  for (const cell of cells) {
                    elements.push(
                      <Tooltip key={cell.date}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "h-[13px] w-[13px] rounded-sm transition-colors",
                              getColorClass(cell.count),
                              hoveredCell?.date === cell.date && "ring-1 ring-foreground"
                            )}
                            onMouseEnter={() => setHoveredCell(cell)}
                            onMouseLeave={() => setHoveredCell(null)}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-medium">{formatDateKo(cell.date)}</p>
                          <p className="text-muted-foreground">
                            {cell.count > 0 ? `${cell.count}개 커밋` : "커밋 없음"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return elements;
                })()}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1.5 mt-3 text-xs text-muted-foreground">
              <span>적음</span>
              {[0, 1, 3, 6, 9].map((level) => (
                <div
                  key={level}
                  className={cn("h-[11px] w-[11px] rounded-sm", getColorClass(level))}
                />
              ))}
              <span>많음</span>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    );
  }

  // Monthly view: simple row layout
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">활동 히트맵</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={100}>
          <div className="flex flex-wrap gap-1">
            {cells.map((cell) => (
              <Tooltip key={cell.date}>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className={cn(
                        "h-8 w-8 rounded-md transition-colors",
                        getColorClass(cell.count),
                        hoveredCell?.date === cell.date && "ring-1 ring-foreground"
                      )}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(cell.date).getDate()}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{formatDateKo(cell.date)}</p>
                  <p className="text-muted-foreground">
                    {cell.count > 0 ? `${cell.count}개 커밋` : "커밋 없음"}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-1.5 mt-3 text-xs text-muted-foreground">
            <span>적음</span>
            {[0, 1, 3, 6, 9].map((level) => (
              <div
                key={level}
                className={cn("h-[11px] w-[11px] rounded-sm", getColorClass(level))}
              />
            ))}
            <span>많음</span>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
