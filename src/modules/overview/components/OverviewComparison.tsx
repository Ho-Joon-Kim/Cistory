"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildOverviewComparison, type OverviewComparisonMetric } from "../comparison";
import { useStoredOverviewComparison } from "../comparison-hooks";
import { ComputingState } from "./ComputingState";

interface OverviewComparisonProps {
  year1: string;
  year2: string;
  enabled: boolean;
  onYearsChange: (year1: string, year2: string) => void;
}

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function formatMetric(value: number, format: OverviewComparisonMetric["format"]) {
  if (format === "duration") return `${number.format(value / 3600)}시간`;
  if (format === "distance") return `${number.format(value / 1000)}km`;
  if (format === "currency") return currency.format(value);
  if (format === "percent") return `${number.format(value * 100)}%`;
  return number.format(value);
}

function YearControl({
  year,
  label,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
}: {
  year: string;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${label} 이전 연도`}
        disabled={previousDisabled}
        onClick={onPrevious}
      >
        <ChevronLeft />
      </Button>
      <span className="w-16 text-center text-lg font-semibold">{year}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${label} 다음 연도`}
        disabled={nextDisabled}
        onClick={onNext}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

export function OverviewComparison({
  year1,
  year2,
  enabled,
  onYearsChange,
}: OverviewComparisonProps) {
  const { snapshots, error, isLoading } = useStoredOverviewComparison(year1, year2, enabled);
  const currentYear = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date())
  );

  let content: ReactNode;
  if (error) {
    content = <ComputingState status="failed" error={error} />;
  } else if (isLoading || !snapshots) {
    content = <ComputingState status="loading" />;
  } else if (snapshots[0].status === "missing" || snapshots[1].status === "missing") {
    content = (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          비교할 사전 계산 연간 스냅샷이 없습니다.
        </CardContent>
      </Card>
    );
  } else if (!("domains" in snapshots[0]) || !("domains" in snapshots[1])) {
    const computing = snapshots[0].status === "computing" || snapshots[1].status === "computing";
    content = <ComputingState status={computing ? "computing" : "pending"} />;
  } else {
    const comparison = buildOverviewComparison(snapshots[0], snapshots[1]);
    content =
      comparison.metrics.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            두 연도에 공통으로 계산된 비교 지표가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {comparison.metrics.map((metric) => (
            <Card key={metric.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{metric.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{year1}</span>
                  <span className="font-semibold">{formatMetric(metric.first, metric.format)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{year2}</span>
                  <span className="font-semibold">
                    {formatMetric(metric.second, metric.format)}
                  </span>
                </div>
                <p className="border-t pt-2 text-right text-xs text-muted-foreground">
                  변화 {metric.delta > 0 ? "+" : ""}
                  {formatMetric(metric.delta, metric.format)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      );
  }

  return (
    <section className="space-y-5" aria-labelledby="comparison-title">
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6">
        <YearControl
          year={year1}
          label="첫 번째"
          onPrevious={() => onYearsChange(String(Number(year1) - 1), year2)}
          onNext={() => onYearsChange(String(Number(year1) + 1), year2)}
          nextDisabled={Number(year1) + 1 >= Number(year2)}
        />
        <span className="font-medium text-muted-foreground">vs</span>
        <YearControl
          year={year2}
          label="두 번째"
          onPrevious={() => onYearsChange(year1, String(Number(year2) - 1))}
          onNext={() => onYearsChange(year1, String(Number(year2) + 1))}
          previousDisabled={Number(year2) - 1 <= Number(year1)}
          nextDisabled={Number(year2) >= currentYear}
        />
      </div>

      <h2 id="comparison-title" className="sr-only">
        {year1}년과 {year2}년 비교
      </h2>
      {content}
    </section>
  );
}
