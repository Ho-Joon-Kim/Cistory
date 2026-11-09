/**
 * The one AI line for a day (template-first, see src/lib/facts). Candidates are
 * computed from the day model; the most notable one above the bar wins, and a
 * day with nothing notable gets no line at all.
 */
import { deltaVsPrevious, type Fact, type FactRow, pickOne, recordLowHigh } from "@/lib/facts";
import { formatCount, formatDurationMinutes, formatMonthDay } from "@/lib/format";
import type { HealthSleepSession } from "@/modules/health/types";
import { asleepMinutes, type DayModel, dedupeNights } from "./day-model";

export interface DayFact {
  fact: Fact;
  rows: FactRow[];
}

export interface DayFactInput {
  date: string;
  model: DayModel;
  /** Recent main nights incl. this day's (newest first is fine). */
  recentSleeps: HealthSleepSession[];
  /** Commit counts for the 7 days before `date` (missing days count as 0). */
  priorCommitCounts: number[] | null;
  /** The day isn't over yet — partial totals can't be "low". */
  isToday: boolean;
}

/** A stay this long (minutes) is worth a sentence on its own. */
const LONG_STAY_MIN = 10 * 60;

function period(date: string) {
  return { from: date, to: date, label: formatMonthDay(date) };
}

function sleepFact(input: DayFactInput): DayFact | null {
  const sleep = input.model.sleep;
  if (!sleep) return null;
  const nights = dedupeNights(input.recentSleeps);
  if (nights.length < 5) return null;
  const series = nights
    .map((n) => ({ key: n.start, value: asleepMinutes(n) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const target = series.find((p) => p.value === sleep.asleepMin);
  if (!target) return null;
  const scopeLabel = `최근 ${nights.length}밤`;
  const avg = series.reduce((s, p) => s + p.value, 0) / series.length;
  for (const direction of ["low", "high"] as const) {
    const fact = recordLowHigh({
      id: `day.sleep.${direction}`,
      metric: "sleep",
      metricLabel: "수면",
      period: period(input.date),
      unit: "minutes",
      series,
      direction,
      targetKey: target.key,
      scopeLabel,
      minHistory: 5,
    });
    if (!fact) continue;
    return {
      fact: {
        ...fact,
        evidence: { kind: "keys", keys: ["sleep"] },
        template:
          direction === "low"
            ? "{scopeLabel} 중 가장 짧은 {fact}을 잤어요."
            : "{scopeLabel} 중 가장 긴 {fact}을 잤어요.",
        detail: { ...fact.detail, trigger: formatDurationMinutes(sleep.asleepMin) },
      },
      rows: [
        { label: "수면", value: `${sleep.range} · ${sleep.asleep}` },
        { label: `${scopeLabel} 평균`, value: formatDurationMinutes(avg) },
        {
          label: direction === "low" ? "그다음 최저" : "그다음 최고",
          value: formatDurationMinutes(fact.baseline?.value ?? 0),
        },
      ],
    };
  }
  return null;
}

function commitFact(input: DayFactInput): DayFact | null {
  const prior = input.priorCommitCounts;
  const count = input.model.commitCount;
  if (!prior || prior.length === 0 || count === 0) return null;
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const fact = deltaVsPrevious({
    id: "day.commits.delta",
    metric: "commits",
    metricLabel: "커밋",
    period: period(input.date),
    unit: "count",
    unitLabel: "건",
    current: count,
    previous: avg,
    baselineLabel: "최근 7일 평균",
    baselineKind: "usual",
    saturateAt: 2,
  });
  if (!fact || count <= avg) return null;
  const busiest = [...input.model.clusters].sort((a, b) => b.count - a.count)[0];
  return {
    fact: {
      ...fact,
      evidence: { kind: "keys", keys: input.model.clusters.map((c) => c.id) },
      template: "커밋 {fact} — {baseline} {usual}건의 {times}배예요.",
      detail: {
        ...fact.detail,
        trigger: `${formatCount(count)}건`,
        usual: (Math.round(avg * 10) / 10).toLocaleString("ko-KR"),
        times: (Math.round((count / Math.max(avg, 0.1)) * 10) / 10).toLocaleString("ko-KR"),
      },
    },
    rows: [
      { label: "이날 커밋", value: `${formatCount(count)}건` },
      { label: "최근 7일 평균", value: `${(Math.round(avg * 10) / 10).toLocaleString("ko-KR")}건` },
      ...(busiest
        ? [{ label: "가장 몰린 시간", value: `${busiest.range} · ${busiest.count}건` }]
        : []),
    ],
  };
}

function longStayFact(input: DayFactInput): DayFact | null {
  const stays = input.model.stays;
  if (stays.length < 2) return null;
  const longest = stays.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const minutes = longest.end - longest.start;
  if (minutes < LONG_STAY_MIN) return null;
  // Home overnight is the default shape of a day, not news.
  if (longest.start === 0 || longest.end >= 1440) return null;
  const score = Math.min(1, 0.5 + ((minutes - LONG_STAY_MIN) / LONG_STAY_MIN) * 0.5);
  const during = input.model.rows.filter((r) => r.depth === 1 && r.mapId === longest.id);
  const commitsThere = during
    .filter((r) => r.kind === "commits")
    .reduce((s, r) => s + (r.kind === "commits" ? r.count : 0), 0);
  return {
    fact: {
      id: "day.stay.long",
      kind: "diagnosis",
      metric: "stay",
      metricLabel: "체류",
      period: period(input.date),
      value: minutes,
      unit: "minutes",
      score,
      evidence: { kind: "keys", keys: [longest.id] },
      template:
        commitsThere > 0
          ? "{place}에서 {fact} 머물며 커밋 {commits}건을 올렸어요."
          : "{place}에서 {fact} 머물렀어요.",
      detail: {
        trigger: longest.durationLabel,
        place: longest.name,
        commits: commitsThere,
      },
    },
    rows: [
      { label: longest.name, value: `${longest.range} · ${longest.durationLabel}` },
      ...(commitsThere > 0
        ? [{ label: "그동안 커밋", value: `${formatCount(commitsThere)}건` }]
        : []),
    ],
  };
}

/** The day's single AI line, or null when nothing clears the notability bar. */
export function pickDayFact(input: DayFactInput): DayFact | null {
  const candidates = [sleepFact(input), commitFact(input), longStayFact(input)].filter(
    (c): c is DayFact => c != null
  );
  const fact = pickOne(candidates.map((c) => c.fact));
  return fact ? (candidates.find((c) => c.fact === fact) ?? null) : null;
}
