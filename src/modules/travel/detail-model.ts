/**
 * Pure view-model for /travel/[tripId]: the real departure/arrival window,
 * the itinerary (home/office stays folded into anchors, long stays split into
 * arrive/leave anchors, dense runs of short stops folded), the hero day, the
 * health table and the route split by day.
 */
import { toKstCalendarDate } from "@/lib/date-key";
import type { FactRow } from "@/lib/facts";
import { formatCount, formatDurationMinutes, formatTime, formatWon } from "@/lib/format";
import { distanceM } from "@/lib/geo";
import { CURATED_METRICS } from "@/modules/health/metrics-meta";
import { categoryLabel } from "./categories";
import type {
  TravelRoutePoint,
  TravelTripDetail,
  TravelTripTransaction,
  TravelTripVisit,
} from "./hooks";
import { dayCount, type TravelInsight, weekdayOf } from "./list-model";
import { isHomePlace, isRoutinePlace } from "./routine-places";

const MINUTE = 60_000;
/** A stay this long is lodging: it becomes "도착" and "출발" anchors. */
export const LODGING_MIN_SECONDS = 3 * 3600;
/** Dense run: at least this many short stops, back to back. */
export const DENSE_RUN_MIN_STOPS = 5;
const DENSE_RUN_MAX_STOP_SECONDS = 45 * 60;
const DENSE_RUN_MAX_GAP_MS = 40 * MINUTE;
/** A dense run stays within this radius of its centre (a walk, not a transfer chain). */
const DENSE_RUN_MAX_RADIUS_M = 2000;
/** Consecutive stays at the same place this close in time are one stay. */
const MERGE_GAP_MS = 15 * MINUTE;
const MERGE_DISTANCE_M = 150;

export function dateKeysBetween(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  const [y, m, d] = startDate.split("-").map(Number);
  const count = dayCount(startDate, endDate);
  for (let i = 0; i < count; i++) {
    keys.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  }
  return keys;
}

/** `9월 23일 (수)`. */
export function dayHead(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일 (${weekdayOf(key)})`;
}

/** `23일 (수)`. */
export function shortDay(key: string): string {
  return `${Number(key.slice(8))}일 (${weekdayOf(key)})`;
}

function kstDay(iso: string): string {
  return toKstCalendarDate(new Date(iso));
}

function time(iso: string): string {
  return formatTime(new Date(iso));
}

export function visitName(visit: TravelTripVisit): string {
  return (
    visit.savedPlaceName?.trim() ||
    visit.placeName?.trim() ||
    visit.address?.trim() ||
    "이름 없는 장소"
  );
}

function isRoutine(visit: TravelTripVisit): boolean {
  return isRoutinePlace(visit.savedPlaceName, visit.savedPlaceCategory);
}

function isHome(visit: TravelTripVisit): boolean {
  return isHomePlace(visit.savedPlaceName, visit.savedPlaceCategory);
}

/** Particle-free place word for anchors: saved place, else "숙소". */
function lodgingName(visit: TravelTripVisit): string {
  return visit.savedPlaceName?.trim() || "숙소";
}

/**
 * Joins back-to-back stays at one place — visits are cut at midnight, and a
 * café can be split in two by a GPS blip — so 본가 21:36–10:10 reads as one stay.
 */
export function mergeVisits(visits: TravelTripVisit[]): TravelTripVisit[] {
  const sorted = [...visits].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const merged: TravelTripVisit[] = [];
  for (const visit of sorted) {
    const prev = merged.at(-1);
    const samePlace =
      prev &&
      (prev.savedPlaceName && visit.savedPlaceName
        ? prev.savedPlaceName === visit.savedPlaceName
        : visitName(prev) === visitName(visit) &&
          distanceM(prev.centerLat, prev.centerLon, visit.centerLat, visit.centerLon) <=
            MERGE_DISTANCE_M);
    if (
      prev &&
      samePlace &&
      Date.parse(visit.startTime) - Date.parse(prev.endTime) <= MERGE_GAP_MS
    ) {
      const endTime = visit.endTime > prev.endTime ? visit.endTime : prev.endTime;
      merged[merged.length - 1] = {
        ...prev,
        endTime,
        durationSeconds: Math.round((Date.parse(endTime) - Date.parse(prev.startTime)) / 1000),
      };
    } else {
      merged.push(visit);
    }
  }
  return merged;
}

function compact(stops: TravelTripVisit[]): boolean {
  const lat = stops.reduce((sum, s) => sum + s.centerLat, 0) / stops.length;
  const lon = stops.reduce((sum, s) => sum + s.centerLon, 0) / stops.length;
  return stops.every(
    (s) => distanceM(lat, lon, s.centerLat, s.centerLon) <= DENSE_RUN_MAX_RADIUS_M
  );
}

// ── real trip window ─────────────────────────────────────────────────────────

export interface TripWindow {
  /** When the trip actually started: leaving home, else the first stop. */
  departAt: string | null;
  departFromHome: boolean;
  arriveAt: string | null;
  arriveHome: boolean;
  minutes: number | null;
}

export function tripWindow(visits: TravelTripVisit[]): TripWindow {
  const sorted = mergeVisits(visits);
  const firstAway = sorted.findIndex((v) => !isRoutine(v));
  if (firstAway < 0) {
    return {
      departAt: null,
      departFromHome: false,
      arriveAt: null,
      arriveHome: false,
      minutes: null,
    };
  }
  let lastAway = firstAway;
  sorted.forEach((v, i) => {
    if (!isRoutine(v)) lastAway = i;
  });
  const homeBefore = sorted.slice(0, firstAway).filter(isHome).at(-1);
  const homeAfter = sorted.slice(lastAway + 1).find(isHome);
  const departAt = homeBefore?.endTime ?? sorted[firstAway].startTime;
  const arriveAt = homeAfter?.startTime ?? sorted[lastAway].endTime;
  return {
    departAt,
    departFromHome: !!homeBefore,
    arriveAt,
    arriveHome: !!homeAfter,
    minutes: Math.round((Date.parse(arriveAt) - Date.parse(departAt)) / MINUTE),
  };
}

// ── itinerary ────────────────────────────────────────────────────────────────

export type ItineraryItem =
  | {
      kind: "anchor";
      key: string;
      at: string;
      label: string;
      note?: string;
    }
  | {
      kind: "stop";
      key: string;
      at: string;
      /** When the stay ended (used to merge a station transfer into one row). */
      endAt?: string;
      name: string;
      minutes: number;
      note?: string;
    }
  | {
      kind: "run";
      key: string;
      at: string;
      run: DenseRun;
    };

export interface DenseRun {
  id: string;
  day: string;
  startAt: string;
  endAt: string;
  minutes: number;
  label: string;
  stops: { at: string; name: string; minutes: number; lat: number; lon: number }[];
}

export interface ItineraryDay {
  day: string;
  head: string;
  /** "서울 → 대전", or the day's main city. */
  sub: string;
  items: ItineraryItem[];
}

export interface Itinerary {
  days: ItineraryDay[];
  skippedRoutine: number;
  runs: DenseRun[];
}

function regionWord(visit: TravelTripVisit): string | null {
  // Korean addresses read "대전 동구 세천동 산 76-3": the third token is the
  // neighbourhood, which names a walk better than any single stop.
  const tokens = (visit.address ?? "").split(/\s+/).filter(Boolean);
  const dong = tokens.find((t, i) => i >= 1 && /[동읍면리가]$/u.test(t));
  return dong ?? visit.city ?? null;
}

const LANDMARK_WORD = /^[가-힣]{1,6}(?:산|공원|숲|오름|계곡|해변|해수욕장|호수|폭포)$/u;

/**
 * A named landmark the walk was on — "식장산 무장애나눔길" (관광명소) → 식장산.
 * Only a stop the geocoder tagged as a sight counts, and a word that is the
 * address's own city ("부산 …") is not a landmark.
 */
function landmarkOf(stops: TravelTripVisit[]): string | null {
  for (const stop of stops) {
    if (stop.category !== "관광명소" || !stop.placeName) continue;
    const city = (stop.address ?? "").split(/\s+/)[0] ?? "";
    const word = stop.placeName
      .trim()
      .split(/\s+/)
      .find((t) => LANDMARK_WORD.test(t));
    if (word && !city.startsWith(word)) return word;
  }
  return null;
}

function runLabel(stops: TravelTripVisit[]): string {
  const landmark = landmarkOf(stops);
  if (landmark) return landmark.endsWith("산") ? `${landmark} 산행` : `${landmark} 일대`;
  const counts = new Map<string, number>();
  for (const stop of stops) {
    const word = regionWord(stop);
    if (word) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `${best[0]} 일대` : `${visitName(stops[0])} 일대`;
}

function findRuns(stops: TravelTripVisit[]): TravelTripVisit[][] {
  const runs: TravelTripVisit[][] = [];
  let current: TravelTripVisit[] = [];
  const flush = () => {
    if (current.length >= DENSE_RUN_MIN_STOPS && compact(current)) runs.push(current);
    current = [];
  };
  for (const stop of stops) {
    const short = stop.durationSeconds <= DENSE_RUN_MAX_STOP_SECONDS;
    const prev = current.at(-1);
    const close =
      prev &&
      kstDay(prev.startTime) === kstDay(stop.startTime) &&
      Date.parse(stop.startTime) - Date.parse(prev.endTime) <= DENSE_RUN_MAX_GAP_MS;
    if (!short) {
      flush();
      continue;
    }
    if (prev && !close) flush();
    current.push(stop);
  }
  flush();
  return runs;
}

function spendNote(
  visit: TravelTripVisit,
  transactions: TravelTripTransaction[]
): string | undefined {
  const start = Date.parse(visit.startTime) - 5 * MINUTE;
  const end = Date.parse(visit.endTime) + 10 * MINUTE;
  const hit = transactions.find((tx) => {
    const at = Date.parse(tx.transactedAt);
    return at >= start && at <= end;
  });
  return hit ? `${time(hit.transactedAt)} ${hit.merchant} ${formatWon(hit.amount)}` : undefined;
}

export function buildItinerary(detail: TravelTripDetail): Itinerary {
  const { trip, visits, spending } = detail;
  const sorted = mergeVisits(visits);
  const window = tripWindow(sorted);
  const items: ItineraryItem[] = [];
  let skippedRoutine = 0;

  const awayStops = sorted.filter((v) => !isRoutine(v) && v.durationSeconds < LODGING_MIN_SECONDS);
  const rawRuns = findRuns(awayStops);
  const runs = rawRuns.map<DenseRun>((stops) => ({
    id: stops[0].id,
    day: kstDay(stops[0].startTime),
    startAt: stops[0].startTime,
    endAt: stops.at(-1)?.endTime ?? stops[0].endTime,
    minutes: Math.round(
      (Date.parse(stops.at(-1)?.endTime ?? stops[0].endTime) - Date.parse(stops[0].startTime)) /
        MINUTE
    ),
    label: runLabel(stops),
    stops: stops.map((s) => ({
      at: s.startTime,
      name: visitName(s),
      minutes: Math.round(s.durationSeconds / 60),
      lat: s.centerLat,
      lon: s.centerLon,
    })),
  }));
  const runOf = new Map<string, DenseRun>();
  runs.forEach((run, i) => {
    for (const stop of rawRuns[i]) runOf.set(stop.id, run);
  });

  for (const visit of sorted) {
    if (isRoutine(visit)) {
      if (isHome(visit) && window.departFromHome && visit.endTime === window.departAt) {
        items.push({
          kind: "anchor",
          key: `${visit.id}-out`,
          at: visit.endTime,
          label: "집에서 출발",
        });
      } else if (isHome(visit) && window.arriveHome && visit.startTime === window.arriveAt) {
        items.push({
          kind: "anchor",
          key: `${visit.id}-in`,
          at: visit.startTime,
          label: "집 도착",
        });
      } else {
        skippedRoutine += 1;
      }
      continue;
    }
    const run = runOf.get(visit.id);
    if (run) {
      if (run.id === visit.id)
        items.push({ kind: "run", key: `run-${run.id}`, at: run.startAt, run });
      continue;
    }
    if (visit.durationSeconds >= LODGING_MIN_SECONDS) {
      const name = lodgingName(visit);
      const sameDay = kstDay(visit.startTime) === kstDay(visit.endTime);
      const endKey = kstDay(visit.endTime);
      const until = sameDay
        ? `${time(visit.endTime)}까지`
        : `${endKey === dateKeysBetween(kstDay(visit.startTime), endKey)[1] ? "이튿날" : `${Number(endKey.slice(8))}일`} ${time(visit.endTime)}까지`;
      const placeDetail = visit.savedPlaceName
        ? visit.city
          ? shortCity(visit.city)
          : null
        : visitName(visit);
      items.push({
        kind: "anchor",
        key: `${visit.id}-in`,
        at: visit.startTime,
        label: `${name} 도착`,
        note: [placeDetail, until].filter(Boolean).join(" · "),
      });
      if (endKey <= trip.endDate && !sameDay) {
        items.push({
          kind: "anchor",
          key: `${visit.id}-out`,
          at: visit.endTime,
          label: `${name}에서 출발`,
          note: spendNote(visit, spending.transactions),
        });
      }
      continue;
    }
    items.push({
      kind: "stop",
      key: visit.id,
      at: visit.startTime,
      endAt: visit.endTime,
      name: visitName(visit),
      minutes: Math.round(visit.durationSeconds / 60),
      note: spendNote(visit, spending.transactions),
    });
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  const merged = mergeTransfers(items);
  items.length = 0;
  items.push(...merged);
  const days = dateKeysBetween(trip.startDate, trip.endDate).map<ItineraryDay>((day) => {
    const dayItems = items.filter((item) => kstDay(item.at) === day);
    const cities = sorted
      .filter((v) => kstDay(v.startTime) === day && v.city)
      .map((v) => v.city as string);
    const firstCity = cities[0];
    const lastCity = cities.at(-1);
    const dayRuns = runs.filter((run) => run.day === day);
    const sub =
      dayRuns.length > 0
        ? dayRuns[0].label
        : firstCity && lastCity && firstCity !== lastCity
          ? `${shortCity(firstCity)} → ${shortCity(lastCity)}`
          : firstCity
            ? shortCity(firstCity)
            : "";
    return { day, head: dayHead(day), sub, items: dayItems };
  });
  return { days: days.filter((d) => d.items.length > 0), skippedRoutine, runs };
}

/** "동작역 9호선" → { station: "동작역", line: "9호선" }; null for anything else. */
export function stationLine(name: string): { station: string; line: string | null } | null {
  const m = /^(\S+역)(?:\s+(\S+선))?(?:\s|$)/u.exec(name.trim());
  return m ? { station: m[1], line: m[2] ?? null } : null;
}

/**
 * The station a stop sits at, read off its name: "동작역 9호선" → 동작역, and a
 * station concession named after it — "위니비니 서울역사점" → 서울역, "공차
 * SRT수서역점" → 수서역, "엔제리너스 광명KTX점" → 광명역. Null otherwise.
 */
export function stationOf(name: string): string | null {
  const direct = stationLine(name);
  if (direct) return direct.station;
  for (const token of name.trim().split(/\s+/).slice(1)) {
    const inStation = /^(?:SRT|KTX)?([가-힣]{1,6}역)(?:사점|점)$/iu.exec(token);
    if (inStation) return inStation[1];
    const rail = /^([가-힣]{2,4})(?:KTX|SRT)(?:역)?점?$/iu.exec(token);
    if (rail) return `${rail[1]}역`;
  }
  return null;
}

const SRT_STATIONS = new Set(["수서역", "동탄역", "평택지제역"]);
const KTX_STATIONS = new Set(["서울역", "용산역", "광명역", "행신역"]);

/**
 * The high-speed rail service a day's journey used, read off the stations it
 * stopped at (수서 is SRT-only, 서울/광명 KTX-only) or a "SRT"/"KTX" in a stop
 * name. Null when the trip recorded no train mode or the stops don't say.
 */
export function railServiceOn(detail: TravelTripDetail, day: string): "KTX" | "SRT" | null {
  if (!detail.transport.modes.some((m) => m.mode === "train" && m.distanceMeters > 0)) return null;
  let srt = false;
  let ktx = false;
  for (const v of detail.visits) {
    if (kstDay(v.startTime) !== day) continue;
    const name = visitName(v);
    const station = stationOf(name);
    if (/SRT/iu.test(name) || (station && SRT_STATIONS.has(station))) srt = true;
    if (/KTX/iu.test(name) || (station && KTX_STATIONS.has(station))) ktx = true;
  }
  // An SRT-only station or SRT-named stop settles it; a "KTX" concession can sit
  // in a station both services stop at (대전KTX점), so it only counts alone.
  if (srt) return "SRT";
  return ktx ? "KTX" : null;
}

const TRANSFER_MAX_GAP_MS = 20 * MINUTE;

/**
 * Back-to-back stops at one station on two different lines are one transfer:
 * "동작역 9호선 6분" + "동작역 4호선 4분" → "동작역 13분 · 9호선 → 4호선 환승".
 */
export function mergeTransfers(items: ItineraryItem[]): ItineraryItem[] {
  const out: ItineraryItem[] = [];
  /** Lines ridden so far, for the stop at the same index in `out`. */
  const linesAt = new Map<number, string[]>();
  for (const item of items) {
    const i = out.length - 1;
    const prev = out[i];
    if (item.kind === "stop" && prev?.kind === "stop") {
      const a = stationLine(prev.name);
      const b = stationLine(item.name);
      const lines = linesAt.get(i) ?? (a?.line ? [a.line] : []);
      const prevEnd = prev.endAt ?? prev.at;
      if (
        a &&
        b?.line &&
        a.station === b.station &&
        lines.length > 0 &&
        !lines.includes(b.line) &&
        kstDay(prev.at) === kstDay(item.at) &&
        Date.parse(item.at) - Date.parse(prevEnd) <= TRANSFER_MAX_GAP_MS
      ) {
        const endAt = item.endAt ?? item.at;
        const next = [...lines, b.line];
        linesAt.set(i, next);
        out[i] = {
          ...prev,
          endAt,
          name: a.station,
          minutes: Math.round((Date.parse(endAt) - Date.parse(prev.at)) / MINUTE),
          note: [
            `${next.join(" → ")} 환승`,
            ...(prev.note?.split(" · ").filter((part) => !part.endsWith(" 환승")) ?? []),
            item.note,
          ]
            .filter(Boolean)
            .join(" · "),
        };
        continue;
      }
    }
    out.push(item);
  }
  return out;
}

// ── route sketch labels ──────────────────────────────────────────────────────

export interface MapLabel {
  key: string;
  lat: number;
  lon: number;
  text: string;
  /** anchor = saved place (본가, 집), station = a transit stop on the way. */
  kind: "anchor" | "station";
}

/**
 * Labels for the route sketch: saved places the trip touched and the transit
 * stations it passed ({@link stationOf}), never shop/POI names — those read as
 * noise at map scale ("위니비니 서울역사점" is labelled 서울역). One label per name, and
 * a place within ~300 m of an earlier one is the same marker.
 */
export function mapLabels(detail: TravelTripDetail): MapLabel[] {
  const labels: MapLabel[] = [];
  const add = (v: TravelTripVisit, text: string, kind: MapLabel["kind"]) => {
    if (labels.some((l) => l.text === text)) return;
    if (labels.some((l) => distanceM(l.lat, l.lon, v.centerLat, v.centerLon) < 300)) return;
    labels.push({ key: v.id, lat: v.centerLat, lon: v.centerLon, text, kind });
  };
  const sorted = [...detail.visits].sort((a, b) => b.durationSeconds - a.durationSeconds);
  // Home comes first: the itinerary opens with "집에서 출발", so when home and the
  // office sit close enough to share one marker at map scale, it is 집 the map
  // names, not whichever place the trip lingered at longer.
  const window = tripWindow(detail.visits);
  if (window.departFromHome || window.arriveHome) {
    for (const v of sorted) {
      if (isHome(v) && v.savedPlaceName?.trim()) add(v, v.savedPlaceName.trim(), "anchor");
    }
  }
  for (const v of sorted) {
    if (v.savedPlaceName?.trim()) add(v, v.savedPlaceName.trim(), "anchor");
  }
  for (const v of sorted) {
    if (v.savedPlaceName) continue;
    const station = stationOf(visitName(v));
    if (station) add(v, station, "station");
  }
  return labels;
}

/** "대전광역시" → "대전", "제주특별자치도" → "제주"; foreign names untouched. */
export function shortCity(city: string): string {
  return city.replace(/(특별자치시|특별자치도|특별시|광역시|자치도)$/u, "") || city;
}

// ── health ───────────────────────────────────────────────────────────────────

export interface HealthCell {
  value: number | null;
  text: string;
  /** Secondary line under the value (heart-rate range), so cells stay narrow. */
  sub?: string;
}

export interface HealthRow {
  key: string;
  label: string;
  unit: string;
  cells: HealthCell[];
}

/** Rows shown up front; everything else goes behind "다른 지표 N개". */
const PRIMARY_METRICS: { key: string; label: string; unit: string }[] = [
  { key: "steps", label: "걸음", unit: "" },
  { key: "active_zone_minutes", label: "활동 존", unit: "분" },
  { key: "resting_heart_rate", label: "안정 심박", unit: "bpm" },
];

function metricValue(row: TravelTripDetail["health"][number], agg: "sum" | "avg"): number | null {
  return agg === "sum" ? (row.valueSum ?? row.valueAvg) : (row.valueAvg ?? row.valueSum);
}

/** One fixed precision per row, so a column of days never mixes 2.9 / 5.68. */
function formatMetric(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "–";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Day-level travel table precision: walking distance reads in tenths of a km. */
const TABLE_DECIMALS: Record<string, number> = { distance: 1 };

export function healthTable(detail: TravelTripDetail): {
  days: string[];
  primary: HealthRow[];
  more: HealthRow[];
} {
  const days = dateKeysBetween(detail.trip.startDate, detail.trip.endDate);
  const byMetric = new Map<string, Map<string, TravelTripDetail["health"][number]>>();
  for (const row of detail.health) {
    const map = byMetric.get(row.metric) ?? new Map();
    map.set(row.day, row);
    byMetric.set(row.metric, map);
  }
  const build = (key: string, label: string, unit: string): HealthRow | null => {
    const meta = CURATED_METRICS.find((m) => m.key === key);
    const rows = byMetric.get(key);
    if (!meta || !rows) return null;
    const scale = meta.scale ?? 1;
    const decimals = TABLE_DECIMALS[key] ?? meta.decimals ?? 1;
    const cells = days.map((day) => {
      const row = rows.get(day);
      const raw = row ? metricValue(row, meta.agg) : null;
      const value = raw == null ? null : raw * scale;
      if (key === "heart_rate" && row?.valueMin != null && row.valueMax != null) {
        return {
          value,
          text: formatMetric(value, 0),
          sub: `${Math.round(row.valueMin)}–${Math.round(row.valueMax)}`,
        };
      }
      return { value, text: formatMetric(value, decimals) };
    });
    if (cells.every((c) => c.value == null)) return null;
    return { key, label, unit, cells };
  };
  const primary = PRIMARY_METRICS.map((m) => build(m.key, m.label, m.unit)).filter(
    (r): r is HealthRow => r !== null
  );
  const primaryKeys = new Set(PRIMARY_METRICS.map((m) => m.key));
  const more = CURATED_METRICS.filter((m) => !primaryKeys.has(m.key))
    .map((m) => build(m.key, m.key === "heart_rate" ? "평균 심박 · 범위" : m.label, m.unit))
    .filter((r): r is HealthRow => r !== null);
  return { days, primary, more };
}

// ── hero day ─────────────────────────────────────────────────────────────────

export interface HeroDay {
  day: string;
  steps: number;
  activeZoneMinutes: number | null;
  activeEnergy: number | null;
  /** Steps for every trip day (null when the day has none). */
  series: { day: string; steps: number | null }[];
  othersAverage: number;
  ratio: number;
  run: DenseRun | null;
  insight: TravelInsight;
}

/** The day with by far the most steps (≥ 1.5× the other days' mean), if any. */
export function pickHeroDay(detail: TravelTripDetail, runs: DenseRun[]): HeroDay | null {
  const days = dateKeysBetween(detail.trip.startDate, detail.trip.endDate);
  const value = (metric: string, day: string) => {
    const row = detail.health.find((r) => r.metric === metric && r.day === day);
    return row ? (row.valueSum ?? row.valueAvg) : null;
  };
  const series = days.map((day) => ({ day, steps: value("steps", day) }));
  const known = series.filter((s): s is { day: string; steps: number } => s.steps != null);
  if (known.length < 2) return null;
  const top = [...known].sort((a, b) => b.steps - a.steps)[0];
  const others = known.filter((s) => s.day !== top.day);
  const othersAverage = others.reduce((sum, s) => sum + s.steps, 0) / others.length;
  if (othersAverage <= 0 || top.steps < othersAverage * 1.5) return null;
  const ratio = top.steps / othersAverage;
  const run =
    runs.filter((r) => r.day === top.day).sort((a, b) => b.stops.length - a.stops.length)[0] ??
    null;
  const azm = value("active_zone_minutes", top.day);
  const otherAzm = others
    .map((s) => value("active_zone_minutes", s.day))
    .filter((v): v is number => v != null);
  const rows: FactRow[] = [
    { label: `걸음 · ${dayHead(top.day)}`, value: formatCount(top.steps) },
    {
      label: `걸음 · ${others.map((s) => shortDay(s.day)).join(" / ")}`,
      value: others.map((s) => formatCount(s.steps)).join(" / "),
    },
    {
      label: `다른 ${others.length}일 평균`,
      value: `${formatCount(othersAverage)} (×${ratio.toFixed(1)})`,
    },
  ];
  if (azm != null) {
    rows.push({
      label: `활동 존 분 · ${shortDay(top.day)}`,
      value: `${formatCount(azm)}${otherAzm.length ? ` (다른 날 ${otherAzm.map((v) => formatCount(v)).join(" / ")})` : ""}`,
    });
  }
  if (run) {
    rows.push({
      label: `${run.label} 방문 기록`,
      value: `${time(run.startAt)}–${time(run.endAt)} · ${run.stops.length}건`,
    });
  }
  const runClause = run
    ? ` — ${Number(time(run.startAt).slice(0, 2)) < 12 ? "오전" : "오후"} ${time(run.startAt)}부터 ${formatDurationMinutes(run.minutes)} 동안 ${run.stops.length}곳을 지났어요.`
    : "였어요.";
  return {
    day: top.day,
    steps: top.steps,
    activeZoneMinutes: azm,
    activeEnergy: value("active_energy", top.day),
    series,
    othersAverage,
    ratio,
    run,
    insight: {
      id: `travel.detail.hero.${top.day}`,
      score: Math.min(1, ratio / 3),
      pre: `다른 ${others.length === 1 ? "하루" : `${others.length}일`} 평균 ${formatCount(othersAverage)}걸음의 `,
      trigger: `${ratio.toFixed(1)}배`,
      post: runClause,
      rows,
      evidence: { kind: "keys", keys: [top.day] },
      source: "Google Health 일별 합계 · 위치 방문 기록",
    },
  };
}

// ── spending ─────────────────────────────────────────────────────────────────

export interface SpendingView {
  total: number;
  top: { label: string; total: number; share: number } | null;
  rest: number;
  oneOff: { id: string; share: number } | null;
}

export function spendingView(detail: TravelTripDetail): SpendingView {
  const { spending } = detail;
  const total = spending.total;
  const topCategory = spending.categories[0];
  const top =
    topCategory && total > 0 && spending.categories.length > 1
      ? {
          label: categoryLabel(topCategory.category),
          total: topCategory.total,
          share: topCategory.total / total,
        }
      : null;
  const biggest = [...spending.transactions].sort((a, b) => b.amount - a.amount)[0];
  const oneOff =
    biggest && total > 0 && spending.transactions.length > 1 && biggest.amount / total >= 0.5
      ? { id: biggest.id, share: biggest.amount / total }
      : null;
  return { total, top, rest: top ? total - top.total : 0, oneOff };
}

// ── route ────────────────────────────────────────────────────────────────────

export interface RouteDay {
  day: string;
  role: "out" | "back" | "middle";
  points: TravelRoutePoint[];
}

/** Route points split by KST day: first day out, last day back, the rest between. */
export function routeByDay(
  points: TravelRoutePoint[],
  startDate: string,
  endDate: string
): RouteDay[] {
  const days = dateKeysBetween(startDate, endDate);
  const sorted = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return days
    .map<RouteDay>((day, i) => ({
      day,
      role: i === 0 ? "out" : i === days.length - 1 ? "back" : "middle",
      points: sorted.filter((p) => kstDay(p.timestamp) === day),
    }))
    .filter((d) => d.points.length > 0);
}

// ── transport ────────────────────────────────────────────────────────────────

export const MODE_LABELS: Record<string, string> = {
  stationary: "정지",
  walking: "걷기",
  running: "달리기",
  cycling: "자전거",
  driving: "자동차",
  motorcycle: "오토바이",
  bus: "버스",
  transit: "대중교통",
  subway: "지하철",
  train: "기차",
  boat: "배",
  flying: "비행기",
  unknown: "분류 안 됨",
};

export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** The low-confidence warning, when a large part of the classified distance has no mode. */
export function transportInsight(detail: TravelTripDetail): TravelInsight | null {
  const total = detail.transport.totalDistanceMeters;
  const unknown = detail.transport.modes.find((m) => m.mode === "unknown");
  if (!unknown || total <= 0) return null;
  const share = unknown.distanceMeters / total;
  if (share < 0.15) return null;
  return {
    id: "travel.detail.transport.unknown",
    score: share,
    pre: "분류된 구간의 ",
    trigger: `${Math.round(share * 100)}%`,
    post: "는 수단을 알 수 없어요. 수단별 거리는 참고로만 보세요.",
    rows: [
      { label: "분류 안 됨 · 거리", value: `${(unknown.distanceMeters / 1000).toFixed(1)} km` },
      { label: "분류된 구간 전체", value: `${(total / 1000).toFixed(1)} km` },
      { label: "수단 가짓수", value: `${detail.transport.modes.length}가지` },
    ],
    source: "위치 기록의 이동 수단 자동 분류 · 정확도 낮음",
  };
}

// ── routine ──────────────────────────────────────────────────────────────────

export function routineInsight(detail: TravelTripDetail): TravelInsight | null {
  const { routine } = detail;
  const cmp = routine.comparison;
  if (!cmp || cmp.commitPercentChange == null || cmp.commitCount <= 0) return null;
  const change = cmp.commitPercentChange;
  const days = dayCount(detail.trip.startDate, detail.trip.endDate);
  return {
    id: "travel.detail.routine.commits",
    score: Math.min(1, Math.abs(change) / 50),
    pre: `여행 중 커밋 ${formatCount(routine.commitCount)}개 — 직전 ${days}일 ${formatCount(cmp.commitCount)}개보다 `,
    trigger: `${Math.abs(change)}%`,
    post: change === 0 ? " 차이 없이 같았어요." : change < 0 ? " 적었어요." : " 많았어요.",
    rows: [
      { label: `커밋 · 여행 ${days}일`, value: formatCount(routine.commitCount) },
      { label: `커밋 · 직전 ${days}일`, value: formatCount(cmp.commitCount) },
      {
        label: "코딩 시간 · 여행 / 직전",
        value: `${formatDurationMinutes(routine.codingSeconds / 60)} / ${formatDurationMinutes(cmp.codingSeconds / 60)}`,
      },
    ],
    source: "GitHub 커밋 · WakaTime 일별 합계",
  };
}
