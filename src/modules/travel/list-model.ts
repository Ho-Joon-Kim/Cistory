/**
 * Pure view-model for /travel: recurring-destination groups, the year hero,
 * the year ribbon and the highlight cards. Everything is computed from the API
 * rows — no names or thresholds tuned to one person's trips.
 */
import { dateKeyToUtcMillis } from "@/lib/date-key";
import { type FactEvidence, type FactRow, hasBatchim } from "@/lib/facts";
import { formatCount, formatDateRange, formatShare, formatWon } from "@/lib/format";
import type { TravelListSummary, TravelTripListItem } from "./hooks";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** A destination visited this often (in the loaded list) collapses into one row. */
export const RECURRING_MIN_TRIPS = 4;
/** …or this often when every trip shares the same saved place (e.g. 본가). */
export const RECURRING_MIN_ANCHORED_TRIPS = 3;

/**
 * One AI line: plain text around exactly one fact trigger, its popover rows and
 * the evidence the host lights up on hover. Numbers are computed here; the
 * sentence shapes are code templates (an LLM chooser could replace them later,
 * the numbers would still come from this object).
 */
export interface TravelInsight {
  id: string;
  score: number;
  pre: string;
  trigger: string;
  post: string;
  rows: FactRow[];
  evidence?: FactEvidence;
  source?: string;
}

function insight(
  id: string,
  score: number,
  sentence: string,
  trigger: string,
  rows: FactRow[],
  keys?: string[]
): TravelInsight {
  const [pre, post = ""] = sentence.split("{fact}");
  return {
    id,
    score,
    pre,
    trigger,
    post,
    rows,
    evidence: keys ? { kind: "keys", keys } : undefined,
  };
}

// ── small date helpers (KST date keys) ──────────────────────────────────────

function keyMillis(key: string): number {
  return dateKeyToUtcMillis(key) ?? 0;
}

/** Inclusive day count of a date-key range. */
export function dayCount(startDate: string, endDate: string): number {
  return Math.max(1, Math.round((keyMillis(endDate) - keyMillis(startDate)) / DAY_MS) + 1);
}

/** `2박 3일`, or `당일` for a single day. */
export function stayLabel(startDate: string, endDate: string): string {
  const days = dayCount(startDate, endDate);
  return days === 1 ? "당일" : `${days - 1}박 ${days}일`;
}

export function weekdayOf(key: string): string {
  return WEEKDAYS[new Date(keyMillis(key)).getUTCDay()];
}

/** `수–금` / `토`. */
export function weekdayRange(startDate: string, endDate: string): string {
  const a = weekdayOf(startDate);
  return startDate === endDate ? a : `${a}–${weekdayOf(endDate)}`;
}

/** `9월 5일–6일` without the year (rows sit under a year heading). */
export function rangeLabel(startDate: string, endDate: string): string {
  return formatDateRange(startDate, endDate, { now: new Date(keyMillis(startDate) + DAY_MS / 2) });
}

/** `9월 23일 (수)–25일 (금)` — the highlight-card form. */
export function rangeWithWeekdays(startDate: string, endDate: string): string {
  const [ys, ms, ds] = startDate.split("-").map(Number);
  const [ye, me, de] = endDate.split("-").map(Number);
  const head = `${ms}월 ${ds}일 (${weekdayOf(startDate)})`;
  if (startDate === endDate) return head;
  const tail = ys !== ye || ms !== me ? `${me}월 ${de}일` : `${de}일`;
  return `${head}–${tail} (${weekdayOf(endDate)})`;
}

/** Trip name without the detector's " 여행" suffix: "대전 여행" → "대전". */
export function destinationOf(trip: Pick<TravelTripListItem, "name">): string {
  const name = trip.name.trim();
  return name.replace(/\s*여행$/u, "") || name;
}

export function isSpendingRecorded(
  trip: Pick<TravelTripListItem, "endDate">,
  spendingSince: string | null
): boolean {
  return spendingSince !== null && trip.endDate >= spendingSince;
}

export function km(meters: number | null): number | null {
  return meters == null ? null : meters / 1000;
}

/** `3,338 km`, `0.3 km`, or `–` when the trip has no distance. */
export function formatKm(meters: number | null): string {
  const value = km(meters);
  if (value == null) return "–";
  if (value < 10) return `${(Math.round(value * 10) / 10).toLocaleString("ko-KR")} km`;
  return `${formatCount(value)} km`;
}

// ── recurring destinations ──────────────────────────────────────────────────

export interface RecurringGroup {
  key: string;
  destination: string;
  /** Shared saved place, e.g. "본가" (most trips' anchor), or null. */
  anchor: string | null;
  /** Newest first. */
  trips: TravelTripListItem[];
  firstStart: string;
  lastEnd: string;
  totalDays: number;
  totalMeters: number;
  totalVisits: number;
  spendTotal: number;
  spendRecordedCount: number;
  /** Most common departure weekday and how many trips left on it. */
  topWeekday: { weekday: string; count: number } | null;
}

function mostCommon<T>(values: T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * Splits a newest-first list into recurring-destination groups and the rest.
 * A destination recurs when it shows up {@link RECURRING_MIN_TRIPS} times, or
 * {@link RECURRING_MIN_ANCHORED_TRIPS} times around the same saved place.
 */
export function groupRecurring(
  trips: TravelTripListItem[],
  spendingSince: string | null
): { groups: RecurringGroup[]; rest: TravelTripListItem[] } {
  const byDestination = new Map<string, TravelTripListItem[]>();
  for (const trip of trips) {
    if (trip.isOverseas) continue;
    const key = destinationOf(trip);
    byDestination.set(key, [...(byDestination.get(key) ?? []), trip]);
  }

  const groups: RecurringGroup[] = [];
  const grouped = new Set<string>();
  for (const [destination, members] of byDestination) {
    const anchor = mostCommon(
      members.map((trip) => trip.anchorPlaceName).filter((name): name is string => !!name)
    );
    const anchored = anchor && anchor.count * 2 > members.length ? anchor : null;
    const recurs =
      members.length >= RECURRING_MIN_TRIPS ||
      (anchored !== null && members.length >= RECURRING_MIN_ANCHORED_TRIPS);
    if (!recurs) continue;

    const recorded = members.filter((trip) => isSpendingRecorded(trip, spendingSince));
    const weekday = mostCommon(members.map((trip) => weekdayOf(trip.startDate)));
    for (const trip of members) grouped.add(trip.id);
    groups.push({
      key: destination,
      destination,
      anchor: anchored?.value ?? null,
      trips: members,
      firstStart: members.map((t) => t.startDate).sort()[0],
      lastEnd:
        members
          .map((t) => t.endDate)
          .sort()
          .at(-1) ?? members[0].endDate,
      totalDays: members.reduce((sum, t) => sum + dayCount(t.startDate, t.endDate), 0),
      totalMeters: members.reduce((sum, t) => sum + (t.totalDistanceMeters ?? 0), 0),
      totalVisits: members.reduce((sum, t) => sum + t.visitCount, 0),
      spendTotal: recorded.reduce((sum, t) => sum + t.totalSpending, 0),
      spendRecordedCount: recorded.length,
      topWeekday: weekday ? { weekday: weekday.value, count: weekday.count } : null,
    });
  }

  groups.sort((a, b) => b.trips.length - a.trips.length || b.lastEnd.localeCompare(a.lastEnd));
  return { groups, rest: trips.filter((trip) => !grouped.has(trip.id)) };
}

export function groupLabel(group: Pick<RecurringGroup, "destination" | "anchor">): string {
  return group.anchor ? `${group.destination} · ${group.anchor}` : group.destination;
}

/** Trips per start year, newest year first, each list newest first. */
export function byYear(
  trips: TravelTripListItem[]
): { year: number; trips: TravelTripListItem[] }[] {
  const years = new Map<number, TravelTripListItem[]>();
  for (const trip of trips) {
    const year = Number(trip.startDate.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), trip]);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, trips: list }));
}

// ── year hero ───────────────────────────────────────────────────────────────

export interface YearSummary {
  year: number;
  today: string;
  tripCount: number;
  /** Days spent on trips this year, up to today. */
  days: number;
  elapsedDays: number;
  overseas: string[];
  spendTotal: number;
  spendRecordedCount: number;
  spendMissingCount: number;
  spendingSince: string | null;
}

function overlapDays(start: string, end: string, from: string, to: string): number {
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  return a > b ? 0 : dayCount(a, b);
}

export function summarizeYear(summary: TravelListSummary, today: string): YearSummary {
  const yearStart = `${summary.year}-01-01`;
  const yearEnd = `${summary.year}-12-31`;
  const until = today < yearEnd ? today : yearEnd;
  const recorded = summary.trips.filter((t) => isSpendingRecorded(t, summary.spendingSince));
  return {
    year: summary.year,
    today,
    tripCount: summary.trips.length,
    days: summary.trips.reduce(
      (sum, t) => sum + overlapDays(t.startDate, t.endDate, yearStart, until),
      0
    ),
    elapsedDays: dayCount(yearStart, until),
    overseas: [...new Set(summary.trips.filter((t) => t.isOverseas).map(destinationOf))],
    spendTotal: recorded.reduce((sum, t) => sum + t.totalSpending, 0),
    spendRecordedCount: recorded.length,
    spendMissingCount: summary.trips.length - recorded.length,
    spendingSince: summary.spendingSince,
  };
}

/**
 * The year line's one interpretation: how much of the year one recurring
 * destination took. Needs at least two trips there and a quarter of the year's
 * trips; otherwise there is nothing worth saying.
 */
export function yearRecurringFact(
  summary: TravelListSummary,
  groups: RecurringGroup[],
  today: string
): TravelInsight | null {
  const yearStart = `${summary.year}-01-01`;
  const until = today < `${summary.year}-12-31` ? today : `${summary.year}-12-31`;
  let best: TravelInsight | null = null;
  for (const group of groups) {
    const inYear = summary.trips.filter((trip) => destinationOf(trip) === group.destination);
    if (inYear.length < 2 || inYear.length * 4 < summary.trips.length) continue;
    const share = inYear.length / summary.trips.length;
    const days = inYear.reduce(
      (sum, t) => sum + overlapDays(t.startDate, t.endDate, yearStart, until),
      0
    );
    const allDays = summary.trips.reduce(
      (sum, t) => sum + overlapDays(t.startDate, t.endDate, yearStart, until),
      0
    );
    const label = groupLabel(group);
    const spoken = group.anchor ? `${group.destination} ${group.anchor}` : group.destination;
    const wd = group.topWeekday;
    const weekdayClause =
      wd && wd.count >= 3 && wd.count * 2 > group.trips.length
        ? ` ${group.anchor ?? group.destination}행 ${group.trips.length}번 중 ${wd.count}번은 ${wd.weekday}요일에 출발했어요.`
        : "";
    const rows: FactRow[] = [
      {
        label: `${summary.year}년 여행 · ${label}`,
        value: `${inYear.length} / ${summary.trips.length}회`,
      },
      { label: "그 여행의 일수", value: `${days} / ${allDays}일` },
      {
        label: `${label} 제외`,
        value: `${summary.trips.length - inYear.length}회 · ${allDays - days}일`,
      },
    ];
    if (wd) {
      rows.push({
        label: `출발 요일 (최근 ${group.trips.length}회)`,
        value: `${wd.weekday} ${wd.count}`,
      });
    }
    const fact = insight(
      `travel.year.recurring.${group.key}`,
      Math.min(1, 0.4 + share),
      `${formatCount(summary.trips.length)}번 중 {fact}(${formatCount(days)}일)이 ${spoken}${hasBatchim(spoken) ? "이었어요" : "였어요"} — 빼면 ${formatCount(summary.trips.length - inYear.length)}번, ${formatCount(allDays - days)}일.${weekdayClause}`,
      `${inYear.length}번`,
      rows,
      inYear.map((t) => t.id)
    );
    if (!best || fact.score > best.score) best = fact;
  }
  return best;
}

// ── ribbon ──────────────────────────────────────────────────────────────────

export interface RibbonSpan {
  id: string;
  name: string;
  /** Fractions of the year, 0..1. */
  from: number;
  to: number;
  range: string;
  stay: string;
}

export function ribbonSpans(summary: TravelListSummary): RibbonSpan[] {
  const yearStart = keyMillis(`${summary.year}-01-01`);
  const yearDays = dayCount(`${summary.year}-01-01`, `${summary.year}-12-31`);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return summary.trips.map((trip) => ({
    id: trip.id,
    name: destinationOf(trip),
    from: clamp((keyMillis(trip.startDate) - yearStart) / DAY_MS / yearDays),
    to: clamp(((keyMillis(trip.endDate) - yearStart) / DAY_MS + 1) / yearDays),
    range: rangeLabel(trip.startDate, trip.endDate),
    stay: stayLabel(trip.startDate, trip.endDate),
  }));
}

/** Position of a date key in its year, 0..1 (start of that day). */
export function yearFraction(year: number, key: string): number {
  const yearDays = dayCount(`${year}-01-01`, `${year}-12-31`);
  return (keyMillis(key) - keyMillis(`${year}-01-01`)) / DAY_MS / yearDays;
}

// ── highlights ──────────────────────────────────────────────────────────────

export interface Highlight {
  trip: TravelTripListItem;
  tag: string;
  spendLabel: string;
  fact: TravelInsight | null;
}

/**
 * Up to two notable trips of the year: the farthest (by GPS distance), the one
 * with the most recorded spending, and — if one of those coincides — the
 * longest. Each card carries one interpretation when it clears the bar.
 */
export function pickHighlights(summary: TravelListSummary): Highlight[] {
  const trips = summary.trips;
  if (trips.length < 2) return [];
  const highlights: Highlight[] = [];
  const used = new Set<string>();
  const totalMeters = trips.reduce((sum, t) => sum + (t.totalDistanceMeters ?? 0), 0);
  const recorded = trips.filter(
    (t) => isSpendingRecorded(t, summary.spendingSince) && t.totalSpending > 0
  );
  const spendTotal = recorded.reduce((sum, t) => sum + t.totalSpending, 0);

  const farthest = [...trips]
    .filter((t) => (t.totalDistanceMeters ?? 0) > 0)
    .sort((a, b) => (b.totalDistanceMeters ?? 0) - (a.totalDistanceMeters ?? 0))[0];
  if (farthest && totalMeters > 0) {
    const share = (farthest.totalDistanceMeters ?? 0) / totalMeters;
    const others = trips.filter((t) => t.id !== farthest.id && !t.isOverseas);
    const avgVisits = others.length
      ? others.reduce((sum, t) => sum + t.visitCount, 0) / others.length
      : 0;
    const visitRatio = avgVisits > 0 ? farthest.visitCount / avgVisits : 0;
    const visitClause =
      visitRatio >= 1.5
        ? ` — 방문 ${formatCount(farthest.visitCount)}곳도 ${farthest.isOverseas ? "국내 " : ""}여행 평균의 ${visitRatio.toFixed(1)}배예요.`
        : ".";
    const days = dayCount(farthest.startDate, farthest.endDate);
    highlights.push({
      trip: farthest,
      tag: farthest.isOverseas ? "해외 · 가장 먼 여행" : "가장 먼 여행",
      spendLabel: farthest.isOverseas ? "Toss 결제 기록" : "지출",
      fact:
        share >= 0.2
          ? insight(
              `travel.highlight.farthest.${farthest.id}`,
              share,
              `올해 여행 이동 거리 ${formatCount(totalMeters / 1000)} km 중 {fact}가 이 ${days}일${visitClause}`,
              formatShare(share),
              [
                {
                  label: `${destinationOf(farthest)} 이동 거리`,
                  value: formatKm(farthest.totalDistanceMeters),
                },
                {
                  label: `${summary.year}년 ${trips.length}개 여행 합계`,
                  value: formatKm(totalMeters),
                },
                {
                  label: `${destinationOf(farthest)} 방문`,
                  value: `${formatCount(farthest.visitCount)}곳`,
                },
                ...(avgVisits > 0
                  ? [
                      {
                        label: `${farthest.isOverseas ? "국내 " : ""}${others.length}개 여행 평균 방문`,
                        value: `${avgVisits.toFixed(1)}곳`,
                      },
                    ]
                  : []),
              ],
              [farthest.id]
            )
          : null,
    });
    used.add(farthest.id);
  }

  const topSpend = [...recorded].sort((a, b) => b.totalSpending - a.totalSpending)[0];
  if (topSpend && !used.has(topSpend.id) && recorded.length >= 2) {
    const perDay = (t: TravelTripListItem) => t.totalSpending / dayCount(t.startDate, t.endDate);
    const byDaily = [...recorded].sort((a, b) => perDay(b) - perDay(a));
    const share = topSpend.totalSpending / spendTotal;
    const topDaily = byDaily[0].id === topSpend.id;
    const runnerUp = byDaily.find((t) => t.id !== topSpend.id);
    highlights.push({
      trip: topSpend,
      tag: "올해 가장 많이 쓴 여행",
      spendLabel: "지출",
      fact: topDaily
        ? insight(
            `travel.highlight.spend.${topSpend.id}`,
            0.6 + share / 2,
            `하루 {fact} — 지출 기록이 있는 ${recorded.length}개 여행 중 하루 지출이 가장 컸고, 올해 여행 지출의 ${formatShare(share)}예요.`,
            formatWon(perDay(topSpend)),
            [
              {
                label: `${destinationOf(topSpend)} 지출 ÷ ${dayCount(topSpend.startDate, topSpend.endDate)}일`,
                value: formatWon(perDay(topSpend)),
              },
              ...(runnerUp
                ? [
                    {
                      label: `다음으로 큰 하루 지출 (${destinationOf(runnerUp)})`,
                      value: formatWon(perDay(runnerUp)),
                    },
                  ]
                : []),
              { label: `${summary.year}년 여행 지출 합계`, value: formatWon(spendTotal) },
              { label: `${destinationOf(topSpend)} 비중`, value: formatShare(share) },
            ],
            [topSpend.id]
          )
        : insight(
            `travel.highlight.spend.${topSpend.id}`,
            share,
            `올해 여행 지출의 {fact} — 지출 기록이 있는 ${recorded.length}개 여행 중 가장 많아요.`,
            formatShare(share),
            [
              {
                label: `${destinationOf(topSpend)} 지출`,
                value: formatWon(topSpend.totalSpending),
              },
              { label: `${summary.year}년 여행 지출 합계`, value: formatWon(spendTotal) },
            ],
            [topSpend.id]
          ),
    });
    used.add(topSpend.id);
  }

  if (highlights.length < 2) {
    const longest = [...trips]
      .filter((t) => !used.has(t.id))
      .sort(
        (a, b) =>
          dayCount(b.startDate, b.endDate) - dayCount(a.startDate, a.endDate) ||
          b.endDate.localeCompare(a.endDate)
      )[0];
    if (longest && dayCount(longest.startDate, longest.endDate) >= 3) {
      highlights.push({ trip: longest, tag: "올해 가장 긴 여행", spendLabel: "지출", fact: null });
    }
  }
  return highlights.slice(0, 2);
}
