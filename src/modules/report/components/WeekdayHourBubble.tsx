"use client";

import { Fragment, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface WeekdayHourBubbleProps {
  commitsByDayOfWeek: number[];
  commitsByHour: number[];
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function WeekdayHourBubble({ commitsByDayOfWeek, commitsByHour }: WeekdayHourBubbleProps) {
  const { matrix, maxWeight } = useMemo(() => {
    const maxDay = Math.max(...commitsByDayOfWeek, 1);
    const maxHour = Math.max(...commitsByHour, 1);

    const grid: number[][] = [];
    let peak = 0;

    for (let day = 0; day < 7; day++) {
      const row: number[] = [];
      for (let hour = 0; hour < 24; hour++) {
        const weight = (commitsByDayOfWeek[day] / maxDay) * (commitsByHour[hour] / maxHour);
        row.push(weight);
        if (weight > peak) peak = weight;
      }
      grid.push(row);
    }

    return { matrix: grid, maxWeight: peak };
  }, [commitsByDayOfWeek, commitsByHour]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">요일 x 시간대 분포</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={100}>
          <div className="overflow-x-auto">
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `auto repeat(24, 1fr)`,
                gridTemplateRows: `auto repeat(7, 1fr)`,
              }}
            >
              {/* Top-left empty cell */}
              <div />

              {/* Hour labels */}
              {Array.from({ length: 24 }, (_, h) => (
                <div key={`h-${h}`} className="text-[10px] text-muted-foreground text-center">
                  {h % 3 === 0 ? `${h}` : ""}
                </div>
              ))}

              {/* Rows */}
              {DAY_LABELS.map((dayLabel, dayIdx) => (
                <Fragment key={`row-${dayIdx}`}>
                  {/* Day label */}
                  <div className="text-[10px] text-muted-foreground pr-1.5 flex items-center justify-end">
                    {dayLabel}
                  </div>

                  {/* Bubble cells */}
                  {Array.from({ length: 24 }, (_, hourIdx) => {
                    const weight = matrix[dayIdx][hourIdx];
                    const normalizedSize = maxWeight > 0 ? weight / maxWeight : 0;
                    const size = Math.max(normalizedSize * 100, 0);
                    const opacity = Math.max(normalizedSize * 0.9 + 0.1, 0.1);

                    return (
                      <Tooltip key={`${dayIdx}-${hourIdx}`}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-center h-6 w-full min-w-[14px]">
                            {size > 0 && (
                              <div
                                className={cn("rounded-full bg-emerald-500 transition-all")}
                                style={{
                                  width: `${Math.max(size * 0.8, 4)}%`,
                                  height: `${Math.max(size * 0.8, 4)}%`,
                                  minWidth: size > 5 ? "4px" : "2px",
                                  minHeight: size > 5 ? "4px" : "2px",
                                  maxWidth: "20px",
                                  maxHeight: "20px",
                                  opacity,
                                }}
                              />
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p>
                            {dayLabel}요일 {hourIdx}시
                          </p>
                          <p className="text-muted-foreground">
                            활동 강도: {Math.round(weight * 100)}%
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
