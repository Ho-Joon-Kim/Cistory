import { Code2, GitCommitHorizontal, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TravelTripDetail } from "../hooks";

type TripRoutine = TravelTripDetail["routine"];

export function formatSeconds(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간`;
  if (minutes > 0) return `${minutes}분`;
  return `${safeSeconds}초`;
}

function Comparison({ percent, previous }: { percent: number | null; previous: ReactNode }) {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(Math.abs(percent));
  const direction = percent > 0 ? "증가" : percent < 0 ? "감소" : "변동 없음";
  const Icon = percent > 0 ? TrendingUp : percent < 0 ? TrendingDown : Minus;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        직전 동일 기간보다 {rounded}% {direction}
      </span>
      <span className="ml-1">(이전 {previous})</span>
    </p>
  );
}

export function TripRoutineCard({ routine }: { routine: TripRoutine }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="h-4 w-4" aria-hidden="true" />
          일상 변화
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              코딩 시간
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatSeconds(routine.codingSeconds)}
            </p>
            {routine.comparison ? (
              <Comparison
                percent={routine.comparison.codingPercentChange}
                previous={formatSeconds(routine.comparison.codingSeconds)}
              />
            ) : null}
          </div>
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              커밋
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {Math.max(0, Math.round(routine.commitCount)).toLocaleString("ko-KR")}개
            </p>
            {routine.comparison ? (
              <Comparison
                percent={routine.comparison.commitPercentChange}
                previous={`${Math.max(0, Math.round(routine.comparison.commitCount)).toLocaleString(
                  "ko-KR"
                )}개`}
              />
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
