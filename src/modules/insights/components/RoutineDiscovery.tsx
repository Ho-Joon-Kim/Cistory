"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RoutineDiscoveryProps {
  data: {
    dayPatterns: { day: number; commits: number }[];
  } | null;
  isLoading: boolean;
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function RoutineDiscovery({ data, isLoading }: RoutineDiscoveryProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>주간 리듬</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            불러오는 중...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>주간 리듬</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            데이터 없음
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCommits = Math.max(...data.dayPatterns.map((d) => d.commits), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>주간 리듬</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 h-40">
          {data.dayPatterns.map((pattern) => {
            const commitHeight = (pattern.commits / maxCommits) * 100;

            return (
              <div key={pattern.day} className="flex-1 flex flex-col items-center gap-1">
                {/* Bar */}
                <div className="w-full flex flex-col justify-end h-28">
                  <div
                    className="w-full rounded-t-sm bg-emerald-500 dark:bg-emerald-400 transition-all"
                    style={{ height: `${Math.max(commitHeight, 2)}%` }}
                  />
                </div>

                {/* Count */}
                <div className="text-[10px] text-muted-foreground font-medium">
                  {pattern.commits}
                </div>

                {/* Day label */}
                <div className="text-xs text-muted-foreground">{DAY_LABELS[pattern.day]}</div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-400" />
            <span>커밋</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
