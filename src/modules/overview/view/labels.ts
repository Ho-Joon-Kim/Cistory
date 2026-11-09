import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatDateRange, formatMonthDay, formatTime } from "@/lib/format";
import type { HistoryPeriodType, OverviewHistoryPeriod } from "../history";
import { periodDateRange, shiftPeriodKey } from "../history";

/** Everything the page needs to talk about the viewed period in Korean. */
export interface PeriodContext {
  periodType: HistoryPeriodType;
  periodKey: string;
  /** Inclusive KST date keys of the whole period. */
  from: string;
  to: string;
  /** Last day with data: `to`, or today while the period is in progress. */
  through: string;
  inProgress: boolean;
  /** Days elapsed (whole period once it has ended). */
  elapsedDays: number;
  today: string;
  now: Date;
  /** "10월", "이번 주", "45주차", "2026년" — subject label in sentences. */
  label: string;
  /** "9월", "지난주", "2025년". */
  previousLabel: string;
  /** "달" / "주" / "해" — the noun closing a headline. */
  unitNoun: string;
  /** "월말" / "주말" / "연말" — end of the period, for "…까지". */
  endWord: string;
}

function weekNumber(periodKey: string) {
  return Number(periodKey.slice(6));
}

function monthLabel(periodKey: string) {
  return `${Number(periodKey.slice(5, 7))}월`;
}

function dayCount(from: string, to: string) {
  let n = 0;
  for (let d = from; d <= to; d = shiftDateKey(d, 1)) n++;
  return n;
}

export function periodContext(
  periodType: HistoryPeriodType,
  periodKey: string,
  today: string,
  now: Date
): PeriodContext {
  const { from, to } = periodDateRange(periodType, periodKey);
  const inProgress = today >= from && today <= to;
  const through = inProgress ? today : to;
  const previousKey = shiftPeriodKey(periodType, periodKey, -1);
  const currentWeek = inProgress && periodType === "week";
  let label: string;
  let previousLabel: string;
  if (periodType === "month") {
    label = monthLabel(periodKey);
    previousLabel = monthLabel(previousKey);
    if (previousKey.slice(0, 4) !== periodKey.slice(0, 4)) {
      previousLabel = `${previousKey.slice(0, 4)}년 ${previousLabel}`;
    }
  } else if (periodType === "week") {
    label = currentWeek ? "이번 주" : `${weekNumber(periodKey)}주차`;
    previousLabel = currentWeek ? "지난주" : `${weekNumber(previousKey)}주차`;
  } else {
    label = inProgress ? "올해" : `${periodKey}년`;
    previousLabel = inProgress ? "작년" : `${previousKey}년`;
  }
  return {
    periodType,
    periodKey,
    from,
    to,
    through,
    inProgress,
    elapsedDays: dayCount(from, through),
    today,
    now,
    label,
    previousLabel,
    unitNoun: periodType === "month" ? "달" : periodType === "week" ? "주" : "해",
    endWord: periodType === "month" ? "월말" : periodType === "week" ? "주말" : "연말",
  };
}

/** Page title: "2026년 10월", "2026년 45주차", "2026년". */
export function periodTitle(ctx: PeriodContext): string {
  const year = ctx.periodKey.slice(0, 4);
  if (ctx.periodType === "month") return `${year}년 ${monthLabel(ctx.periodKey)}`;
  if (ctx.periodType === "week") return `${year}년 ${weekNumber(ctx.periodKey)}주차`;
  return `${year}년`;
}

/** "10월 1일–31일 · 11월 1일 00:00 집계" / "1월 1일–11월 10일 · 진행 중 · 09:12 집계". */
export function periodMeta(ctx: PeriodContext, computedAt: string | null): string {
  const parts = [formatDateRange(ctx.from, ctx.through, { now: ctx.now })];
  if (ctx.inProgress) parts.push("진행 중");
  if (computedAt) {
    const at = new Date(computedAt);
    if (!Number.isNaN(at.getTime())) {
      parts.push(`${formatMonthDay(at, { now: ctx.now })} ${formatTime(at)} 집계`);
    }
  }
  return parts.join(" · ");
}

/** Short bar label for a history period: "10" (month), "11/2" (week). */
export function seriesBarLabel(period: OverviewHistoryPeriod): string {
  if (period.periodType === "month") return String(Number(period.periodKey.slice(5, 7)));
  if (period.periodType === "week") {
    return `${Number(period.from.slice(5, 7))}/${Number(period.from.slice(8, 10))}`;
  }
  return period.periodKey;
}

/** Tooltip title for a history period: "10월", "11월 2일 주", "2025년". */
export function seriesTitle(period: OverviewHistoryPeriod, now: Date): string {
  if (period.periodType === "month") {
    const y = period.periodKey.slice(0, 4);
    const thisYear = toKstCalendarDate(now).slice(0, 4);
    return `${y === thisYear ? "" : `${y}년 `}${monthLabel(period.periodKey)}`;
  }
  if (period.periodType === "week") return `${formatMonthDay(period.from, { now })} 주`;
  return `${period.periodKey}년`;
}
