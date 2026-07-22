"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  adjacentOverviewPeriod,
  currentOverviewPeriodKey,
  type OverviewPeriodSelection,
  overviewPeriodLabel,
} from "../hooks";
import type { PeriodType } from "../period";

const periodLabels: Record<PeriodType, string> = {
  recent: "최근 14일",
  week: "주간",
  month: "월간",
  year: "연간",
};

interface PeriodSwitcherProps extends OverviewPeriodSelection {
  onChange: (selection: OverviewPeriodSelection) => void;
  now?: Date;
}

export function PeriodSwitcher({
  periodType,
  periodKey,
  onChange,
  now = new Date(),
}: PeriodSwitcherProps) {
  const previous = adjacentOverviewPeriod(periodType, periodKey, -1, now);
  const next = adjacentOverviewPeriod(periodType, periodKey, 1, now);

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">대시보드 기간 선택</legend>
      <div
        role="tablist"
        aria-label="기간 유형"
        className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
      >
        {(Object.keys(periodLabels) as PeriodType[]).map((type) => (
          <Button
            key={type}
            role="tab"
            aria-selected={type === periodType}
            variant={type === periodType ? "secondary" : "ghost"}
            size="sm"
            onClick={() =>
              onChange({ periodType: type, periodKey: currentOverviewPeriodKey(type, now) })
            }
          >
            {periodLabels[type]}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="이전 기간"
          onClick={() => onChange(previous)}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <p className="min-w-0 text-center text-sm font-medium tabular-nums">
          {overviewPeriodLabel(periodType, periodKey)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="다음 기간"
          disabled={next.isFuture}
          onClick={() => onChange(next)}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </fieldset>
  );
}
