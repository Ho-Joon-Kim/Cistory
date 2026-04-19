"use client";

import { ArrowDown, ArrowUp, GitCommit, Map, Minus, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { YearComparisonData } from "../comparison-service";

interface YearComparisonDashboardProps {
  data: YearComparisonData;
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h === 0) return `${Math.floor(seconds / 60)}분`;
  return `${h}시간`;
}

function formatKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(0)}km`;
}

function DeltaBadge({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        변동 없음
      </span>
    );
  }

  const isPositive = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isPositive ? "text-green-600" : "text-red-500"
      }`}
    >
      {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {isPositive ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

interface CompareCardProps {
  label: string;
  icon: React.ReactNode;
  value1: string;
  value2: string;
  growthPercent: number;
  year1: string;
  year2: string;
}

function CompareCard({
  label,
  icon,
  value1,
  value2,
  growthPercent,
  year1,
  year2,
}: CompareCardProps) {
  return (
    <Card className="!py-4 !gap-2">
      <CardContent className="!pt-0">
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <span className="text-sm font-medium">{label}</span>
          <DeltaBadge value={growthPercent} suffix="%" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{year1}</p>
            <p className="text-lg font-semibold">{value1}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{year2}</p>
            <p className="text-lg font-semibold">{value2}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function YearComparisonDashboard({ data }: YearComparisonDashboardProps) {
  const { year1, year2, metrics, deltas } = data;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">
        {year1} vs {year2} 비교
      </h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CompareCard
          label="커밋"
          icon={<GitCommit className="h-4 w-4 text-emerald-500" />}
          value1={metrics.year1.totalCommits.toLocaleString()}
          value2={metrics.year2.totalCommits.toLocaleString()}
          growthPercent={deltas.commits.growthPercent}
          year1={year1}
          year2={year2}
        />
        <CompareCard
          label="활동일"
          icon={<GitCommit className="h-4 w-4 text-blue-500" />}
          value1={`${metrics.year1.activeDays}일`}
          value2={`${metrics.year2.activeDays}일`}
          growthPercent={deltas.activeDays.growthPercent}
          year1={year1}
          year2={year2}
        />
        <CompareCard
          label="코딩 시간"
          icon={<Timer className="h-4 w-4 text-purple-500" />}
          value1={formatHours(metrics.year1.totalCodingSeconds)}
          value2={formatHours(metrics.year2.totalCodingSeconds)}
          growthPercent={deltas.codingSeconds.growthPercent}
          year1={year1}
          year2={year2}
        />
        <CompareCard
          label="이동 거리"
          icon={<Map className="h-4 w-4 text-orange-500" />}
          value1={formatKm(metrics.year1.totalDistanceMeters)}
          value2={formatKm(metrics.year2.totalDistanceMeters)}
          growthPercent={deltas.distanceMeters.growthPercent}
          year1={year1}
          year2={year2}
        />
      </div>
    </div>
  );
}
