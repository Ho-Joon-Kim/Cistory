"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MonthlyDigestsResult } from "../service";

interface MonthlyDigestCardProps {
  data: MonthlyDigestsResult | null;
  isLoading: boolean;
  year: number;
}

const MONTH_NAMES = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

function formatCodingTime(seconds: number): string {
  if (seconds <= 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return `${mins}분`;
}

export function MonthlyDigestCard({ data, isLoading, year }: MonthlyDigestCardProps) {
  const router = useRouter();

  const handleMonthClick = (month: number) => {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    router.push(`/report?period=monthly&yearMonth=${yearMonth}`);
  };

  if (isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>월별 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>월별 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>월별 요약</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {data.months.map((m) => {
            const hasData = m.totalCommits > 0 || m.totalCodingSeconds > 0;

            return (
              <button
                key={m.month}
                type="button"
                onClick={() => handleMonthClick(m.month)}
                className={`text-left p-3 rounded-lg border transition-colors hover:bg-muted/50 ${
                  hasData ? "cursor-pointer" : "opacity-50 cursor-default"
                }`}
                disabled={!hasData}
              >
                <div className="text-sm font-semibold mb-2">
                  {MONTH_NAMES[m.month - 1]}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>
                    커밋 <span className="font-medium text-foreground">{m.totalCommits}</span>
                  </div>
                  <div>
                    코딩{" "}
                    <span className="font-medium text-foreground">
                      {formatCodingTime(m.totalCodingSeconds)}
                    </span>
                  </div>
                  {m.topProject && (
                    <div className="truncate" title={m.topProject}>
                      <span className="font-medium text-foreground">{m.topProject}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
