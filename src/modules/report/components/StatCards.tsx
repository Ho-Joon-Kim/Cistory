"use client";

import { ArrowDown, ArrowUp, Calendar, GitCommit, Map as MapIcon, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  CodingSectionData,
  CommitsSectionData,
  LocationSectionData,
  SparklineData,
} from "../types";

interface StatCardsProps {
  commits?: CommitsSectionData | null;
  coding?: CodingSectionData | null;
  location?: LocationSectionData | null;
  sparklines?: {
    commits?: SparklineData[];
    activeDays?: SparklineData[];
    codingTime?: SparklineData[];
    distance?: SparklineData[];
  };
  sameMonthLastYear?: {
    commits?: { totalCommits: number; activeDays: number };
    coding?: { totalCodingSeconds: number };
    distance?: { totalDistanceMeters: number };
  };
}

function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function formatKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function calcChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function MiniSparkline({ data }: { data: SparklineData[] }) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const width = 60;
  const height = 20;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      className="inline-block ml-2 opacity-60"
      role="img"
      aria-label="추이 그래프"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

interface StatItem {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  change: number | null;
  sparkline?: SparklineData[];
  yearOverYear?: number | null;
}

export function StatCards({
  commits,
  coding,
  location,
  sparklines,
  sameMonthLastYear,
}: StatCardsProps) {
  const yoyCommitChange =
    sameMonthLastYear?.commits && commits
      ? calcChange(commits.totalCommits, sameMonthLastYear.commits.totalCommits)
      : null;
  const yoyCodingChange =
    sameMonthLastYear?.coding && coding
      ? calcChange(coding.totalCodingSeconds, sameMonthLastYear.coding.totalCodingSeconds)
      : null;
  const yoyDistanceChange =
    sameMonthLastYear?.distance && location
      ? calcChange(location.totalDistanceMeters, sameMonthLastYear.distance.totalDistanceMeters)
      : null;
  const yoyActiveDaysChange =
    sameMonthLastYear?.commits && commits
      ? calcChange(commits.activeDays, sameMonthLastYear.commits.activeDays)
      : null;

  const stats: StatItem[] = [
    {
      icon: <GitCommit className="h-5 w-5 text-emerald-500" />,
      label: "총 커밋",
      value: commits ? commits.totalCommits.toLocaleString() : null,
      change: commits?.prevCommits
        ? calcChange(commits.totalCommits, commits.prevCommits.totalCommits)
        : null,
      sparkline: sparklines?.commits,
      yearOverYear: yoyCommitChange,
    },
    {
      icon: <Timer className="h-5 w-5 text-violet-500" />,
      label: "코딩 시간",
      value: coding ? formatHours(coding.totalCodingSeconds) : null,
      change:
        coding?.prevCodingSeconds !== undefined
          ? calcChange(coding.totalCodingSeconds, coding.prevCodingSeconds)
          : null,
      sparkline: sparklines?.codingTime,
      yearOverYear: yoyCodingChange,
    },
    {
      icon: <MapIcon className="h-5 w-5 text-blue-500" />,
      label: "총 이동 거리",
      value: location ? formatKm(location.totalDistanceMeters) : null,
      change:
        location?.prevDistanceMeters !== undefined
          ? calcChange(location.totalDistanceMeters, location.prevDistanceMeters)
          : null,
      sparkline: sparklines?.distance,
      yearOverYear: yoyDistanceChange,
    },
    {
      icon: <Calendar className="h-5 w-5 text-amber-500" />,
      label: "활동일",
      value: commits ? `${commits.activeDays}일` : null,
      change: commits?.prevCommits
        ? calcChange(commits.activeDays, commits.prevCommits.activeDays)
        : null,
      sparkline: sparklines?.activeDays,
      yearOverYear: yoyActiveDaysChange,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="!py-4 !gap-2">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              {stat.icon}
              {stat.value !== null && stat.change !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-medium",
                    stat.change >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  {stat.change >= 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {Math.abs(stat.change)}%
                </span>
              )}
            </div>
            <div>
              {stat.value !== null ? (
                <div className="flex items-end">
                  <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                  {stat.sparkline && <MiniSparkline data={stat.sparkline} />}
                </div>
              ) : (
                <Skeleton className="h-8 w-20" />
              )}
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              {stat.value !== null &&
                stat.yearOverYear !== null &&
                stat.yearOverYear !== undefined && (
                  <p
                    className={cn(
                      "text-xs mt-0.5",
                      stat.yearOverYear >= 0
                        ? "text-green-600/70 dark:text-green-400/70"
                        : "text-red-600/70 dark:text-red-400/70"
                    )}
                  >
                    전년 동월 {stat.yearOverYear >= 0 ? "+" : ""}
                    {stat.yearOverYear}%
                  </p>
                )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
