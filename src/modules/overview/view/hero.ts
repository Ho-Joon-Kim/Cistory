/**
 * The hero: what changed against the previous period — commits, net savings and
 * body (weight + steps). Heart rate never appears here. Every comparison needs a
 * stored previous period; without one the delta line is simply omitted.
 */
import { concentration, type Fact, oneOff, pickOne, recordLowHigh } from "@/lib/facts";
import { formatCount, formatMonthDay } from "@/lib/format";
import type { OverviewHistoryPeriod, OverviewHistoryResponse } from "../history";
import type { CodingAggregate, HealthAggregate, SpendingAggregate } from "../types";
import { tagFact } from "./evidence-tag";
import { type PeriodContext, seriesBarLabel, seriesTitle } from "./labels";
import { wonColumn } from "./sections";
import {
  cashByDay,
  changePhrase,
  commitsByDay,
  kg,
  pct,
  periodDays,
  sentenceFact,
  stepsAverage,
} from "./series";

export type Direction = "up" | "down" | null;

export interface HeroDelta {
  text: string;
  dir: Direction;
}

export interface MiniBar {
  key: string;
  label: string;
  /** Height as 0..1 of the tallest bar; null = no data (drawn as a dashed stub). */
  ratio: number | null;
  tip: string;
  current: boolean;
  partial: boolean;
}

export interface HeroFoot {
  label: string;
  value: string;
  unit: string;
  delta: HeroDelta | null;
}

export interface CommitsHero {
  value: number;
  delta: HeroDelta | null;
  fact: Fact | null;
  bars: MiniBar[];
  foot: HeroFoot;
}

export interface CashPair {
  label: string;
  income: number;
  spending: number;
  incomeRatio: number;
  spendingRatio: number;
  current: boolean;
}

export interface NetBar {
  key: string;
  label: string;
  /** Signed −1..1 of the largest |net|. */
  ratio: number;
  tip: string;
}

export interface SavingsHero {
  net: number;
  delta: HeroDelta | null;
  fact: Fact | null;
  pairs: CashPair[] | null;
  netBars: NetBar[] | null;
  foot: HeroFoot;
}

export interface WeightPoint {
  date: string;
  weight: number;
  inside: boolean;
}

export interface BodyHero {
  weight: {
    value: number;
    delta: HeroDelta | null;
    fact: Fact | null;
    points: WeightPoint[];
    peak: WeightPoint | null;
    axisFrom: string;
    axisTo: string;
    /** Set when the period has no weigh-in: the figure is this earlier measurement. */
    asOf: string | null;
  } | null;
  steps: {
    average: number;
    delta: HeroDelta | null;
    fact: Fact | null;
    bars: MiniBar[];
  } | null;
}

export interface HeroModel {
  commits: CommitsHero | null;
  savings: SavingsHero | null;
  body: BodyHero;
}

/**
 * Hero money keeps one fixed decimal of 만원 throughout (`278.0만원` beside
 * `239.3만원`), so amounts read side by side never mix precisions.
 */
const won = (n: number, sign = false) => `${sign && n > 0 ? "+" : ""}${wonColumn(n)}`;

function direction(ratio: number): Direction {
  if (Math.round(ratio * 100) === 0) return null;
  return ratio > 0 ? "up" : "down";
}

function seriesBars(
  series: OverviewHistoryPeriod[],
  ctx: PeriodContext,
  pick: (p: OverviewHistoryPeriod) => number | null,
  tipValue: (v: number) => string
): MiniBar[] {
  const values = series.map(pick);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return series.map((p, i) => {
    const v = values[i];
    const title = seriesTitle(p, ctx.now);
    return {
      key: p.periodKey,
      label: seriesBarLabel(p),
      ratio: v === null ? null : v / max,
      tip:
        v === null
          ? `${title} · 기록 없음`
          : `${title} · ${tipValue(v)}${p.inProgress ? " (진행 중)" : ""}`,
      current: ctx.periodType !== "year" && p.periodKey === ctx.periodKey,
      partial: p.inProgress,
    };
  });
}

// ── commits ──────────────────────────────────────────────────────────────────

const SPAN_WORDS: Record<number, string> = { 2: "이틀", 3: "사흘", 5: "닷새" };

function commitsFact(
  ctx: PeriodContext,
  coding: CodingAggregate,
  history: OverviewHistoryResponse | null
): Fact | null {
  const byDay = commitsByDay(coding);
  const candidates: (Fact | null)[] = [];
  if (ctx.periodType !== "year") {
    const days = periodDays(ctx).filter((d) => d <= ctx.through);
    const windowSize = ctx.periodType === "month" ? 5 : 2;
    const base = concentration({
      id: "overview.commits.burst",
      metric: "commits",
      metricLabel: "커밋",
      period: { from: ctx.from, to: ctx.to, label: ctx.label },
      unit: "count",
      unitLabel: "",
      series: days.map((d) => ({ key: d, value: byDay.get(d) ?? 0 })),
      windowSize,
      now: ctx.now,
    });
    if (base) {
      const share = pct(base.value);
      const windowLabel = String(base.detail?.windowLabel ?? "");
      candidates.push(
        sentenceFact({
          id: base.id,
          metric: "commits",
          metricLabel: "커밋",
          ctx,
          value: base.value,
          unit: "percent",
          score: base.score,
          evidence: base.evidence,
          template: `커밋의 {fact}가 {windowLabel} {span}에 몰렸어요.`,
          trigger: share,
          detail: { windowLabel, span: SPAN_WORDS[windowSize] ?? "" },
          rows: [
            { label: `${ctx.label} 커밋`, value: formatCount(coding.totalCommits) },
            ...(history?.previous?.commits != null
              ? [
                  {
                    label: `${ctx.previousLabel} 커밋`,
                    value: formatCount(history.previous.commits),
                  },
                ]
              : []),
            {
              label: windowLabel,
              value: `${formatCount(Number(base.detail?.partValue ?? 0))} (${share})`,
            },
            ...maxDayRow(byDay, ctx),
          ],
        })
      );
    }
  } else if (history) {
    // Year: the two consecutive months holding the largest share.
    const months = history.series.filter((p) => p.commits !== null);
    const base =
      months.length > 3
        ? concentration({
            id: "overview.commits.months",
            metric: "commits",
            metricLabel: "커밋",
            period: { from: ctx.from, to: ctx.to, label: ctx.label },
            unit: "count",
            series: months.map((p) => ({ key: p.periodKey, value: p.commits ?? 0 })),
            windowSize: 2,
          })
        : null;
    if (base) {
      const a = String(base.detail?.windowFrom ?? "");
      const b = String(base.detail?.windowTo ?? "");
      const label = `${Number(a.slice(5))}–${Number(b.slice(5))}월`;
      const share = pct(base.value);
      candidates.push(
        sentenceFact({
          id: base.id,
          metric: "commits",
          metricLabel: "커밋",
          ctx,
          value: base.value,
          unit: "percent",
          score: base.score,
          evidence: { kind: "keys", keys: [a, b] },
          template: `{months} 두 달이 ${ctx.label} 커밋의 {fact}를 차지해요.`,
          trigger: share,
          detail: { months: label },
          rows: months
            .filter((p) => p.periodKey === a || p.periodKey === b)
            .map((p) => ({ label: seriesTitle(p, ctx.now), value: formatCount(p.commits ?? 0) }))
            .concat([{ label: `${ctx.label} 합계`, value: formatCount(coding.totalCommits) }]),
        })
      );
    }
  }
  return pickOne(candidates);
}

function maxDayRow(byDay: Map<string, number>, ctx: PeriodContext) {
  let best: [string, number] | null = null;
  for (const [d, c] of byDay) if (!best || c > best[1]) best = [d, c];
  return best && best[1] > 0
    ? [
        {
          label: "하루 최다",
          value: `${formatMonthDay(best[0], { now: ctx.now })} · ${formatCount(best[1])}`,
        },
      ]
    : [];
}

function commitsHero(
  ctx: PeriodContext,
  coding: CodingAggregate,
  history: OverviewHistoryResponse | null
): CommitsHero {
  const prev = history?.previous?.commits ?? null;
  let delta: HeroDelta | null = null;
  if (prev !== null && prev > 0) {
    const r = coding.totalCommits / prev - 1;
    delta = {
      text: `${ctx.previousLabel} ${formatCount(prev)}보다 ${changePhrase(r)}`,
      dir: direction(r),
    };
  }
  const prevActive = history?.previous?.activeDays ?? null;
  return {
    value: coding.totalCommits,
    delta,
    fact: tagFact(commitsFact(ctx, coding, history), "commits"),
    bars: history
      ? seriesBars(
          history.series,
          ctx,
          (p) => p.commits,
          (v) => formatCount(v)
        )
      : [],
    foot: {
      label: "활동일",
      value: formatCount(coding.activeDays),
      unit: "일",
      delta:
        ctx.periodType === "year"
          ? {
              text: `${formatCount(ctx.elapsedDays)}일 중 ${pct(coding.activeDays / Math.max(1, ctx.elapsedDays))}`,
              dir: null,
            }
          : prevActive !== null
            ? {
                text: `${ctx.previousLabel} ${formatCount(prevActive)}일`,
                dir: direction(coding.activeDays - prevActive),
              }
            : null,
    },
  };
}

// ── savings ──────────────────────────────────────────────────────────────────

function savingsFact(ctx: PeriodContext, spending: SpendingAggregate): Fact | null {
  const days = [...cashByDay(spending)];
  const net = spending.income - spending.spending;
  const income = oneOff({
    id: "overview.cash.income",
    metric: "income",
    metricLabel: "수입",
    period: { from: ctx.from, to: ctx.to, label: ctx.label },
    unit: "won",
    items: days.map(([d, c]) => ({ key: d, value: c.income })),
    total: spending.income,
  });
  const out = oneOff({
    id: "overview.cash.spending",
    metric: "spending",
    metricLabel: "지출",
    period: { from: ctx.from, to: ctx.to, label: ctx.label },
    unit: "won",
    items: days.map(([d, c]) => ({ key: d, value: c.spending })),
    total: spending.spending,
  });
  const candidates: (Fact | null)[] = [];
  if (income && income.value >= 0.4) {
    const day = String(income.detail?.itemKey);
    const amount = Number(income.detail?.itemValue);
    const without = net - amount;
    candidates.push(
      sentenceFact({
        id: income.id,
        metric: "income",
        metricLabel: "수입",
        ctx,
        value: income.value,
        unit: "percent",
        score: income.score,
        evidence: income.evidence,
        template: "수입의 {fact}는 {day} 하루 입금이에요 — 이를 빼면 {without}.",
        trigger: pct(income.value),
        detail: { day: formatMonthDay(day, { now: ctx.now }), without: won(without, true) },
        rows: [
          { label: `${ctx.label} 수입`, value: won(spending.income) },
          { label: `${formatMonthDay(day, { now: ctx.now })} 입금`, value: won(amount) },
          { label: `${ctx.label} 지출`, value: won(spending.spending) },
        ],
      })
    );
  }
  if (out && out.value >= 0.3) {
    const day = String(out.detail?.itemKey);
    const amount = Number(out.detail?.itemValue);
    candidates.push(
      sentenceFact({
        id: out.id,
        metric: "spending",
        metricLabel: "지출",
        ctx,
        value: out.value,
        unit: "percent",
        score: out.score,
        evidence: out.evidence,
        template: "지출의 {fact}가 {day} 하루에 나갔어요 — 이를 빼면 하루 평균 {avg}.",
        trigger: pct(out.value),
        detail: {
          day: formatMonthDay(day, { now: ctx.now }),
          avg: won((spending.spending - amount) / Math.max(1, ctx.elapsedDays)),
        },
        rows: [
          { label: `${ctx.label} 지출`, value: won(spending.spending) },
          { label: `${formatMonthDay(day, { now: ctx.now })} 지출`, value: won(amount) },
          { label: "나머지 중 하루 최대", value: won(Number(out.detail?.secondValue)) },
        ],
      })
    );
  }
  return pickOne(candidates);
}

/** Cash facts light the flow chart's cash view and the matching bar of the pair. */
function cashTagged(fact: Fact | null): Fact | null {
  return fact ? tagFact(fact, `cash.${fact.metric}`) : null;
}

function netPhrase(ctx: PeriodContext, net: number, prevNet: number): string {
  const prev = `${ctx.previousLabel} ${won(prevNet, true)}`;
  if (prevNet < 0 && net > 0) return `${prev}에서 흑자 전환`;
  if (prevNet > 0 && net < 0) return `${prev}에서 적자 전환`;
  return `${prev}`;
}

function savingsHero(
  ctx: PeriodContext,
  spending: SpendingAggregate,
  history: OverviewHistoryResponse | null
): SavingsHero {
  const net = spending.income - spending.spending;
  const prev = history?.previous;
  const hasPrev = prev && prev.income !== null && prev.spending !== null;
  const prevNet = hasPrev ? (prev.income ?? 0) - (prev.spending ?? 0) : null;

  let pairs: CashPair[] | null = null;
  let netBars: NetBar[] | null = null;
  if (ctx.periodType !== "year" && hasPrev) {
    const scale = Math.max(
      1,
      spending.income,
      spending.spending,
      prev.income ?? 0,
      prev.spending ?? 0
    );
    pairs = [
      {
        label: ctx.previousLabel,
        income: prev.income ?? 0,
        spending: prev.spending ?? 0,
        incomeRatio: (prev.income ?? 0) / scale,
        spendingRatio: (prev.spending ?? 0) / scale,
        current: false,
      },
      {
        label: ctx.label,
        income: spending.income,
        spending: spending.spending,
        incomeRatio: spending.income / scale,
        spendingRatio: spending.spending / scale,
        current: true,
      },
    ];
  } else if (ctx.periodType === "year" && history) {
    const months = history.series.filter(
      (p) => p.income !== null && p.spending !== null && (p.income > 0 || p.spending > 0)
    );
    const nets = months.map((p) => (p.income ?? 0) - (p.spending ?? 0));
    const max = Math.max(1, ...nets.map(Math.abs));
    netBars = months.map((p, i) => ({
      key: p.periodKey,
      label: seriesBarLabel(p),
      ratio: nets[i] / max,
      tip: `${seriesTitle(p, ctx.now)} · ${won(nets[i], true)}`,
    }));
  }

  const dailyAvg = spending.spending / Math.max(1, ctx.elapsedDays);
  let footDelta: HeroDelta | null = null;
  if (hasPrev && ctx.periodType !== "year") {
    const prevDays = dayCountBetween(prev.from, prev.to);
    const prevAvg = (prev.spending ?? 0) / prevDays;
    if (prevAvg > 0) {
      const r = dailyAvg / prevAvg - 1;
      footDelta = {
        text: `${ctx.previousLabel} ${won(prevAvg)}보다 ${changePhrase(r)}`,
        dir: direction(r),
      };
    }
  } else if (ctx.periodType === "year") {
    footDelta = { text: `${formatCount(ctx.elapsedDays)}일 기준`, dir: null };
  }

  return {
    net,
    delta:
      prevNet !== null
        ? { text: netPhrase(ctx, net, prevNet), dir: net >= prevNet ? "up" : "down" }
        : ctx.periodType === "year"
          ? { text: `수입 ${won(spending.income)} · 지출 ${won(spending.spending)}`, dir: null }
          : null,
    fact: cashTagged(savingsFact(ctx, spending)),
    pairs,
    netBars,
    foot: {
      label: "하루 평균 지출",
      ...splitMan(dailyAvg),
      delta: footDelta,
    },
  };
}

function dayCountBetween(from: string, to: string) {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

function splitMan(n: number): { value: string; unit: string } {
  const text = won(n);
  const m = /^(.*?)(만원|원)$/.exec(text);
  return m ? { value: m[1], unit: m[2] } : { value: text, unit: "" };
}

// ── body ─────────────────────────────────────────────────────────────────────

function weightBlock(
  ctx: PeriodContext,
  health: HealthAggregate | null,
  history: OverviewHistoryResponse | null
): BodyHero["weight"] {
  const own = health?.body.weightSeries ?? [];
  const window = new Map<string, number>();
  for (const w of history?.weight ?? []) window.set(w.date, w.weight);
  for (const w of own) window.set(w.date, w.weight);
  const all = [...window]
    .filter(([d]) => d <= ctx.to)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, weight]) => ({ date, weight, inside: date >= ctx.from }));
  const inside = all.filter((p) => p.inside);
  const last = inside.at(-1);
  if (!last) {
    // No weigh-in this period: show the latest earlier one, dated, with its trend.
    const prior = all.at(-1);
    if (!prior) return null;
    const recent = all.slice(-8);
    return {
      value: prior.weight,
      delta: null,
      fact: null,
      points: recent,
      peak: null,
      axisFrom: recent[0].date,
      axisTo: ctx.through,
      asOf: prior.date,
    };
  }

  const prev = history?.previous?.weight ?? null;
  let delta: HeroDelta | null = null;
  if (!prev && ctx.periodType === "year" && inside.length > 1) {
    const first = inside[0];
    const diff = last.weight - first.weight;
    delta = {
      text: `${formatMonthDay(first.date, { now: ctx.now })} 첫 측정보다 ${kg(Math.abs(diff))} ${diff < 0 ? "감소" : diff > 0 ? "증가" : "그대로"}`,
      dir: Math.abs(diff) < 0.05 ? null : diff < 0 ? "down" : "up",
    };
  }
  if (prev) {
    const diff = last.weight - prev.weight;
    const where =
      ctx.periodType === "month" ? `${ctx.previousLabel} 말` : `${ctx.previousLabel} 마지막`;
    delta = {
      text: `${where} ${kg(prev.weight)}보다 ${kg(Math.abs(diff))} ${diff < 0 ? "감소" : diff > 0 ? "증가" : "그대로"}`,
      dir: Math.abs(diff) < 0.05 ? null : diff < 0 ? "down" : "up",
    };
  }

  const peak = all.reduce<WeightPoint | null>((m, p) => (!m || p.weight > m.weight ? p : m), null);
  const low = all.reduce<WeightPoint | null>((m, p) => (!m || p.weight < m.weight ? p : m), null);
  const candidates: (Fact | null)[] = [];
  if (peak && peak.date < last.date && peak.weight - last.weight >= 1) {
    const drop = peak.weight - last.weight;
    candidates.push(
      sentenceFact({
        id: "overview.weight.fromPeak",
        metric: "weight",
        metricLabel: "체중",
        ctx,
        value: drop,
        unit: "count",
        unitLabel: "kg",
        score: Math.min(1, 0.4 + drop / 5),
        evidence: { kind: "keys", keys: [peak.date, last.date] },
        template: "{peakDay} 정점 {peakKg} 이후 내림세 — 정점보다 {fact} 낮아요.",
        trigger: kg(drop),
        detail: { peakDay: formatMonthDay(peak.date, { now: ctx.now }), peakKg: kg(peak.weight) },
        rows: [
          {
            label: "정점",
            value: `${formatMonthDay(peak.date, { now: ctx.now })} · ${kg(peak.weight)}`,
          },
          {
            label: `${ctx.label} 첫 측정`,
            value: `${formatMonthDay(inside[0].date, { now: ctx.now })} · ${kg(inside[0].weight)}`,
          },
          {
            label: `${ctx.label} 마지막`,
            value: `${formatMonthDay(last.date, { now: ctx.now })} · ${kg(last.weight)}`,
          },
          { label: `${ctx.label} 측정`, value: `${inside.length}회` },
        ],
      })
    );
  }
  if (low?.inside && low.date !== all[0]?.date && all.length >= 5) {
    const after = inside.filter((p) => p.date > low.date);
    const rebound = after.length ? Math.max(...after.map((p) => p.weight)) - low.weight : 0;
    candidates.push(
      sentenceFact({
        id: "overview.weight.low",
        metric: "weight",
        metricLabel: "체중",
        ctx,
        value: low.weight,
        unit: "count",
        unitLabel: "kg",
        score: rebound >= 0.5 ? 0.55 : 0.6,
        evidence: { kind: "keys", keys: [low.date] },
        template:
          rebound >= 0.5
            ? "{lowDay} {fact}은 기록 중 최저 — 이후 {rebound} 반등했어요."
            : "{lowDay} {fact}이 기록 중 가장 가벼워요.",
        trigger: kg(low.weight),
        detail: { lowDay: formatMonthDay(low.date, { now: ctx.now }), rebound: kg(rebound) },
        rows: [
          {
            label: "최저",
            value: `${formatMonthDay(low.date, { now: ctx.now })} · ${kg(low.weight)}`,
          },
          ...(peak
            ? [
                {
                  label: "최고",
                  value: `${formatMonthDay(peak.date, { now: ctx.now })} · ${kg(peak.weight)}`,
                },
              ]
            : []),
          {
            label: "측정",
            value: `${all.length}회 (${formatMonthDay(all[0].date, { now: ctx.now })}부터)`,
          },
        ],
      })
    );
  }

  return {
    value: last.weight,
    delta,
    fact: tagFact(pickOne(candidates), "weight"),
    points: all,
    peak: peak && peak.weight - (low?.weight ?? peak.weight) >= 0.5 ? peak : null,
    axisFrom: all[0].date,
    axisTo: ctx.periodType === "year" ? last.date : ctx.through,
    asOf: null,
  };
}

function stepsBlock(
  ctx: PeriodContext,
  health: HealthAggregate | null,
  history: OverviewHistoryResponse | null
): BodyHero["steps"] {
  const average = stepsAverage(health);
  if (average === null) return null;
  const prev = history?.previous?.steps;
  let delta: HeroDelta | null = null;
  if (prev && prev.days > 0) {
    const r = average / (prev.total / prev.days) - 1;
    delta = { text: `${ctx.previousLabel}보다 ${changePhrase(r)}`, dir: direction(r) };
  }
  const series = history?.series ?? [];
  const avgOf = (p: OverviewHistoryPeriod) => (p.steps ? p.steps.total / p.steps.days : null);
  let fact: Fact | null = null;
  const settled = series.filter(
    (p) => avgOf(p) !== null && (!p.inProgress || p.periodKey === ctx.periodKey)
  );
  if (ctx.periodType !== "year" && settled.length >= 4) {
    const points = settled.map((p) => ({ key: p.periodKey, value: avgOf(p) ?? 0 }));
    const unitWord = ctx.periodType === "month" ? "달" : "주";
    for (const dir of ["low", "high"] as const) {
      const rec = recordLowHigh({
        id: `overview.steps.${dir}`,
        metric: "steps",
        metricLabel: "걸음",
        period: { from: ctx.from, to: ctx.to, label: ctx.label },
        unit: "steps",
        series: points,
        targetKey: ctx.periodKey,
        direction: dir,
        scopeLabel: `최근 ${settled.length}${ctx.periodType === "month" ? "개월" : "주"}`,
      });
      if (!rec) continue;
      const other = points.reduce((m, p) =>
        (dir === "low" ? p.value > m.value : p.value < m.value) ? p : m
      );
      const otherPeriod = settled.find((p) => p.periodKey === other.key);
      const ratio = average / other.value;
      fact = sentenceFact({
        id: rec.id,
        metric: "steps",
        metricLabel: "걸음",
        ctx,
        value: ratio,
        unit: "percent",
        score: rec.score,
        evidence: { kind: "keys", keys: [ctx.periodKey, other.key] },
        template:
          dir === "low"
            ? `{scope} 가장 적게 걸은 ${unitWord} — {other}의 {fact}예요.`
            : `{scope} 가장 많이 걸은 ${unitWord} — {other}의 {fact}예요.`,
        trigger: pct(ratio),
        detail: {
          scope: `최근 ${settled.length}${ctx.periodType === "month" ? "개월" : "주"} 중`,
          other: otherPeriod ? seriesTitle(otherPeriod, ctx.now) : "",
        },
        rows: [
          { label: `${ctx.label} 하루 평균`, value: `${formatCount(average)}보` },
          ...(otherPeriod
            ? [
                {
                  label: `${seriesTitle(otherPeriod, ctx.now)} 하루 평균`,
                  value: `${formatCount(other.value)}보`,
                },
              ]
            : []),
        ],
      });
      break;
    }
  }
  return {
    average,
    delta,
    fact: tagFact(fact, "steps"),
    bars: seriesBars(series, ctx, avgOf, (v) => `하루 ${formatCount(v)}보`),
  };
}

export function buildHero(input: {
  ctx: PeriodContext;
  coding: CodingAggregate | null;
  spending: SpendingAggregate | null;
  health: HealthAggregate | null;
  history: OverviewHistoryResponse | null;
}): HeroModel {
  const { ctx, coding, spending, health, history } = input;
  return {
    commits: coding ? commitsHero(ctx, coding, history) : null,
    savings: spending ? savingsHero(ctx, spending, history) : null,
    body: { weight: weightBlock(ctx, health, history), steps: stepsBlock(ctx, health, history) },
  };
}
