"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkPatternsResult } from "../service";

interface WorkPatternCardProps {
  data: WorkPatternsResult | null;
  isLoading: boolean;
}

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function formatHour(hour: number | null): string {
  if (hour === null) return "-";
  const h = hour % 24;
  if (h === 0) return "오전 12시";
  if (h < 12) return `오전 ${h}시`;
  if (h === 12) return "오후 12시";
  return `오후 ${h - 12}시`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function WorkPatternCard({ data, isLoading }: WorkPatternCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>작업 패턴</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>작업 패턴</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </CardContent>
      </Card>
    );
  }

  const isNightOwl = data.nightRatio > 0.3;
  const personality = isNightOwl ? "올빼미형" : "아침형";
  const personalityEmoji = isNightOwl ? "\u{1F989}" : "\u{1F305}";

  // Hour distribution bar chart
  const maxHourCount = Math.max(...data.hourDistribution, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>작업 패턴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Personality badge */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
          <span className="text-xl">{personalityEmoji}</span>
          <span className="text-sm font-medium">{personality} 개발자</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">평균 첫 커밋</div>
            <div className="font-medium">{formatHour(data.avgFirstCommitHour)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">평균 마지막 커밋</div>
            <div className="font-medium">{formatHour(data.avgLastCommitHour)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">가장 활발한 시간</div>
            <div className="font-medium">{formatHour(data.mostProductiveHour)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">가장 활발한 요일</div>
            <div className="font-medium">
              {data.mostProductiveDay !== null ? DAY_NAMES[data.mostProductiveDay] : "-"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">야간 커밋 비율</div>
            <div className="font-medium">{formatPercent(data.nightRatio)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">주말 커밋 비율</div>
            <div className="font-medium">{formatPercent(data.weekendRatio)}</div>
          </div>
        </div>

        {/* Hour distribution */}
        <div>
          <div className="text-xs text-muted-foreground mb-2">시간대별 커밋 분포</div>
          <div className="flex items-end gap-[2px] h-16">
            {data.hourDistribution.map((count, hour) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 24-element hour array; hour is the stable id
                key={hour}
                className="flex-1 bg-emerald-500 dark:bg-emerald-400 rounded-t-sm min-h-[1px] transition-all"
                style={{ height: `${(count / maxHourCount) * 100}%` }}
                title={`${hour}시: ${count}개`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0시</span>
            <span>6시</span>
            <span>12시</span>
            <span>18시</span>
            <span>23시</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
