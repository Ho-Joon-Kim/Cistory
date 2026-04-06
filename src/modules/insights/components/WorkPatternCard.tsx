"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WorkPatternCardProps {
  data: {
    avgFirstCommitHour: number;
    avgLastCommitHour: number;
    mostProductiveHour: number;
    mostProductiveDay: number;
    nightRatio: number;
    weekendRatio: number;
    totalCommits: number;
  } | null;
  isLoading: boolean;
}

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function WorkPatternCard({ data, isLoading }: WorkPatternCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>작업 패턴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            불러오는 중...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalCommits === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>작업 패턴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            커밋 데이터 없음
          </div>
        </CardContent>
      </Card>
    );
  }

  const isNightOwl = data.avgFirstCommitHour >= 12;
  const typeLabel = isNightOwl ? "올빼미형 🦉" : "아침형 🌅";
  const typeDescription = isNightOwl
    ? "주로 오후~밤에 활동합니다"
    : "주로 오전에 활동합니다";

  return (
    <Card>
      <CardHeader>
        <CardTitle>작업 패턴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Developer type */}
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <div className="text-xl font-bold">{typeLabel}</div>
          <div className="text-xs text-muted-foreground mt-1">{typeDescription}</div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">평균 첫 커밋</div>
            <div className="text-lg font-semibold">{formatHour(data.avgFirstCommitHour)}</div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">평균 마지막 커밋</div>
            <div className="text-lg font-semibold">{formatHour(data.avgLastCommitHour)}</div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">최고 생산성 시간</div>
            <div className="text-lg font-semibold">{data.mostProductiveHour}시</div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">최고 생산성 요일</div>
            <div className="text-lg font-semibold">{DAY_NAMES[data.mostProductiveDay]}</div>
          </div>
        </div>

        {/* Ratios */}
        <div className="flex gap-3">
          <div className="flex-1 text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">야간 커밋</div>
            <div className="text-sm font-medium">{Math.round(data.nightRatio * 100)}%</div>
          </div>
          <div className="flex-1 text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">주말 커밋</div>
            <div className="text-sm font-medium">{Math.round(data.weekendRatio * 100)}%</div>
          </div>
          <div className="flex-1 text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">총 커밋</div>
            <div className="text-sm font-medium">{data.totalCommits.toLocaleString()}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
