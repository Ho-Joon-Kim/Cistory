"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, AlertTriangle } from "lucide-react";

interface ResidencyData {
  countryName: string;
  days: number;
  percentage: number;
  periods: { startDate: string; endDate: string; days: number }[];
  taxWarning: boolean;
}

interface ResidencyCardsProps {
  residency: ResidencyData[];
  totalTrackedDays: number;
}

function formatPeriod(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return `${sm}/${sd} ~ ${em}/${ed}`;
}

export function ResidencyCards({ residency, totalTrackedDays }: ResidencyCardsProps) {
  if (residency.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Globe className="h-4 w-4" />
          국가별 체류일
        </h3>
        <span className="text-xs text-muted-foreground">
          추적된 일수: {totalTrackedDays}일
        </span>
      </div>

      <div className="space-y-3">
        {residency.map((r) => {
          const barColor = r.taxWarning
            ? "bg-red-500"
            : r.days >= 90
              ? "bg-amber-500"
              : "bg-green-500";

          return (
            <Card key={r.countryName} className="!py-3 !gap-2">
              <CardContent className="!pt-0 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{r.countryName}</span>
                    {r.taxWarning && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        <AlertTriangle className="h-3 w-3" />
                        183일 초과
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium">
                    {r.days}일 ({r.percentage}%)
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(r.percentage, 100)}%` }}
                  />
                </div>

                {/* Periods */}
                {r.periods.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.periods.map((p) => (
                      <span
                        key={`${p.startDate}-${p.endDate}`}
                        className="text-xs text-muted-foreground"
                      >
                        {formatPeriod(p.startDate, p.endDate)} ({p.days}일)
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
