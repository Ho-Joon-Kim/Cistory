/**
 * Day view model for /dashboard — one KST day as a map-first list.
 *
 * Pure functions only (no React, no fetch): the page hands in what the existing
 * hooks return (stay points, tracks, commits, transactions, health) and gets back
 * the rows the list, the 24h strip and the map render, all keyed by the same row
 * ids so a selection or an AI line's evidence lights up the same thing in all
 * three places.
 */
import { dateKeyToUtcMillis } from "@/lib/date-key";
import { formatDurationMinutes, formatTime, formatWon } from "@/lib/format";
import type { HealthSleepSession, HealthWorkout, SleepStageSegment } from "@/modules/health/types";
import type { LocationData, StayPointData, TrackData } from "@/modules/location/hooks";
import { EXPENSE_CATEGORY_LABELS } from "@/modules/spending/categories";
import type { TransactionItem } from "@/modules/spending/hooks";
import type { TimelineCommit } from "./hooks";

export const DAY_MINUTES = 1440;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ── time helpers ─────────────────────────────────────────────────────────────

/** UTC millis of 00:00 KST on `date`. */
export function kstDayStartMs(date: string): number {
  const utcMidnight = dateKeyToUtcMillis(date);
  if (utcMidnight == null) throw new Error(`Invalid date key: ${date}`);
  return utcMidnight - KST_OFFSET_MS;
}

/** Minutes from 00:00 KST of `date` (may be negative or past 1440 for other days). */
export function minuteOfDay(iso: string, date: string): number {
  return (new Date(iso).getTime() - kstDayStartMs(date)) / 60_000;
}

const clampDay = (m: number) => Math.max(0, Math.min(DAY_MINUTES, m));

/** `08:43`; an instant outside the day clamps to `00:00` / `24:00`. */
function clockInDay(iso: string, date: string): string {
  const m = minuteOfDay(iso, date);
  if (m <= 0) return "00:00";
  if (m >= DAY_MINUTES) return "24:00";
  return formatTime(new Date(iso));
}

/** `14분 51초`, `2시간 3분`, `45초`. */
export function formatDurationSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}초`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}분 ${r}초` : `${m}분`;
  }
  return formatDurationMinutes(s / 60);
}

/** `184m`, `2.7km`, `77km`. */
export function formatMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  return km < 100 ? `${(Math.round(km * 10) / 10).toFixed(1)}km` : `${Math.round(km)}km`;
}

// ── labels ───────────────────────────────────────────────────────────────────

export const MODE_LABELS: Record<string, string> = {
  stationary: "정지",
  walking: "도보",
  running: "달리기",
  cycling: "자전거",
  driving: "차량",
  motorcycle: "오토바이",
  bus: "버스",
  train: "열차",
  subway: "지하철",
  flying: "비행",
  boat: "배",
  unknown: "이동",
};

/** `집 → 회사`, `→ 회사`, `집에서`, or "" when neither end is known. */
export function routeLabel(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`;
  if (to) return `→ ${to}`;
  if (from) return `${from}에서`;
  return "";
}

export function modeLabel(mode: string | null | undefined): string {
  return (mode && MODE_LABELS[mode]) || "이동";
}

const HANGUL = /[가-힣]/;

/** Rough bounding box of South Korea (mainland + Jeju + Ulleung). */
export function inKorea(lat: number, lon: number): boolean {
  return lat >= 33 && lat <= 38.9 && lon >= 124.5 && lon <= 131.9;
}

/**
 * Short area for a stay's sub line: Korean addresses keep their 구 and 동
 * (`강남구 논현동`); others keep the first two comma-separated parts. With
 * `korean: true` (a place inside Korea) a romanized fallback-geocoder address
 * (`Nonhyeon-dong, Gangnam-gu`) is hidden rather than shown in English.
 */
export function shortArea(
  address: string | null | undefined,
  opts: { korean?: boolean } = {}
): string {
  if (!address) return "";
  if (opts.korean && !HANGUL.test(address)) return "";
  if (HANGUL.test(address)) {
    const tokens = address.split(/\s+/);
    const gu = tokens.find((t) => /[가-힣](구|군)$/.test(t));
    const dong = tokens.find((t) => /[가-힣](동|읍|면|가|로|길)$/.test(t) && t !== gu);
    const city = tokens.find((t) => /[가-힣]시$/.test(t));
    const parts = [gu ?? city, dong].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : tokens.slice(0, 2).join(" ");
  }
  return address
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^\d+$/.test(p))
    .slice(0, 2)
    .join(", ");
}

export function stayName(sp: Pick<StayPointData, "placeName" | "address">): string {
  return sp.placeName?.trim() || shortArea(sp.address) || "이름 없는 장소";
}

// ── rows ─────────────────────────────────────────────────────────────────────

export interface RowFlagData {
  label: string;
  reason: string;
}

interface RowBase {
  id: string;
  /** Minutes from 00:00 KST, clamped to the day. */
  start: number;
  /** Left-column clock label. */
  time: string;
  /** 0 = place/ride (top level), 1 = something that happened during a stay. */
  depth: 0 | 1;
  /** Row the map highlights for this row (itself, or the stay it happened in). */
  mapId: string | null;
  flag?: RowFlagData;
  /** Happened while a ride was under way (the list keeps the ride's dashed rail). */
  onRide?: boolean;
}

export interface StayRow extends RowBase {
  kind: "stay";
  end: number;
  name: string;
  durationLabel: string;
  range: string;
  area: string;
  lat: number;
  lon: number;
  /** Ride this stay was a stop on (the track spans it), so the list nests it. */
  via?: string;
}

export interface RideSegmentView {
  mode: string;
  distance: string;
  duration: string;
  avg: string;
}

export interface RideRow extends RowBase {
  kind: "ride";
  end: number;
  startIso: string;
  endIso: string;
  mode: string;
  distanceM: number;
  distance: string;
  duration: string;
  range: string;
  from: string;
  to: string;
  avg: string | null;
  elevation: { up: number; down: number } | null;
  legs: string[];
  segments: RideSegmentView[];
  /** Stays the track passed through (it spans them), in order. */
  stops: string[];
}

export interface CommitLine {
  id: string;
  time: string;
  main: string;
  hasSummary: boolean;
  meta: string;
  diff: string;
  url: string | null;
}

export interface CommitClusterRow extends RowBase {
  kind: "commits";
  end: number;
  count: number;
  range: string;
  repo: string;
  repoFull: string;
  /** Representative AI summary (null → no AI line). */
  summary: string | null;
  /** How many commits in the cluster carry an AI summary. */
  summarized: number;
  additions: number;
  deletions: number;
  files: number;
  /** Plain fallback line when there is no AI summary. */
  plain: string;
  commits: CommitLine[];
}

export interface TxRow extends RowBase {
  kind: "tx";
  merchant: string;
  amount: string;
  amountValue: number;
  category: string;
}

export interface IncomeRow extends RowBase {
  kind: "income";
  label: string;
  amount: string;
  amountValue: number;
  note: string;
}

export interface SleepRow extends RowBase {
  kind: "sleep";
  asleepMin: number;
  inBedMin: number;
  asleep: string;
  inBed: string;
  range: string;
  efficiency: string | null;
  segments: SleepStageSegment[] | null;
  stages: { label: string; value: string }[] | null;
}

export type DayRow = StayRow | RideRow | CommitClusterRow | TxRow | IncomeRow | SleepRow;

// ── commits ──────────────────────────────────────────────────────────────────

/** Two commits in the same repo this close (minutes) belong to one cluster. */
export const CLUSTER_GAP_MIN = 30;

const GENERIC_SUMMARY = /사용자 영향 없음|내부 개선\s*\(/;

function firstLine(message: string): string {
  return message.split("\n")[0].trim();
}

/** `perf(api)` from `perf(api): …`, else "". */
function commitType(title: string): string {
  const m = /^([a-z]+(?:\([^)]*\))?)!?:\s/.exec(title);
  return m ? m[1] : "";
}

function stripType(title: string): string {
  return title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, "");
}

function completedSummary(c: TimelineCommit): string | null {
  const text = c.summary?.status === "completed" ? c.summary.summary?.trim() : null;
  return text || null;
}

/**
 * Clusters a day's commits per repository: consecutive commits in one repo with
 * gaps ≤ {@link CLUSTER_GAP_MIN} form one row. The representative AI summary is
 * the most substantial non-generic one (largest diff), else any summary.
 */
export function clusterCommits(commits: TimelineCommit[], date: string): CommitClusterRow[] {
  const sorted = [...commits].sort(
    (a, b) => new Date(a.committedAt).getTime() - new Date(b.committedAt).getTime()
  );
  const groups: TimelineCommit[][] = [];
  const open = new Map<string, TimelineCommit[]>();
  for (const c of sorted) {
    const repo = c.repository.fullName;
    const cur = open.get(repo);
    const last = cur?.at(-1);
    if (
      cur &&
      last &&
      (new Date(c.committedAt).getTime() - new Date(last.committedAt).getTime()) / 60_000 <=
        CLUSTER_GAP_MIN
    ) {
      cur.push(c);
    } else {
      const next = [c];
      groups.push(next);
      open.set(repo, next);
    }
  }
  groups.sort(
    (a, b) => new Date(a[0].committedAt).getTime() - new Date(b[0].committedAt).getTime()
  );

  return groups.map((group, i) => {
    const first = group[0];
    const last = group[group.length - 1];
    const start = clampDay(minuteOfDay(first.committedAt, date));
    const end = clampDay(minuteOfDay(last.committedAt, date));
    const t0 = clockInDay(first.committedAt, date);
    const t1 = clockInDay(last.committedAt, date);
    const summarized = group.filter((c) => completedSummary(c) != null);
    const specific = summarized.filter((c) => !GENERIC_SUMMARY.test(completedSummary(c) ?? ""));
    const pool = specific.length > 0 ? specific : summarized;
    const rep = [...pool].sort(
      (a, b) => b.additions + b.deletions - (a.additions + a.deletions)
    )[0];
    const repoFull = first.repository.fullName;
    const owner = repoFull.split("/")[0];
    const repoName = repoFull.split("/")[1] ?? repoFull;
    return {
      kind: "commits",
      id: `c${i}`,
      start,
      end,
      time: t0,
      depth: 1,
      mapId: null,
      count: group.length,
      range: t0 === t1 ? t0 : `${t0}–${t1}`,
      repo: repoName,
      repoFull,
      summary: rep ? completedSummary(rep) : null,
      summarized: summarized.length,
      additions: group.reduce((s, c) => s + c.additions, 0),
      deletions: group.reduce((s, c) => s + c.deletions, 0),
      files: group.reduce((s, c) => s + c.changedFilesCount, 0),
      plain: stripType(firstLine(last.message)),
      commits: group.map((c) => {
        const title = firstLine(c.message);
        const summary = completedSummary(c);
        const type = commitType(title);
        return {
          id: c.id,
          time: clockInDay(c.committedAt, date),
          main: summary ?? stripType(title),
          hasSummary: summary != null,
          meta: [type, summary ? stripType(title) : c.sha.slice(0, 7)].filter(Boolean).join(" · "),
          diff: c.isMergeCommit && c.additions + c.deletions === 0 ? "" : diffLabel(c),
          url: owner ? `https://github.com/${repoFull}/commit/${c.sha}` : null,
        };
      }),
    } satisfies CommitClusterRow;
  });
}

function diffLabel(c: TimelineCommit): string {
  return `+${c.additions.toLocaleString("ko-KR")} −${c.deletions.toLocaleString("ko-KR")}`;
}

// ── sleep ────────────────────────────────────────────────────────────────────

function sleepEndIso(s: HealthSleepSession): string {
  return new Date(new Date(s.start).getTime() + s.minutes * 60_000).toISOString();
}

/** Minutes asleep: the session minus its awake stage when stages exist. */
export function asleepMinutes(s: HealthSleepSession): number {
  return Math.max(0, s.minutes - (s.stages?.awake ?? 0));
}

/** The main (non-nap) night that ends on `date`, longest first. */
export function sleepForDay(
  sessions: HealthSleepSession[] | undefined,
  date: string
): HealthSleepSession | null {
  const ending = (sessions ?? []).filter((s) => {
    if (s.nap) return false;
    const end = minuteOfDay(sleepEndIso(s), date);
    return end > 0 && end <= DAY_MINUTES;
  });
  return ending.sort((a, b) => b.minutes - a.minutes)[0] ?? null;
}

// ── income / spending ────────────────────────────────────────────────────────

function txCategory(tx: TransactionItem): string {
  return tx.category ? EXPENSE_CATEGORY_LABELS[tx.category] : "미분류";
}

// ── tracks & workouts ────────────────────────────────────────────────────────

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** A recorded workout covering most of a ride (its name beats the GPS classifier). */
function matchingWorkout(track: TrackData, workouts: HealthWorkout[]): HealthWorkout | null {
  const t0 = new Date(track.startTime).getTime();
  const t1 = new Date(track.endTime).getTime();
  if (t1 <= t0) return null;
  let best: { w: HealthWorkout; share: number } | null = null;
  for (const w of workouts) {
    if (!w.name) continue;
    const w0 = new Date(w.start).getTime();
    const w1 = w0 + w.minutes * 60_000;
    const share = overlapMs(t0, t1, w0, w1) / Math.min(t1 - t0, Math.max(1, w1 - w0));
    if (share >= 0.5 && (!best || share > best.share)) best = { w, share };
  }
  return best?.w ?? null;
}

/**
 * Fastest speed a mode can plausibly reach (km/h). A recorded peak — or an
 * average — above it means the classifier probably picked the wrong mode
 * (a KTX ride labelled 자전거), so the row flags the mode rather than
 * advertising the speed.
 */
const MODE_MAX_KMH: Record<string, number> = {
  walking: 15,
  running: 30,
  cycling: 60,
  motorcycle: 200,
  driving: 200,
  bus: 130,
  subway: 130,
  train: 350,
  boat: 90,
};

function speedLabel(kmh: number | null | undefined): string | null {
  return kmh != null && Number.isFinite(kmh) && kmh > 0 ? `${kmh.toFixed(1)}km/h` : null;
}

/** The mode key a recorded workout stands for, so its speed can be checked too. */
const WORKOUT_TYPE_MODES: Record<string, string> = {
  WALKING: "walking",
  HIKING: "walking",
  RUNNING: "running",
  JOGGING: "running",
  BIKING: "cycling",
  CYCLING: "cycling",
};

function workoutModeKey(w: HealthWorkout): string {
  const byType = w.type ? WORKOUT_TYPE_MODES[w.type.toUpperCase()] : undefined;
  if (byType) return byType;
  const name = w.name ?? "";
  if (/걷기|도보|산책|하이킹|등산/.test(name)) return "walking";
  if (/달리기|러닝|조깅/.test(name)) return "running";
  if (/자전거|사이클/.test(name)) return "cycling";
  // Any other workout is still human-powered: hold it to the fastest of those.
  return "cycling";
}

/** How far (minutes) a stay may sit from a ride's end to name that end. */
const ENDPOINT_GAP_MIN = 10;

function rideFromTrack(track: TrackData, date: string, workouts: HealthWorkout[]): RideRow {
  const t0 = clockInDay(track.startTime, date);
  const t1 = clockInDay(track.endTime, date);
  const classified = modeLabel(track.dominantMode);
  const workout = matchingWorkout(track, workouts);
  const workoutName = workout?.name?.replace(/\s+/g, "") ?? null;
  const hours = track.durationSeconds / 3600;
  const avgKmh = hours > 0 ? track.distanceMeters / 1000 / hours : null;
  const maxKmh = Math.max(0, ...track.segments.map((s) => s.maxSpeedKmh ?? 0));
  const peak = Math.max(maxKmh, avgKmh ?? 0);
  const peakWord = maxKmh > (avgKmh ?? 0) ? "최고" : "평균";
  const implausibleFor = (key: string | null | undefined) =>
    !!key && MODE_MAX_KMH[key] != null && peak > MODE_MAX_KMH[key];

  // A workout relabel is only trusted when the track's speed fits that workout:
  // a "걷기" overlapping a 246km/h subway ride is a coincidence, not a match.
  const workoutPlausible = workout ? !implausibleFor(workoutModeKey(workout)) : false;
  const mode = workoutName && workoutPlausible ? workoutName : classified;

  let flag: RowFlagData | undefined;
  if (workout && workoutName && !workoutPlausible) {
    flag = {
      label: "수단 확인 필요",
      reason: `같은 시각 Google Health에 ${workout.name} ${workout.minutes}분이 있지만 ${peakWord} ${peak.toFixed(0)}km/h가 기록돼 다른 수단이었을 수 있어요.`,
    };
  } else if (workout && workoutName && workoutName !== classified) {
    flag = {
      label: "건강 기록과 일치",
      reason: `위치 분류는 ${classified}였지만 같은 시각 Google Health에 ${workout.name} ${workout.minutes}분(${formatTime(new Date(workout.start))})이 있어 ${workoutName}로 표시했어요.`,
    };
  } else if (implausibleFor(track.dominantMode)) {
    flag = {
      label: "수단 확인 필요",
      reason: `${classified}(으)로 분류됐지만 ${peakWord} ${peak.toFixed(0)}km/h가 기록돼 다른 수단이었을 수 있어요.`,
    };
  } else if (avgKmh && maxKmh >= 30 && maxKmh >= avgKmh * 3 && track.dominantMode !== "flying") {
    flag = {
      label: `최고 ${maxKmh.toFixed(1)}km/h`,
      reason: `평균 ${avgKmh.toFixed(1)}km/h의 ${(maxKmh / avgKmh).toFixed(1)}배 — 순간 GPS 튐일 수 있어요.`,
    };
  }

  const legs = track.segments.flatMap((s) =>
    s.subwayLegs.map((l) =>
      [
        l.lineName ?? l.lineRef,
        l.startStationName && l.endStationName
          ? `${l.startStationName} → ${l.endStationName}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    )
  );
  const elevation =
    track.elevationGain != null && track.elevationLoss != null && track.dominantMode !== "flying"
      ? { up: Math.round(track.elevationGain), down: Math.round(track.elevationLoss) }
      : null;

  return {
    kind: "ride",
    id: `r:${track.id}`,
    start: clampDay(minuteOfDay(track.startTime, date)),
    end: clampDay(minuteOfDay(track.endTime, date)),
    time: t0,
    depth: 0,
    mapId: `r:${track.id}`,
    flag,
    startIso: track.startTime,
    endIso: track.endTime,
    mode,
    distanceM: track.distanceMeters,
    distance: formatMeters(track.distanceMeters),
    duration: formatDurationSeconds(track.durationSeconds),
    range: `${t0}–${t1}`,
    from: track.startPlaceName || "",
    to: track.endPlaceName || "",
    avg: speedLabel(avgKmh),
    elevation,
    legs: legs.filter(Boolean),
    stops: [],
    segments:
      track.segments.length > 1
        ? track.segments.map((s) => ({
            mode: modeLabel(s.mode),
            distance: formatMeters(s.distanceMeters),
            duration: formatDurationSeconds(s.durationSeconds),
            avg: speedLabel(s.avgSpeedKmh) ?? "",
          }))
        : [],
  };
}

// ── movement without persisted tracks (today) ────────────────────────────────

function haversineM(a: LocationData, b: LocationData): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Movement shorter than this is GPS drift between stays, not a ride. */
export const MIN_RIDE_METERS = 300;

/**
 * Rides derived from raw points between consecutive stays — used when the
 * nightly pipeline hasn't persisted tracks for the day yet (today).
 */
export function ridesFromGaps(
  locations: LocationData[],
  stays: StayPointData[],
  date: string
): RideRow[] {
  const sorted = [...stays].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const windows: {
    from: StayPointData | null;
    to: StayPointData | null;
    t0: number;
    t1: number;
  }[] = [];
  for (let i = 0; i <= sorted.length; i++) {
    const prev = sorted[i - 1] ?? null;
    const next = sorted[i] ?? null;
    const t0 = prev ? new Date(prev.endTime).getTime() : Number.NEGATIVE_INFINITY;
    const t1 = next ? new Date(next.startTime).getTime() : Number.POSITIVE_INFINITY;
    if (t1 > t0) windows.push({ from: prev, to: next, t0, t1 });
  }
  const rides: RideRow[] = [];
  for (const w of windows) {
    const pts = locations.filter((l) => {
      const t = new Date(l.timestamp).getTime();
      return t >= w.t0 && t <= w.t1;
    });
    if (pts.length < 2) continue;
    let meters = 0;
    for (let i = 1; i < pts.length; i++) meters += haversineM(pts[i - 1], pts[i]);
    if (meters < MIN_RIDE_METERS) continue;
    const startIso = pts[0].timestamp;
    const endIso = pts[pts.length - 1].timestamp;
    const seconds = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
    const t0 = clockInDay(startIso, date);
    const t1 = clockInDay(endIso, date);
    const id = `r:gap-${startIso}`;
    rides.push({
      kind: "ride",
      id,
      start: clampDay(minuteOfDay(startIso, date)),
      end: clampDay(minuteOfDay(endIso, date)),
      time: t0,
      depth: 0,
      mapId: id,
      startIso,
      endIso,
      mode: "이동",
      distanceM: meters,
      distance: formatMeters(meters),
      duration: formatDurationSeconds(seconds),
      range: `${t0}–${t1}`,
      from: w.from ? stayName(w.from) : "",
      to: w.to ? stayName(w.to) : "현재 위치",
      avg: speedLabel(seconds > 0 ? meters / 1000 / (seconds / 3600) : null),
      elevation: null,
      legs: [],
      segments: [],
      stops: [],
    });
  }
  return rides;
}

// ── assembly ─────────────────────────────────────────────────────────────────

export interface DayInput {
  date: string;
  stayPoints: StayPointData[];
  tracks: TrackData[];
  locations: LocationData[];
  commits: TimelineCommit[];
  transactions: TransactionItem[];
  sleep: HealthSleepSession | null;
  /** Recent main nights (incl. this one) for the sleep record flag. */
  recentSleeps: HealthSleepSession[];
  workouts: HealthWorkout[];
}

export interface DayModel {
  rows: DayRow[];
  stays: StayRow[];
  rides: RideRow[];
  clusters: CommitClusterRow[];
  sleep: SleepRow | null;
  spendTotal: number;
  spendCount: number;
  commitCount: number;
  /** Place chain under the map: 집 → 회사 12시간 6분 → 파페 → 집. */
  chain: { name: string; duration: string | null }[];
}

/** Two visits to one place this close (minutes) with no ride between are one stay. */
const STAY_MERGE_GAP_MIN = 30;

/**
 * Consecutive visits to the same place (a detector split such as 카페 10분 +
 * 1시간 22분) merge into one stay unless a ride happened in between.
 */
export function mergeStayPoints(
  stayPoints: StayPointData[],
  rideWindows: { startIso: string; endIso: string }[] = []
): StayPointData[] {
  const sorted = [...stayPoints].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const out: StayPointData[] = [];
  for (const sp of sorted) {
    const last = out.at(-1);
    if (last && stayName(last) === stayName(sp)) {
      const gap0 = new Date(last.endTime).getTime();
      const gap1 = new Date(sp.startTime).getTime();
      const rideBetween = rideWindows.some((r) => {
        const r0 = new Date(r.startIso).getTime();
        const r1 = new Date(r.endIso).getTime();
        // A ride that left after the first visit and arrived for the second; a
        // longer track that merely spans both visits (a walk with stops) isn't one.
        return r0 >= gap0 - 60_000 && r1 <= gap1 + 60_000 && r1 > r0;
      });
      if (!rideBetween && (gap1 - gap0) / 60_000 <= STAY_MERGE_GAP_MIN) {
        const end = Math.max(gap0, new Date(sp.endTime).getTime());
        out[out.length - 1] = {
          ...last,
          endTime: new Date(end).toISOString(),
          durationMinutes: last.durationMinutes + sp.durationMinutes,
        };
        continue;
      }
    }
    out.push(sp);
  }
  return out;
}

function stayRows(stayPoints: StayPointData[], date: string): StayRow[] {
  return [...stayPoints]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((sp, i) => {
      const t0 = clockInDay(sp.startTime, date);
      const t1 = clockInDay(sp.endTime, date);
      const start = clampDay(minuteOfDay(sp.startTime, date));
      const end = clampDay(minuteOfDay(sp.endTime, date));
      const id = `s${i}`;
      const area = shortArea(sp.address, { korean: inKorea(sp.lat, sp.lon) });
      const name = stayName(sp);
      return {
        kind: "stay",
        id,
        start,
        end,
        time: t0,
        depth: 0,
        mapId: id,
        name,
        durationLabel: formatDurationMinutes(end - start),
        range: `${t0}–${t1}`,
        area: area === name ? "" : area,
        lat: sp.lat,
        lon: sp.lon,
      } satisfies StayRow;
    });
}

function sleepRow(s: HealthSleepSession, date: string, recent: HealthSleepSession[]): SleepRow {
  const asleep = asleepMinutes(s);
  const endIso = sleepEndIso(s);
  const t0 = formatTime(new Date(s.start));
  const t1 = formatTime(new Date(endIso));
  let flag: RowFlagData | undefined;
  const nights = dedupeNights(recent);
  if (nights.length >= 5 && nights.some((n) => n.start === s.start)) {
    const values = nights.map(asleepMinutes);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const diff = formatDurationMinutes(Math.abs(asleep - avg));
    const scope = `${nights.length}밤`;
    if (asleep === min && values.filter((v) => v === min).length === 1) {
      flag = {
        label: `${scope} 중 최저`,
        reason: `${formatDurationMinutes(asleep)} · 최근 ${scope} 평균 ${formatDurationMinutes(avg)}보다 ${diff} 짧아요.`,
      };
    } else if (asleep === max && values.filter((v) => v === max).length === 1) {
      flag = {
        label: `${scope} 중 최고`,
        reason: `${formatDurationMinutes(asleep)} · 최근 ${scope} 평균 ${formatDurationMinutes(avg)}보다 ${diff} 길어요.`,
      };
    }
  }
  return {
    kind: "sleep",
    id: "sleep",
    start: clampDay(minuteOfDay(s.start, date)),
    time: clockInDay(s.start, date),
    depth: 1,
    mapId: null,
    flag,
    asleepMin: asleep,
    inBedMin: s.minutes,
    asleep: formatDurationMinutes(asleep),
    inBed: formatDurationMinutes(s.minutes),
    range: `${t0}–${t1}`,
    efficiency: s.stages && s.minutes > 0 ? `${Math.round((asleep / s.minutes) * 100)}%` : null,
    segments: s.segments,
    stages: s.stages
      ? [
          { label: "깊은 잠", value: formatDurationMinutes(s.stages.deep) },
          { label: "렘", value: formatDurationMinutes(s.stages.rem) },
          { label: "얕은 잠", value: formatDurationMinutes(s.stages.light) },
          { label: "깸", value: formatDurationMinutes(s.stages.awake) },
        ]
      : null,
  };
}

/** Main nights only, one per start instant. */
export function dedupeNights(sessions: HealthSleepSession[]): HealthSleepSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (s.nap || seen.has(s.start)) return false;
    seen.add(s.start);
    return true;
  });
}

function txRows(
  transactions: TransactionItem[],
  date: string
): {
  spend: TxRow[];
  income: IncomeRow[];
} {
  const spending = transactions
    .filter((t) => t.bucket === "spending")
    .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());
  const total = spending.reduce((s, t) => s + t.amount, 0);
  const spend = spending.map((t): TxRow => {
    let flag: RowFlagData | undefined;
    if (t.category === "subscription") {
      const conf =
        t.categorySource === "ai" && t.categoryConfidence != null
          ? `AI 분류 구독(신뢰도 ${Math.round(t.categoryConfidence * 100)}%)`
          : "구독으로 분류된 결제";
      flag = { label: "정기 결제", reason: `${conf} · 다음 달에도 같은 금액이 나갈 수 있어요.` };
    } else if (spending.length >= 2 && t.amount >= 50_000 && t.amount / total >= 0.6) {
      flag = {
        label: "큰 결제",
        reason: `이날 지출 ${formatWon(total)} 중 ${Math.round((t.amount / total) * 100)}%가 이 한 건이에요.`,
      };
    }
    return {
      kind: "tx",
      id: `t:${t.id}`,
      start: clampDay(minuteOfDay(t.transactedAt, date)),
      time: clockInDay(t.transactedAt, date),
      depth: 1,
      mapId: null,
      flag,
      merchant: t.merchant || t.accountName,
      amount: formatWon(-t.amount, { sign: true }),
      amountValue: t.amount,
      category: txCategory(t),
    };
  });

  // Deposits into one account within an hour of each other read as one row;
  // a later burst starts its own row so each row sits at its own time.
  const groups: { key: string; list: TransactionItem[] }[] = [];
  const openGroup = new Map<string, { key: string; list: TransactionItem[] }>();
  for (const t of transactions
    .filter((t) => t.bucket === "income")
    .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime())) {
    const key = t.accountName || t.merchant;
    const cur = openGroup.get(key);
    const last = cur?.list.at(-1);
    if (
      cur &&
      last &&
      new Date(t.transactedAt).getTime() - new Date(last.transactedAt).getTime() <= 60 * 60_000
    ) {
      cur.list.push(t);
    } else {
      const next = { key, list: [t] };
      groups.push(next);
      openGroup.set(key, next);
    }
  }
  groups.sort(
    (a, b) =>
      new Date(a.list[0].transactedAt).getTime() - new Date(b.list[0].transactedAt).getTime()
  );
  const income = groups.map(({ key, list }, i): IncomeRow => {
    const sum = list.reduce((s, t) => s + t.amount, 0);
    const times = [...new Set(list.map((t) => clockInDay(t.transactedAt, date)))];
    return {
      kind: "income",
      id: `i${i}`,
      start: clampDay(minuteOfDay(list[0].transactedAt, date)),
      time: clockInDay(list[0].transactedAt, date),
      depth: 1,
      mapId: null,
      label: list.length > 1 ? `${key} 입금 ${list.length}건` : `${list[0].merchant || key} 입금`,
      amount: formatWon(sum, { sign: true }),
      amountValue: sum,
      note:
        times.length > 3
          ? `${times[0]}–${times.at(-1)}`
          : times.length > 1
            ? times.join(" · ")
            : list.length > 1
              ? ""
              : "입금",
    };
  });
  return { spend, income };
}

/** Stops shorter than this (minutes) stay out of the place chain. */
const CHAIN_MIN_STAY = 30;
const CHAIN_MAX = 7;

/**
 * The place chain under the map: where the day went, in order. Short stops drop
 * out (the first and last place always stay), consecutive visits to one place
 * merge, and the places in between carry how long the day spent there.
 */
export function placeChain(stays: StayRow[]): { name: string; duration: string | null }[] {
  if (stays.length === 0) return [];
  const kept = stays.filter(
    (s, i) => i === 0 || i === stays.length - 1 || s.end - s.start >= CHAIN_MIN_STAY
  );
  const merged: { name: string; minutes: number }[] = [];
  for (const s of kept) {
    const last = merged.at(-1);
    if (last?.name === s.name) last.minutes += s.end - s.start;
    else merged.push({ name: s.name, minutes: s.end - s.start });
  }
  let middle = merged.slice(1, -1);
  if (merged.length > CHAIN_MAX) {
    const keep = new Set([...middle].sort((a, b) => b.minutes - a.minutes).slice(0, CHAIN_MAX - 2));
    middle = middle.filter((m) => keep.has(m));
  }
  const ends = merged.length > 1 ? [merged[0], ...middle, merged[merged.length - 1]] : merged;
  return ends.map((m, i) => ({
    name: m.name,
    duration: i > 0 && i < ends.length - 1 ? formatDurationMinutes(m.minutes) : null,
  }));
}

export function buildDayModel(input: DayInput): DayModel {
  const { date } = input;
  const rides =
    input.tracks.length > 0
      ? input.tracks
          .map((t) => rideFromTrack(t, date, input.workouts))
          .sort((a, b) => a.start - b.start)
      : ridesFromGaps(input.locations, input.stayPoints, date);
  const stays = stayRows(mergeStayPoints(input.stayPoints, rides), date);
  for (const r of rides) {
    // Stays strictly inside a track are stops on it (a ride with stopovers):
    // the list nests them under the ride instead of reading as overlaps.
    const inside = stays.filter((s) => s.start > r.start && s.end <= r.end + 1 && !s.via);
    for (const s of inside) s.via = r.id;
    r.stops = inside.map((s) => s.name).filter((n, i, a) => n && n !== a[i - 1]);
    // Endpoints follow the neighbouring stays the list shows (a geocoded track
    // end can name the shop next door); the geocoder only fills a gap.
    const before = stays.filter(
      (s) => !s.via && s.start <= r.start && r.start - s.end <= ENDPOINT_GAP_MIN
    );
    const after = stays.find(
      (s) => !s.via && s.start >= r.end - 1 && s.start - r.end <= ENDPOINT_GAP_MIN
    );
    r.from =
      before.at(-1)?.name || r.from || stays.filter((s) => s.start <= r.start).at(-1)?.name || "";
    r.to = after?.name || r.to || stays.find((s) => s.start >= r.end - 1)?.name || "";
  }
  const clusters = clusterCommits(input.commits, date);
  const { spend, income } = txRows(input.transactions, date);
  const sleep = input.sleep ? sleepRow(input.sleep, date, input.recentSleeps) : null;

  const tops: (StayRow | RideRow)[] = [...stays, ...rides].sort(
    (a, b) => a.start - b.start || (a.kind === "stay" ? -1 : 1)
  );
  const kids: DayRow[] = [...clusters, ...spend, ...income, ...(sleep ? [sleep] : [])].sort(
    (a, b) => a.start - b.start
  );

  // Rows read top-down in time: a commit made after a ride left a stay sits
  // below that ride, even though it still belongs (on the map) to the stay.
  const rank = (r: DayRow) => (r.kind === "stay" ? 0 : r.kind === "ride" ? 1 : 2);
  const rows: DayRow[] = [...tops, ...kids].sort((a, b) => a.start - b.start || rank(a) - rank(b));
  if (stays.length > 0) {
    const owner = (m: number): StayRow => {
      const inside = stays.find((s) => s.start <= m && m <= s.end);
      if (inside) return inside;
      const before = stays.filter((s) => s.start <= m);
      return before.at(-1) ?? stays[0];
    };
    for (const k of kids) k.mapId = owner(k.start).id;
  }
  for (const r of [...stays, ...kids]) {
    if (r.kind === "stay" ? !!r.via : rides.some((x) => r.start > x.start && r.start < x.end)) {
      r.onRide = true;
    }
  }

  return {
    rows,
    stays,
    rides,
    clusters,
    sleep,
    spendTotal: spend.reduce((s, t) => s + t.amountValue, 0),
    spendCount: spend.length,
    commitCount: input.commits.length,
    chain: placeChain(stays),
  };
}
