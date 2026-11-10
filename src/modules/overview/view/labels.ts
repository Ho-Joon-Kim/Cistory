import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatDateRange, formatMonthDay, formatTime } from "@/lib/format";
import type { HistoryPeriodType, OverviewHistoryPeriod, OverviewHistoryResponse } from "../history";
import { periodDateRange, shiftPeriodKey } from "../history";
import type { CodingAggregate, HealthAggregate, SpendingAggregate } from "../types";
import { cashByDay, commitsByDay, metricByDay } from "./series";

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

/** The viewed period's comparable totals over `ctx.from`–`ComparisonBase.through`. */
export interface SpanTotals {
  commits: number | null;
  activeDays: number | null;
  spending: number | null;
  income: number | null;
  /** Step total over the days with a step record, and how many such days. */
  steps: { total: number; days: number } | null;
}

/** What the viewed period's changes are measured against, and how to name it. */
export interface ComparisonBase {
  period: OverviewHistoryPeriod;
  /** "10월" for an ended period; "10월 같은 기간" while the viewed one is in progress. */
  label: string;
  /**
   * Last day of the viewed period's compared side: yesterday while it is in
   * progress (today is still being recorded), `ctx.to` once it has ended.
   */
  through: string;
  /** The viewed period's totals over that span — never today's partial day. */
  current: SpanTotals;
}

export interface ComparisonDomains {
  coding?: CodingAggregate | null;
  spending?: SpendingAggregate | null;
  health?: HealthAggregate | null;
}

/** The viewed period's totals; while in progress, only the days through `through`. */
function spanTotals(ctx: PeriodContext, through: string, d: ComparisonDomains): SpanTotals {
  const inSpan = (date: string) => date >= ctx.from && date <= through;
  const stepDays = [...metricByDay(d.health ?? null, "steps")].filter(([date]) => inSpan(date));
  const steps =
    stepDays.length > 0
      ? { total: stepDays.reduce((s, [, v]) => s + v, 0), days: stepDays.length }
      : null;
  if (!ctx.inProgress) {
    return {
      commits: d.coding ? d.coding.totalCommits : null,
      activeDays: d.coding ? d.coding.activeDays : null,
      spending: d.spending ? d.spending.spending : null,
      income: d.spending ? d.spending.income : null,
      steps,
    };
  }
  let commits = 0;
  let activeDays = 0;
  for (const [date, count] of commitsByDay(d.coding ?? null)) {
    if (!inSpan(date)) continue;
    commits += count;
    if (count > 0) activeDays += 1;
  }
  let spending = 0;
  let income = 0;
  for (const [date, cash] of cashByDay(d.spending ?? null)) {
    if (!inSpan(date)) continue;
    spending += cash.spending;
    income += cash.income;
  }
  return {
    commits: d.coding ? commits : null,
    activeDays: d.coding ? activeDays : null,
    spending: d.spending ? spending : null,
    income: d.spending ? income : null,
    steps,
  };
}

/**
 * An in-progress period is only ever compared with the same settled span of the
 * previous one — both sides through yesterday (today 11/10: 11/1–11/9 vs
 * 10/1–10/9). Comparing ten days with a whole month reports a drop that has not
 * happened, and today's few hours against a full day do the same in miniature.
 * No such span stored → no comparison.
 */
export function comparisonBase(
  ctx: PeriodContext,
  history: OverviewHistoryResponse | null,
  domains: ComparisonDomains = {}
): ComparisonBase | null {
  if (!history) return null;
  if (!ctx.inProgress) {
    return history.previous
      ? {
          period: history.previous,
          label: ctx.previousLabel,
          through: ctx.to,
          current: spanTotals(ctx, ctx.to, domains),
        }
      : null;
  }
  const cut = history.previousToDate ?? null;
  const through = shiftDateKey(ctx.today, -1);
  if (!cut || through < ctx.from) return null;
  return {
    period: cut,
    label: `${ctx.previousLabel} 같은 기간`,
    through,
    current: spanTotals(ctx, through, domains),
  };
}

/** Day span inside one period for a compact label: "1–10일", "10일", "10/27–11/2". */
export function daySpanLabel(from: string, to: string): string {
  const d = (key: string) => Number(key.slice(8, 10));
  const md = (key: string) => `${Number(key.slice(5, 7))}/${d(key)}`;
  if (from === to) return `${d(from)}일`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)}일`;
  return `${md(from)}–${md(to)}`;
}
