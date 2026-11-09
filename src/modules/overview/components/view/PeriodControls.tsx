"use client";

import { Segmented } from "@/components/ds";
import { toKstCalendarDate } from "@/lib/date-key";
import { cn } from "@/lib/utils";
import type { HistoryPeriodType } from "@/modules/overview/history";
import { periodDateRange, shiftPeriodKey } from "@/modules/overview/history";
import { adjacentOverviewPeriod, currentOverviewPeriodKey } from "@/modules/overview/hooks";
import { getPeriodKey } from "@/modules/overview/period";

/**
 * Mirrors OVERVIEW_RETENTION_PERIODS in ../../service.ts (server-only module):
 * how far back the API accepts a period. Kept here so the stepper never offers a
 * period the server would reject.
 */
const RETENTION: Record<HistoryPeriodType, number> = { week: 104, month: 60, year: 10 };

const PERIODS: { value: HistoryPeriodType; label: string; ariaLabel: string }[] = [
  { value: "week", label: "주", ariaLabel: "주 단위" },
  { value: "month", label: "월", ariaLabel: "월 단위" },
  { value: "year", label: "년", ariaLabel: "년 단위" },
];

/**
 * The period of `type` that holds the last day of the one on screen (or today,
 * while it's in progress): 주 from 2026-10 lands on October's last week, not on
 * the current one.
 */
export function switchPeriodType(
  from: { periodType: HistoryPeriodType; periodKey: string },
  type: HistoryPeriodType,
  now: Date
): string {
  const current = currentOverviewPeriodKey(type, now);
  const { to } = periodDateRange(from.periodType, from.periodKey);
  const today = toKstCalendarDate(now);
  const anchor = to < today ? to : today;
  const [y, m, d] = anchor.split("-").map(Number);
  const key = getPeriodKey(type, new Date(y, m - 1, d, 12));
  const oldest = shiftPeriodKey(type, current, -(RETENTION[type] - 1));
  return key > current ? current : key < oldest ? oldest : key;
}

const UNIT: Record<HistoryPeriodType, string> = { week: "주", month: "달", year: "해" };

function StepButton({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: -1 | 1;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-grid size-11 shrink-0 cursor-pointer place-items-center rounded-[9px] border-0 bg-transparent text-ink-2 transition-[scale,background-color,color] duration-150 ease-out not-disabled:hover:bg-track not-disabled:hover:text-ink not-disabled:active:scale-96 disabled:cursor-default disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-brand sm:size-9"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction < 0 ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

export function PeriodControls({
  periodType,
  periodKey,
  onChange,
  now,
}: {
  periodType: HistoryPeriodType;
  periodKey: string;
  onChange: (next: { periodType: HistoryPeriodType; periodKey: string }) => void;
  now: Date;
}) {
  const current = currentOverviewPeriodKey(periodType, now);
  const oldest = shiftPeriodKey(periodType, current, -(RETENTION[periodType] - 1));
  const prev = adjacentOverviewPeriod(periodType, periodKey, -1, now);
  const next = adjacentOverviewPeriod(periodType, periodKey, 1, now);
  const prevDisabled = prev.periodKey < oldest;
  const unit = UNIT[periodType];
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <span className="contents sm:hidden">
        <StepButton
          direction={-1}
          disabled={prevDisabled}
          label={`이전 ${unit}`}
          onClick={() => onChange({ periodType, periodKey: prev.periodKey })}
        />
      </span>
      <Segmented
        items={PERIODS}
        value={periodType}
        ariaLabel="기간 단위"
        onChange={(type) =>
          onChange({
            periodType: type,
            periodKey: switchPeriodType({ periodType, periodKey }, type, now),
          })
        }
        className="flex-1 sm:w-[174px] sm:flex-none"
      />
      <div className={cn("flex gap-0.5")}>
        <span className="hidden sm:contents">
          <StepButton
            direction={-1}
            disabled={prevDisabled}
            label={`이전 ${unit}`}
            onClick={() => onChange({ periodType, periodKey: prev.periodKey })}
          />
        </span>
        <StepButton
          direction={1}
          disabled={next.isFuture}
          label={`다음 ${unit}`}
          onClick={() => onChange({ periodType, periodKey: next.periodKey })}
        />
      </div>
    </div>
  );
}
