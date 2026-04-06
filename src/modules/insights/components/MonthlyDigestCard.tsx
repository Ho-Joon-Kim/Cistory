"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MonthlyDigestCardProps {
  data: {
    months: {
      month: number;
      totalCommits: number;
      topProject: string | null;
    }[];
  } | null;
  isLoading: boolean;
  year: number;
}

const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export function MonthlyDigestCard({ data, isLoading, year }: MonthlyDigestCardProps) {
  if (isLoading) {
    return (
      <Card className="col-span-1 lg:col-span-2">
        <CardHeader>
          <CardTitle>월별 요약</CardTitle>
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
      <Card className="col-span-1 lg:col-span-2">
        <CardHeader>
          <CardTitle>월별 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            데이터 없음
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader>
        <CardTitle>월별 요약</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.months.map((month) => {
            const hasData = month.totalCommits > 0;

            return (
              <div
                key={month.month}
                className={`p-3 rounded-lg border transition-colors ${
                  hasData
                    ? "bg-card hover:bg-muted/50 cursor-default"
                    : "bg-muted/20 opacity-60"
                }`}
              >
                <div className="text-sm font-medium mb-2">
                  {MONTH_NAMES[month.month - 1]}
                </div>

                {hasData ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">커밋</span>
                      <span className="text-sm font-semibold ml-auto">
                        {month.totalCommits}
                      </span>
                    </div>
                    {month.topProject && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">주요 프로젝트</span>
                        <span className="text-xs font-medium ml-auto truncate max-w-[80px]">
                          {month.topProject}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">활동 없음</div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
