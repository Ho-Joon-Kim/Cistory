/**
 * The "흐름" chart: one bar per day (week/month) or month (year), switchable
 * between commits, steps and cash flow, with 1–3 computed annotations per metric
 * (peak, trip window, largest deposit/charge).
 */
import { formatCount, formatDay, formatMonthDay, formatWon, formatWonCompact } from "@/lib/format";
import type { OverviewHistoryResponse } from "../history";
import type {
  CodingAggregate,
  HealthAggregate,
  LocationAggregate,
  SpendingAggregate,
} from "../types";
import { type PeriodContext, seriesBarLabel, seriesTitle } from "./labels";
import { groupPlaces } from "./sections";
import { cashByDay, commitsByDay, metricByDay, periodDays } from "./series";

export type FlowMetric = "commits" | "steps" | "cash";

export interface FlowUnit {
  key: string;
  label: string;
  /** Show the x-axis label (every bar for ≤ 12 units, else 1/5/10…). */
  showLabel: boolean;
  title: string;
  commits: number | null;
  steps: number | null;
  spending: number | null;
  income: number | null;
  /** After today — drawn empty, excluded from averages. */
  future: boolean;
  partial: boolean;
  weekend: boolean;
}

export interface FlowAnnotation {
  id: string;
  /** Inclusive unit indexes. */
  from: number;
  to: number;
  label: string;
  /** Shorter label for phones. */
  shortLabel?: string;
  /** Hang under the axis (cash-flow charges point down). */
  low?: boolean;
  /** Second lane (higher up) to avoid colliding with the first. */
  lane?: 0 | 1;
  rows: { label: string; value: string }[];
}

/**
 * The away area the period's work happened in (대전 · 60계치킨 대전유성점 · 531
 * commits). The snapshot has no per-day place data, so the chart looks the
 * area's visit days up separately and spans them with {@link stayAnnotation}.
 */
export interface StayFocus {
  area: string;
  place: string;
  commits: number;
  from: string;
  to: string;
}

export interface FlowModel {
  units: FlowUnit[];
  stayFocus: StayFocus | null;
  annotations: Record<FlowMetric, FlowAnnotation[]>;
  averageLabel: Record<"commits" | "steps", string>;
  available: Record<FlowMetric, boolean>;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function weekday(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function buildFlow(input: {
  ctx: PeriodContext;
  coding: CodingAggregate | null;
  spending: SpendingAggregate | null;
  health: HealthAggregate | null;
  location: LocationAggregate | null;
  history: OverviewHistoryResponse | null;
}): FlowModel {
  const { ctx, coding, spending, health, location, history } = input;
  let units: FlowUnit[];
  if (ctx.periodType === "year") {
    units = (history?.series ?? []).map((p) => ({
      key: p.periodKey,
      label: `${seriesBarLabel(p)}월`,
      showLabel: true,
      title: `${seriesTitle(p, ctx.now)}${p.inProgress ? ` (${Number(ctx.through.slice(8))}일까지)` : ""}`,
      commits: p.commits,
      steps: p.steps ? p.steps.total / p.steps.days : null,
      spending: p.spending,
      income: p.income,
      future: false,
      partial: p.inProgress,
      weekend: false,
    }));
  } else {
    const commits = commitsByDay(coding);
    const cash = cashByDay(spending);
    const steps = metricByDay(health, "steps");
    const days = periodDays(ctx);
    const n = days.length;
    units = days.map((d, i) => {
      const future = d > ctx.through;
      const dayNum = Number(d.slice(8));
      const wd = weekday(d);
      return {
        key: d,
        label: ctx.periodType === "week" ? `${WEEKDAYS[wd]} ${dayNum}` : String(dayNum),
        showLabel:
          ctx.periodType === "week" || i === 0 || i === n - 1 || (dayNum % 5 === 0 && i < n - 2),
        title: formatDay(d, { now: ctx.now }),
        commits: future || !coding ? null : (commits.get(d) ?? 0),
        steps: future ? null : (steps.get(d) ?? null),
        spending: future || !spending ? null : (cash.get(d)?.spending ?? 0),
        income: future || !spending ? null : (cash.get(d)?.income ?? 0),
        future,
        partial: false,
        weekend: wd === 0 || wd === 6,
      };
    });
  }

  const annotations: Record<FlowMetric, FlowAnnotation[]> = { commits: [], steps: [], cash: [] };
  const maxIndex = (pick: (u: FlowUnit) => number | null) => {
    let best = -1;
    let bestValue = 0;
    units.forEach((u, i) => {
      const v = pick(u);
      if (v !== null && v > bestValue) {
        best = i;
        bestValue = v;
      }
    });
    return best;
  };
  const unitWord = ctx.periodType === "year" ? "월" : "하루";

  const ci = maxIndex((u) => u.commits);
  if (ci >= 0) {
    const u = units[ci];
    const prevUnit = units[ci - 1];
    const times =
      ctx.periodType === "year" && prevUnit?.commits ? (u.commits ?? 0) / prevUnit.commits : 0;
    annotations.commits.push({
      id: "commits.peak",
      from: ci,
      to: ci,
      label:
        times >= 2
          ? `${u.label} · ${prevUnit.label}의 ${Math.round(times * 10) / 10}배`
          : `최다 ${formatCount(u.commits ?? 0)}`,
      rows: [
        { label: `${u.title} 커밋`, value: formatCount(u.commits ?? 0) },
        ...(times >= 2
          ? [{ label: `${prevUnit.title} 커밋`, value: formatCount(prevUnit.commits ?? 0) }]
          : []),
        { label: `${unitWord} 평균`, value: formatCount(average(units.map((x) => x.commits))) },
      ],
    });
  }
  if (ctx.periodType !== "year") {
    for (const trip of location?.derived.trips ?? []) {
      const from = units.findIndex((u) => u.key >= trip.startDate);
      let to = -1;
      units.forEach((u, i) => {
        if (u.key <= trip.endDate) to = i;
      });
      if (from < 0 || to < from || units[from].key > trip.endDate) continue;
      const name = trip.name.replace(/\s*여행$/, "");
      const tripCommits = units.slice(from, to + 1).reduce((s, u) => s + (u.commits ?? 0), 0);
      const rows = [
        { label: "여행", value: trip.name },
        {
          label: "기간",
          value: `${formatMonthDay(trip.startDate, { now: ctx.now })}–${formatMonthDay(trip.endDate, { now: ctx.now })}`,
        },
        { label: "그동안 커밋", value: formatCount(tripCommits) },
      ];
      annotations.commits.push({
        id: `commits.trip.${trip.startDate}`,
        from,
        to,
        lane: 1,
        label: tripCommits > 0 ? `${name} 체류 · ${formatCount(tripCommits)}커밋` : `${name} 체류`,
        shortLabel: tripCommits > 0 ? `${name} · ${formatCount(tripCommits)}커밋` : name,
        rows,
      });
      annotations.steps.push({
        id: `steps.trip.${trip.startDate}`,
        from,
        to,
        lane: 1,
        label: `${name} 이동`,
        rows,
      });
      if (annotations.commits.length >= 3) break;
    }
  }

  const si = maxIndex((u) => u.steps);
  if (si >= 0) {
    annotations.steps.unshift({
      id: "steps.peak",
      from: si,
      to: si,
      label:
        ctx.periodType === "year"
          ? `${units[si].label} 하루 ${formatCount(units[si].steps ?? 0)}걸음`
          : `최다 ${formatCount(units[si].steps ?? 0)}걸음`,
      rows: [
        { label: units[si].title, value: `${formatCount(units[si].steps ?? 0)}걸음` },
        { label: "하루 평균", value: `${formatCount(average(units.map((x) => x.steps)))}걸음` },
      ],
    });
  }

  const ii = maxIndex((u) => u.income);
  const sp = maxIndex((u) => u.spending);
  if (sp >= 0 && ctx.periodType !== "year") {
    annotations.cash.push({
      id: "cash.charge",
      from: sp,
      to: sp,
      low: true,
      label: `지출 ${formatWonCompact(units[sp].spending ?? 0)}`,
      rows: [
        { label: `${units[sp].title} 지출`, value: formatWon(units[sp].spending ?? 0) },
        { label: `${ctx.label} 지출`, value: formatWonCompact(sum(units.map((u) => u.spending))) },
      ],
    });
  }
  if (ii >= 0) {
    annotations.cash.push({
      id: "cash.deposit",
      from: ii,
      to: ii,
      label: `입금 ${formatWonCompact(units[ii].income ?? 0)}`,
      rows: [
        { label: `${units[ii].title} 입금`, value: formatWon(units[ii].income ?? 0) },
        { label: `${ctx.label} 수입`, value: formatWonCompact(sum(units.map((u) => u.income))) },
      ],
    });
  }

  let stayFocus: StayFocus | null = null;
  if (ctx.periodType !== "year" && location) {
    const productivity = new Map(
      location.derived.placeProductivity.map((p) => [p.placeName, p.commitCount])
    );
    for (const g of groupPlaces(location.derived)) {
      // Only away areas (clusters named after a region) — home places are the baseline.
      if (g.places.length < 2) continue;
      for (const p of g.places) {
        const c = productivity.get(p.placeName) ?? 0;
        if (c > 0 && (!stayFocus || c > stayFocus.commits)) {
          stayFocus = {
            area: g.name,
            place: p.placeName,
            commits: c,
            from: ctx.from,
            to: ctx.through,
          };
        }
      }
    }
  }

  const commitAvg = average(units.map((u) => u.commits));
  const stepAvg = average(units.map((u) => u.steps));
  return {
    units,
    stayFocus,
    annotations,
    averageLabel: {
      commits: `${ctx.periodType === "year" ? "월평균" : "하루 평균"} ${formatCount(commitAvg)}`,
      steps: `하루 평균 ${formatCount(stepAvg)}걸음`,
    },
    available: {
      commits: units.some((u) => u.commits !== null),
      steps: units.some((u) => u.steps !== null),
      cash: units.some((u) => u.spending !== null),
    },
  };
}

export function average(values: (number | null)[]): number {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/** Two visit days this far apart (in days) still read as one stay. */
const STAY_GAP_DAYS = 2;

/**
 * The longest run of period days with visits to the focus area (gaps up to
 * {@link STAY_GAP_DAYS} bridged, since one overnight visit only carries its
 * start day), as a lane-1 span annotation: `대전 체류 · 60계치킨 대전유성점에서
 * 531커밋`. Null when the area was visited on fewer than two days.
 */
export function stayAnnotation(
  units: FlowUnit[],
  focus: StayFocus,
  visitDays: string[]
): FlowAnnotation | null {
  const days = new Set(visitDays);
  let best: { from: number; to: number; hits: number } | null = null;
  let cur: { from: number; to: number; hits: number } | null = null;
  units.forEach((u, i) => {
    if (!days.has(u.key)) return;
    if (cur && i - cur.to <= STAY_GAP_DAYS + 1) {
      cur.to = i;
      cur.hits += 1;
    } else cur = { from: i, to: i, hits: 1 };
    if (!best || cur.to - cur.from > best.to - best.from) best = { ...cur };
  });
  const run = best as { from: number; to: number; hits: number } | null;
  if (!run || run.to === run.from) return null;
  const commits = formatCount(focus.commits);
  const spanCommits = units.slice(run.from, run.to + 1).reduce((s, u) => s + (u.commits ?? 0), 0);
  return {
    id: `commits.stay.${units[run.from].key}`,
    from: run.from,
    to: run.to,
    lane: 1,
    label: `${focus.area} 체류 · ${focus.place}에서 ${commits}커밋`,
    shortLabel: `${focus.area} · ${commits}커밋`,
    rows: [
      { label: "지역", value: focus.area },
      {
        label: "기간",
        value: `${formatMonthDay(units[run.from].key)}–${formatMonthDay(units[run.to].key)}`,
      },
      { label: `${focus.place} 커밋`, value: commits },
      { label: "그동안 전체 커밋", value: formatCount(spanCommits) },
    ],
  };
}
