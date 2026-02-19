"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { YearlyReportData } from "../types";

interface ProjectTimelineProps {
  projects: YearlyReportData["projectTimeline"];
  year: string;
}

const BAR_COLORS = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
];

const MONTH_LABELS = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

function dayOfYear(dateStr: string): number {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function ProjectTimeline({ projects, year }: ProjectTimelineProps) {
  const yearNum = Number.parseInt(year, 10);
  const isLeap =
    (yearNum % 4 === 0 && yearNum % 100 !== 0) || yearNum % 400 === 0;
  const totalDays = isLeap ? 366 : 365;

  const sorted = useMemo(() => {
    return [...projects].sort(
      (a, b) =>
        new Date(a.firstCommit).getTime() - new Date(b.firstCommit).getTime(),
    );
  }, [projects]);

  // Compute month boundaries as percentages (must be before early return)
  const monthBoundaries = useMemo(() => {
    const boundaries: number[] = [];
    const daysInMonths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let cumDays = 0;
    for (const d of daysInMonths) {
      boundaries.push((cumDays / totalDays) * 100);
      cumDays += d;
    }
    return boundaries;
  }, [totalDays, isLeap]);

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">프로젝트 타임라인</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            프로젝트 데이터가 없습니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">프로젝트 타임라인</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={100}>
          {/* Month axis */}
          <div className="relative h-6 mb-2 border-b">
            {MONTH_LABELS.map((label, i) => (
              <span
                key={label}
                className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
                style={{
                  left: `${monthBoundaries[i] + ((monthBoundaries[i + 1] ?? 100) - monthBoundaries[i]) / 2}%`,
                }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Project bars */}
          <div className="space-y-2">
            {sorted.map((project, index) => {
              const startDay = dayOfYear(project.firstCommit);
              const endDay = dayOfYear(project.lastCommit);
              const leftPct = (startDay / totalDays) * 100;
              const widthPct = Math.max(
                ((endDay - startDay + 1) / totalDays) * 100,
                0.5,
              );
              const colorClass = BAR_COLORS[index % BAR_COLORS.length];

              const startDate = new Date(project.firstCommit).toLocaleDateString(
                "ko-KR",
                { month: "short", day: "numeric" },
              );
              const endDate = new Date(project.lastCommit).toLocaleDateString(
                "ko-KR",
                { month: "short", day: "numeric" },
              );

              return (
                <div key={project.name} className="flex items-center gap-2">
                  {/* Project name */}
                  <div className="w-28 flex-shrink-0 truncate text-xs font-medium text-right pr-2">
                    {project.name}
                  </div>

                  {/* Bar area */}
                  <div className="flex-1 relative h-6">
                    {/* Month grid lines */}
                    {monthBoundaries.map((pct) => (
                      <div
                        key={`month-${pct}`}
                        className="absolute top-0 bottom-0 w-px bg-border/50"
                        style={{ left: `${pct}%` }}
                      />
                    ))}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "absolute top-0.5 h-5 rounded-sm transition-all",
                            colorClass,
                            "opacity-80 hover:opacity-100",
                          )}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            minWidth: "4px",
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <p className="font-medium">{project.name}</p>
                        <p className="text-muted-foreground">
                          {startDate} ~ {endDate}
                        </p>
                        <p className="text-muted-foreground">
                          {project.totalCommits}개 커밋
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Commit count */}
                  <div className="w-12 flex-shrink-0 text-xs text-muted-foreground text-right">
                    {project.totalCommits}
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
