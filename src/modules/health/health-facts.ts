// Template-first AI lines for /health. Each builder returns a Fact (or null when
// nothing clears the notability bar) whose numbers come from the data; the
// sentence is a code-authored template a future LLM chooser can replace.

import { toKstCalendarDate } from "@/lib/date-key";
import type { Fact } from "@/lib/facts/types";
import { formatDay, formatDurationMinutes, formatMonthDay, formatTime } from "@/lib/format";
import type { ActivityCorrelationDay, HealthWorkout } from "./types";
import {
  fmtNum,
  mean,
  median,
  type Night,
  pearson,
  type RhrView,
  type WeightView,
  workoutName,
} from "./view-model";

const md = (day: string) => formatMonthDay(day);

/** Sleep: an unusual amount of waking (or too little deep sleep) vs the other nights. */
export function sleepFact(nights: readonly Night[], index: number): Fact | null {
  const night = nights[index];
  if (!night || nights.length < 4) return null;
  const others = nights.filter((_, i) => i !== index);
  const awakeMed = median(others.map((n) => n.stages.awake)) ?? 0;
  const deepMed = median(others.map((n) => n.stages.deep)) ?? 0;
  const eff = night.inBed > 0 ? Math.round((night.asleep / night.inBed) * 100) : 0;
  const period = { from: night.wakeDay, to: night.wakeDay, label: formatDay(night.wakeDay) };
  const source = { label: "출처", value: `Fitbit 수면 단계 · 최근 ${nights.length}밤` };

  if (night.stages.awake >= 20 && awakeMed > 0 && night.stages.awake >= 2 * awakeMed) {
    const ratio = night.stages.awake / awakeMed;
    return {
      id: "health.sleep.awake",
      kind: "delta",
      metric: "sleep_awake",
      metricLabel: "각성",
      period,
      value: night.stages.awake,
      baseline: { value: awakeMed, label: `다른 ${others.length}밤 중앙값`, kind: "usual" },
      unit: "minutes",
      score: Math.min(1, 0.5 + ratio / 10),
      evidence: { kind: "keys", keys: ["stage:awake"] },
      template:
        "깨어 있던 시간이 {fact}으로 다른 {others}밤 중앙값 {awakeMed}의 {ratio}배예요. 효율 {eff}가 낮은 이유입니다.",
      detail: {
        trigger: `${night.stages.awake}분`,
        others: String(others.length),
        awakeMed: `${fmtNum(awakeMed)}분`,
        ratio: fmtNum(ratio, 1),
        eff: `${eff}%`,
      },
      rows: [
        { label: "각성", value: `${formatDay(night.wakeDay)} 밤 · ${night.stages.awake}분` },
        { label: "비교 기준", value: `다른 ${others.length}밤 각성 중앙값 ${fmtNum(awakeMed)}분` },
        {
          label: "수면 효율",
          value: `${eff}% (잠든 ${formatDurationMinutes(night.asleep)} / 누운 ${formatDurationMinutes(night.inBed)})`,
        },
        source,
      ],
    };
  }
  if (deepMed >= 20 && night.stages.deep <= 0.5 * deepMed) {
    return {
      id: "health.sleep.deep",
      kind: "delta",
      metric: "sleep_deep",
      metricLabel: "깊은잠",
      period,
      value: night.stages.deep,
      baseline: { value: deepMed, label: `다른 ${others.length}밤 중앙값`, kind: "usual" },
      unit: "minutes",
      score: 0.7,
      evidence: { kind: "keys", keys: ["stage:deep"] },
      template: "깊은잠이 {fact}뿐이에요. 다른 {others}밤 중앙값 {deepMed}의 {pct} 수준입니다.",
      detail: {
        trigger: `${night.stages.deep}분`,
        others: String(others.length),
        deepMed: `${fmtNum(deepMed)}분`,
        pct: `${Math.round((night.stages.deep / deepMed) * 100)}%`,
      },
      rows: [
        { label: "깊은잠", value: `${formatDay(night.wakeDay)} 밤 · ${night.stages.deep}분` },
        { label: "비교 기준", value: `다른 ${others.length}밤 깊은잠 중앙값 ${fmtNum(deepMed)}분` },
        source,
      ],
    };
  }
  return null;
}

/** Resting HR: a sustained non-increasing run ending at the latest reading. */
export function rhrFact(view: RhrView | null): Fact | null {
  if (!view) return null;
  const drop = view.runFrom - view.latest;
  if (view.runDays < 5 || drop < 3) return null;
  const runKeys = view.days
    .slice(view.runStart)
    .filter((_, k) => view.values[view.runStart + k] != null);
  return {
    id: "health.rhr.run",
    kind: "delta",
    metric: "resting_heart_rate",
    metricLabel: "안정시 심박",
    period: { from: view.days[view.runStart], to: view.latestDay, label: `${view.runDays}일` },
    value: view.latest,
    baseline: { value: view.runFrom, label: md(view.days[view.runStart]), kind: "previous" },
    unit: "count",
    unitLabel: "bpm",
    score: Math.min(1, 0.45 + drop / 20 + view.runDays / 60),
    evidence: { kind: "keys", keys: runKeys },
    template: "{from} {fact}부터 한 번도 오르지 않고 {days}일 동안 {drop} 내려왔어요.",
    detail: {
      trigger: String(view.runFrom),
      from: md(view.days[view.runStart]),
      days: String(view.runDays),
      drop: `−${drop}bpm`,
    },
    rows: [
      { label: "안정시 심박", value: `${md(view.latestDay)} · ${view.latest}bpm` },
      {
        label: "시작점",
        value: `${md(view.days[view.runStart])} · ${view.runFrom}bpm${view.runFrom === view.max ? " (30일 최고와 같음)" : ""}`,
      },
      {
        label: "구간",
        value: `${view.runDays}일 · 기록 ${runKeys.length}회, 직전 값보다 오른 날 없음`,
      },
      { label: "30일 범위", value: `${view.min}–${view.max}bpm · 중앙값 ${view.median}` },
    ],
  };
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Weight: the last 7 weigh-ins vs the 7 before them. */
export function weightFact(view: WeightView | null): Fact | null {
  if (!view || view.points.length < 14) return null;
  const last7 = view.points.slice(-7);
  const prev7 = view.points.slice(-14, -7);
  const a = mean(last7.map((p) => p.weight)) as number;
  const b = mean(prev7.map((p) => p.weight)) as number;
  const d = a - b;
  if (Math.abs(d) < 0.5) return null;
  const weeks = Math.floor(daysBetween(view.peak.date, view.latest.date) / 7);
  const falling = d < 0 && view.fromPeak < 0 && weeks >= 2;
  return {
    id: "health.weight.avg7",
    kind: "delta",
    metric: "weight",
    metricLabel: "체중",
    period: { from: last7[0].date, to: last7[6].date, label: "최근 7회" },
    value: a,
    baseline: { value: b, label: "그 전 7회 평균", kind: "previous" },
    unit: "count",
    unitLabel: "kg",
    score: Math.min(1, 0.5 + Math.abs(d) / 4),
    evidence: { kind: "keys", keys: [...prev7, ...last7].map((p) => p.date) },
    template: falling
      ? "최근 {n}회 평균 {fact}, 그 전 {n}회보다 {d} {word}. 최고점 이후 {weeks}주째 감소 구간입니다."
      : "최근 {n}회 평균 {fact}, 그 전 {n}회보다 {d} {word}.",
    detail: {
      trigger: `${fmtNum(a, 1)}kg`,
      n: "7",
      d: `${fmtNum(Math.abs(d), 1)}kg`,
      word: d < 0 ? "낮아요" : "높아요",
      weeks: String(weeks),
    },
    rows: [
      {
        label: "최근 7회 평균",
        value: `${fmtNum(a, 1)}kg · ${md(last7[0].date)}–${md(last7[6].date)}`,
      },
      {
        label: "그 전 7회 평균",
        value: `${fmtNum(b, 1)}kg · ${md(prev7[0].date)}–${md(prev7[6].date)}`,
      },
      {
        label: "최고점",
        value: `${fmtNum(view.peak.weight, 1)}kg · ${md(view.peak.date)} (${weeks}주 전)`,
      },
      { label: "출처", value: `Withings 체중계 · 측정 ${view.points.length}일` },
    ],
  };
}

/** Steps × places visited over the correlation window (today excluded). */
export function stepsVisitsFact(
  days: readonly ActivityCorrelationDay[] | null | undefined,
  today: string
): Fact | null {
  const rows = (days ?? []).filter((d) => d.day < today && d.steps != null);
  if (rows.length < 7) return null;
  const r = pearson(
    rows.map((d) => d.steps as number),
    rows.map((d) => d.visits)
  );
  if (r == null || r < 0.5) return null;
  const top = rows.reduce((a, b) => ((b.steps as number) > (a.steps as number) ? b : a));
  const from = rows[0].day;
  const to = rows[rows.length - 1].day;
  return {
    id: "health.steps.visits",
    kind: "delta",
    metric: "steps",
    metricLabel: "걸음",
    period: { from, to, label: `최근 ${rows.length}일` },
    value: r,
    unit: "count",
    score: r,
    evidence: { kind: "range", from, to },
    template:
      "들른 장소가 많은 날 많이 걸었어요. 최근 {n}일 걸음과 장소 수의 상관 {fact}, 가장 많이 걸은 {top}엔 {topV}곳을 들렀습니다.",
    detail: {
      trigger: fmtNum(r, 2),
      n: String(rows.length),
      top: md(top.day),
      topV: String(top.visits),
    },
    rows: [
      { label: "기간", value: `${md(from)}–${md(to)} · ${rows.length}일 (오늘 제외)` },
      { label: "걸음 × 들른 장소 수", value: `피어슨 상관 ${fmtNum(r, 2)}` },
      {
        label: "가장 많이 걸은 날",
        value: `${md(top.day)} · ${fmtNum(top.steps as number)}걸음 · 장소 ${top.visits}곳`,
      },
      { label: "출처", value: "Fitbit 걸음 · OwnTracks 방문" },
    ],
  };
}

const isWeekend = (iso: string) => {
  const w = new Date(Date.parse(`${toKstCalendarDate(new Date(iso))}T00:00:00Z`)).getUTCDay();
  return w === 0 || w === 6;
};

/** Workouts: one kind that repeats only on weekdays inside a tight time band. */
export function workoutFact(workouts: readonly HealthWorkout[]): Fact | null {
  const by = new Map<string, HealthWorkout[]>();
  for (const w of workouts) {
    const name = workoutName(w);
    by.set(name, [...(by.get(name) ?? []), w]);
  }
  const candidates = [...by.entries()]
    .filter(([, list]) => list.length >= 3 && list.every((w) => !isWeekend(w.start)))
    .sort((a, b) => b[1].length - a[1].length);
  const hit = candidates[0];
  if (!hit) return null;
  const [name, list] = hit;
  const times = list.map((w) => formatTime(new Date(w.start))).sort();
  const minutes = list.reduce((a, w) => a + w.minutes, 0);
  const keys = list.map((w) => w.start);
  const first = toKstCalendarDate(new Date(list[list.length - 1].start));
  const last = toKstCalendarDate(new Date(list[0].start));
  return {
    id: "health.workout.weekday",
    kind: "delta",
    metric: "exercise",
    metricLabel: name,
    period: { from: first, to: last, label: `${md(first)}–${md(last)}` },
    value: list.length,
    unit: "count",
    unitLabel: "회",
    score: Math.min(1, 0.4 + list.length / 10),
    evidence: { kind: "keys", keys },
    template: "{name} {fact}는 모두 평일 {t0}–{t1} 사이였어요.",
    detail: {
      trigger: `${list.length}회`,
      name,
      t0: times[0],
      t1: times[times.length - 1],
    },
    rows: [
      { label: name, value: `${list.length}회 · ${minutes}분` },
      {
        label: "시각",
        value: list
          .map(
            (w) =>
              `${formatMonthDay(toKstCalendarDate(new Date(w.start)))} ${formatTime(new Date(w.start))}`
          )
          .join(", "),
      },
      { label: "출처", value: "Fitbit 운동 기록" },
    ],
  };
}
