/**
 * Pure read-model for the /data-status redesign: per-source status, the shared
 * intensity scale, cell shapes, gap detection, severity order and the
 * template-first diagnosis facts. No React, no fetch — unit tested.
 */
import type { SourceStatus as BadgeStatus } from "@/components/ds/status";
import { dateKeyToUtcMillis, toKstCalendarDate } from "@/lib/date-key";
import { diagnosis } from "@/lib/facts/helpers";
import { hasBatchim } from "@/lib/facts/template";
import type { Fact, FactRow } from "@/lib/facts/types";
import { formatCount, formatDateRange, formatDateTime, formatMonthDay } from "@/lib/format";
import type { SourceId, SourceStatus } from "./types";

export const SOURCE_NAMES: Record<SourceId, { name: string; short: string; unit: string }> = {
  wakatime: { name: "WakaTime", short: "WakaTime", unit: "세션" },
  health: { name: "건강", short: "건강", unit: "샘플" },
  github: { name: "GitHub 커밋", short: "GitHub", unit: "커밋" },
  location: { name: "위치 기록", short: "위치", unit: "좌표" },
  toss: { name: "토스 알림", short: "토스", unit: "알림" },
  kis: { name: "KIS 자산", short: "KIS", unit: "스냅샷" },
  withings: { name: "Withings 체성분", short: "Withings", unit: "측정" },
};

/** Fixed display order of the hero meter (matches the source table's default). */
export const METER_ORDER: SourceId[] = [
  "wakatime",
  "health",
  "github",
  "location",
  "toss",
  "kis",
  "withings",
];

/**
 * Sources whose records should arrive every day while connected. A zero day
 * there is a 공백 (missing data); elsewhere (commits, weigh-ins, spending) a
 * zero day is plausibly just a day without activity.
 */
const EXPECTS_DAILY: ReadonlySet<SourceId> = new Set(["location", "health", "kis"]);

export type CellKind = "none" | "gap" | "fail" | "pending" | "checked";

export interface StatusCell {
  date: string;
  count: number;
  /** Shared intensity level 0..5 on a log10 scale (1 · 10 · 100 · 1천 · 1만+). */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  kind: CellKind;
  isToday: boolean;
}

export interface SourceView {
  source: SourceStatus;
  id: SourceId;
  name: string;
  status: BadgeStatus;
  cells: StatusCell[];
  total: number;
  gaps: string[];
  emptyDays: string[];
  /** Whole days since the last success, in KST calendar days (null: never). */
  daysSinceSuccess: number | null;
  severity: number;
}

/** One intensity scale for every source: 0, <10, <100, <1천, <1만, 1만+. */
export function intensityLevel(count: number): StatusCell["level"] {
  if (count <= 0) return 0;
  if (count < 10) return 1;
  if (count < 100) return 2;
  if (count < 1000) return 3;
  if (count < 10000) return 4;
  return 5;
}

export function badgeStatus(source: SourceStatus): BadgeStatus {
  if (!source.connected) return "disconnected";
  if (source.needsReauth) return "reauth";
  if (source.error) return "failed";
  if (source.stale) return "delayed";
  return "ok";
}

function dayDiff(fromKey: string, toKey: string): number {
  const a = dateKeyToUtcMillis(fromKey) ?? 0;
  const b = dateKeyToUtcMillis(toKey) ?? 0;
  return Math.round((b - a) / 86_400_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whether a connected source normally delivers something every day of the range. */
export function expectsDaily(source: SourceStatus, today: string): boolean {
  if (!EXPECTS_DAILY.has(source.id)) return false;
  const past = source.days.filter((d) => d.date < today);
  if (past.length < 5) return false;
  const nonZero = past.filter((d) => d.count > 0);
  return nonZero.length / past.length >= 0.7 && median(nonZero.map((d) => d.count)) >= 2;
}

const SEVERITY: Record<BadgeStatus, number> = {
  failed: 5,
  reauth: 4,
  delayed: 3,
  ok: 1,
  disconnected: 0,
};

export function buildSourceView(source: SourceStatus, now: Date = new Date()): SourceView {
  const today = toKstCalendarDate(now);
  const status = badgeStatus(source);
  const lastSuccessDay = source.lastSuccessAt
    ? toKstCalendarDate(new Date(source.lastSuccessAt))
    : null;
  const failing = status === "failed" || status === "reauth";
  const daily = source.connected && !failing && expectsDaily(source, today);
  const cells: StatusCell[] = source.days.map((day) => {
    let kind: CellKind = "none";
    if (day.state === "pending") kind = "pending";
    else if (day.state === "failed") kind = "fail";
    else if (day.state === "checked") kind = "checked";
    else if (day.count === 0 && failing && (lastSuccessDay === null || day.date > lastSuccessDay)) {
      kind = "fail";
    } else if (day.count === 0 && daily && day.date < today && day.state === "unknown") {
      kind = "gap";
    }
    return {
      date: day.date,
      count: day.count,
      level: kind === "gap" || kind === "fail" ? 0 : intensityLevel(day.count),
      kind,
      isToday: day.date === today,
    };
  });
  const gaps = cells.filter((c) => c.kind === "gap").map((c) => c.date);
  const emptyDays = cells
    .filter((c) => c.count === 0 && c.kind === "none" && !c.isToday)
    .map((c) => c.date);
  // Elapsed whole days, so it reads the same as "64일 전" next to it.
  const daysSinceSuccess = source.lastSuccessAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(source.lastSuccessAt)) / 86_400_000))
    : null;
  // Problems first; within a tier, sources with gaps, then busier sources.
  const severity = SEVERITY[status] * 10 + (gaps.length > 0 ? 2 : 0);
  return {
    source,
    id: source.id,
    name: SOURCE_NAMES[source.id]?.name ?? source.label,
    status,
    cells,
    total: source.days.reduce((sum, d) => sum + d.count, 0),
    gaps,
    emptyDays,
    daysSinceSuccess,
    severity,
  };
}

/** Rows sorted worst first; stable within a tier by the meter order. */
export function sortBySeverity(views: SourceView[]): SourceView[] {
  return [...views].sort(
    (a, b) =>
      b.severity - a.severity ||
      (a.status === "disconnected" ? 1 : 0) - (b.status === "disconnected" ? 1 : 0) ||
      METER_ORDER.indexOf(a.id) - METER_ORDER.indexOf(b.id)
  );
}

/** Collapses sorted date keys into runs: `10월 17–19일, 22일`. */
export function formatDateRuns(dates: string[], now: Date = new Date()): string {
  if (dates.length === 0) return "";
  const runs: [string, string][] = [];
  for (const date of [...dates].sort()) {
    const last = runs.at(-1);
    if (last && dayDiff(last[1], date) === 1) last[1] = date;
    else runs.push([date, date]);
  }
  let previousMonth = "";
  return runs
    .map(([from, to]) => {
      const month = from.slice(0, 7);
      const sameMonthAsPrev = month === previousMonth;
      previousMonth = to.slice(0, 7);
      const text = from === to ? formatMonthDay(from, { now }) : formatDateRange(from, to, { now });
      // Drop the repeated month: "10월 17–19일, 22일".
      return sameMonthAsPrev ? text.replace(/^(\d+년 )?\d+월 /, "") : text;
    })
    .join(", ");
}

export interface Hero {
  okCount: number;
  total: number;
  /** First line: "7개 중 6개 정상". */
  headline: string;
  /** Second line naming the worst source, or null when everything is fine. */
  subline: string | null;
  focus: SourceView | null;
  /** A different source with gaps worth a one-line mention under the meter. */
  gapNote: SourceView | null;
}

export function buildHero(views: SourceView[]): Hero {
  const sorted = sortBySeverity(views);
  const okCount = views.filter((v) => v.status === "ok").length;
  const problem = sorted.find((v) => v.severity >= 30) ?? null;
  const gapSource = sorted.find((v) => v.gaps.length > 0 && v !== problem) ?? null;
  const focus = problem ?? gapSource;
  let subline: string | null = null;
  if (problem) {
    const n = problem.daysSinceSuccess;
    if (problem.status === "failed") {
      subline = n && n > 0 ? `${problem.name} ${n}일째 동기화 실패` : `${problem.name} 동기화 실패`;
    } else if (problem.status === "reauth") {
      subline = `${problem.name} 다시 연결 필요`;
    } else {
      subline = n && n > 0 ? `${problem.name} ${n}일째 동기화 지연` : `${problem.name} 동기화 지연`;
    }
  } else if (gapSource) {
    subline = `${gapSource.name} 공백 ${gapSource.gaps.length}일`;
  }
  const connected = views.filter((v) => v.status !== "disconnected").length;
  const headline =
    okCount === views.length
      ? `${views.length}개 모두 정상`
      : connected < views.length && okCount === connected
        ? `연결된 ${connected}개 모두 정상`
        : `${views.length}개 중 ${okCount}개 정상`;
  return {
    okCount,
    total: views.length,
    headline,
    subline,
    focus,
    gapNote: problem ? gapSource : null,
  };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(dateKeyToUtcMillis(date) ?? 0).getUTCDay()];
}
const isWeekend = (date: string) => {
  const w = new Date(dateKeyToUtcMillis(date) ?? 0).getUTCDay();
  return w === 0 || w === 6;
};

function period(view: SourceView) {
  const days = view.source.days;
  return {
    from: days[0]?.date ?? "",
    to: days.at(-1)?.date ?? "",
    label: `최근 ${days.length}일`,
  };
}

/**
 * The diagnosis sentence for the focus panel. Failing/reauth/delayed sources
 * get a cause line; a gap source gets a recovery line. Always notable.
 */
export function focusFact(view: SourceView, all: SourceView[], now: Date = new Date()): Fact {
  const others = all.filter((v) => v.id !== view.id && v.status !== "disconnected");
  const othersOk = others.filter((v) => v.status === "ok").length;
  const last = view.source.lastSuccessAt ? new Date(view.source.lastSuccessAt) : null;
  const rows: FactRow[] = [
    {
      label: "마지막 성공",
      value: last
        ? `${formatDateTime(last, { now })} · ${view.daysSinceSuccess ?? 0}일 전`
        : "확인된 이력 없음",
    },
    {
      label: period(view).label,
      value: `${formatCount(view.total)}건${view.total === 0 ? ` · ${view.cells.length}일 모두 비어 있음` : ""}`,
    },
    {
      label: "다른 소스",
      value: `${others.length}개 중 ${othersOk}개 정상`,
    },
  ];
  if (view.source.error) rows.push({ label: "오류", value: view.source.error });

  if (view.status === "failed" || view.status === "reauth" || view.status === "delayed") {
    const cause =
      view.status === "reauth"
        ? "제공자가 인증을 거부했어요 — 다시 연결하면 동기화가 이어집니다."
        : view.source.canRecover
          ? "서버보다는 연결 권한이 만료됐거나 바뀌었을 가능성이 커요 — 연결을 확인한 뒤 재수집하면 이 기간을 다시 가져옵니다."
          : "연결 상태를 확인해 주세요.";
    const lead =
      othersOk === others.length && others.length > 0
        ? `다른 {others}개 소스는 정상인데 ${view.name}만 `
        : `${view.name}${hasBatchim(view.name) ? "은" : "는"} `;
    const what = !last
      ? " 성공한 기록이 없어요."
      : view.status === "delayed"
        ? " 동기화가 멈춰 있어요."
        : " 한 번도 성공하지 못했어요.";
    return diagnosis({
      id: `data-status.${view.id}.diagnosis`,
      metric: view.id,
      metricLabel: view.name,
      period: period(view),
      value: view.daysSinceSuccess ?? 0,
      unit: "days",
      template: `${lead}{fact}${what} ${cause}`,
      detail: {
        trigger: last ? `${formatMonthDay(last, { now })} 이후` : "지금까지",
        others: others.length,
      },
      rows,
    });
  }
  const runs = formatDateRuns(view.gaps, now);
  const medianCount = median(view.cells.filter((c) => c.count > 0).map((c) => c.count));
  return diagnosis({
    id: `data-status.${view.id}.gaps`,
    metric: view.id,
    metricLabel: view.name,
    period: period(view),
    value: view.gaps.length,
    unit: "days",
    template: view.source.canRecover
      ? "{runs}에 기록이 비어 있어요. 공백 {fact}은 재수집하면 수치 지표가 다시 들어와요."
      : "{runs}에 기록이 비어 있어요. 공백 {fact}은 서버에서 다시 가져올 수 없어 휴대폰 전송을 확인해야 해요.",
    detail: { runs },
    rows: [
      { label: "비어 있는 날", value: runs },
      { label: "하루 기록 중앙값", value: `${formatCount(medianCount)}건` },
      { label: "재수집", value: view.source.canRecover ? "가능" : "서버에서 불가" },
    ],
  });
}

/**
 * The per-row interpretation line. Gaps (expected-daily sources) explain what a
 * recovery brings back; activity sources with mostly-weekend empty days say
 * they look like rest days. Null when nothing is notable.
 */
export function rowFact(view: SourceView, now: Date = new Date()): Fact | null {
  if (view.status !== "ok" && view.status !== "delayed") return null;
  if (view.gaps.length > 0) return focusFact(view, [view], now);
  const empty = view.emptyDays;
  if (view.id !== "github" || empty.length < 2) return null;
  const weekend = empty.filter(isWeekend);
  if (weekend.length / empty.length < 0.5) return null;
  return diagnosis({
    id: `data-status.${view.id}.rest`,
    metric: view.id,
    metricLabel: view.name,
    period: period(view),
    value: empty.length,
    unit: "days",
    template: "기록 없는 {fact} 중 {weekend}일이 주말이에요 — 수집 문제가 아니라 쉰 날로 보여요.",
    detail: { weekend: weekend.length },
    rows: [
      {
        label: "기록 없는 날",
        value: empty.map((d) => `${formatMonthDay(d, { now })} (${weekdayOf(d)})`).join(" · "),
      },
      { label: "그중 주말", value: `${weekend.length}일` },
      {
        label: "동기화",
        value: view.source.error ? "오류 있음" : "오류 없음",
      },
    ],
  });
}

/** Row sub-line under the source name, with its tone. */
export function rowSubline(
  view: SourceView,
  now: Date = new Date()
): {
  text: string;
  tone: "gain" | "warn" | "ink3";
} {
  if (view.status === "disconnected") return { text: "연결 안 됨", tone: "ink3" };
  if (view.status === "failed" || view.status === "reauth") {
    const n = view.daysSinceSuccess;
    return {
      text:
        view.status === "reauth"
          ? "다시 연결 필요"
          : n !== null && n > 0
            ? `미동기화 ${n}일`
            : "동기화 실패",
      // One severity per state: re-authorization is the amber state everywhere
      // (badge, meter, strip), only a real failure is red.
      tone: view.status === "reauth" ? "warn" : "gain",
    };
  }
  if (view.gaps.length > 0) {
    return {
      text: `공백 ${view.gaps.length}일 · ${formatDateRuns(view.gaps, now)}`,
      tone: "warn",
    };
  }
  if (view.status === "delayed") return { text: "48시간 넘게 성공 없음", tone: "warn" };
  switch (view.id) {
    case "github":
      return { text: `커밋 없는 날 ${view.emptyDays.length}일`, tone: "ink3" };
    case "withings":
      return {
        text: `측정한 날 ${view.cells.filter((c) => c.count > 0).length}일`,
        tone: "ink3",
      };
    case "location":
      return { text: "OwnTracks", tone: "ink3" };
    case "toss":
      return { text: "MacroDroid", tone: "ink3" };
    case "kis":
      return { text: "한국투자증권", tone: "ink3" };
    case "health":
      return { text: "Google Health · Health Connect", tone: "ink3" };
    default:
      return { text: "코딩 세션", tone: "ink3" };
  }
}

/** The contiguous range a recovery should cover: the gap span, else the whole range. */
export function recoveryRange(view: SourceView): { from: string; to: string } {
  const days = view.source.days;
  if (view.status === "ok" && view.gaps.length > 0) {
    return { from: view.gaps[0], to: view.gaps.at(-1) ?? view.gaps[0] };
  }
  return { from: days[0]?.date ?? "", to: days.at(-1)?.date ?? "" };
}
