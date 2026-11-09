import { shiftDateKey } from "@/lib/date-key";
import type { Fact, FactUnit } from "@/lib/facts";
import { formatCount, formatShare } from "@/lib/format";
import type { CodingAggregate, HealthAggregate, SpendingAggregate } from "../types";
import type { PeriodContext } from "./labels";

/** Every KST date key of the period, in order. */
export function periodDays(ctx: PeriodContext): string[] {
  const days: string[] = [];
  for (let d = ctx.from; d <= ctx.to; d = shiftDateKey(d, 1)) days.push(d);
  return days;
}

export function commitsByDay(coding: CodingAggregate | null): Map<string, number> {
  return new Map((coding?.dailyCommits ?? []).map((d) => [d.date, Number(d.count) || 0]));
}

export function cashByDay(spending: SpendingAggregate | null) {
  return new Map(
    (spending?.daily ?? []).map((d) => [
      d.date,
      { spending: Number(d.spending) || 0, income: Number(d.income) || 0 },
    ])
  );
}

export function metricByDay(health: HealthAggregate | null, metric: string): Map<string, number> {
  const days = health?.metrics.find((m) => m.metric === metric)?.days ?? [];
  const map = new Map<string, number>();
  for (const day of days) {
    if (day.value != null && Number.isFinite(Number(day.value)))
      map.set(day.date, Number(day.value));
  }
  return map;
}

/** Steps per recorded day (days without a step record are not zeros). */
export function stepsAverage(health: HealthAggregate | null): number | null {
  const values = [...metricByDay(health, "steps").values()];
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function ratioWord(ratio: number, up = "많음", down = "적음") {
  return ratio >= 0 ? up : down;
}

/** "6% 많음" / "같음" for a relative change. */
export function changePhrase(ratio: number, up = "많음", down = "적음"): string {
  const pct = Math.round(Math.abs(ratio) * 100);
  if (pct === 0) return "비슷함";
  return `${pct}% ${ratioWord(ratio, up, down)}`;
}

export const kg = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}kg`;

/**
 * A code-authored fact with its own sentence. Every number in the sentence goes
 * through `detail` placeholders (validateTemplate rejects literal digits), and the
 * single `{fact}` is the dotted trigger.
 */
export function sentenceFact(input: {
  id: string;
  metric: string;
  metricLabel: string;
  ctx: PeriodContext;
  value: number;
  unit?: FactUnit;
  unitLabel?: string;
  score: number;
  template: string;
  trigger: string;
  detail?: Record<string, string | number | boolean>;
  rows: { label: string; value: string }[];
  evidence?: Fact["evidence"];
}): Fact {
  return {
    id: input.id,
    kind: "diagnosis",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: { from: input.ctx.from, to: input.ctx.to, label: input.ctx.label },
    value: input.value,
    unit: input.unit ?? "count",
    unitLabel: input.unitLabel,
    score: input.score,
    evidence: input.evidence,
    template: input.template,
    detail: { ...stringify(input.detail ?? {}), trigger: input.trigger },
    // diagnosis facts render only `rows`, so the popover is exactly what we pass.
    rows: input.rows,
  };
}

function stringify(detail: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, String(v)]));
}

export const pct = (ratio: number) => formatShare(ratio);
export const count = (n: number) => formatCount(n);
