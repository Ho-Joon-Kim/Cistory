// Wire contract for /api/fitbit/summary, shared by the server route (which builds
// it) and the client hook/components (which consume it) so the two can't drift.
// Plain types only — no "use client", no server imports — safe from both sides.

export interface HealthDayPoint {
  day: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  sum: number | null;
  count: number | null;
}

export interface HealthMetricSeries {
  key: string;
  label: string;
  unit: string;
  agg: "sum" | "avg";
  scale: number | null;
  decimals: number;
  points: HealthDayPoint[];
}

/** One workout session (structured `exercise` data point). */
export interface HealthWorkout {
  /** ISO start time */
  start: string;
  /** active duration, whole minutes */
  minutes: number;
  /** localized name (e.g. "자전거", "걷기"), or null */
  name: string | null;
  /** raw exercise type enum (e.g. "BIKING"), or null */
  type: string | null;
}

/** Minutes per sleep depth (from the record's stages), or null if no stage detail. */
export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

/** Sleep depth key, deepest → most awake (also the hypnogram lane order, bottom→top). */
export type SleepStageKey = "deep" | "light" | "rem" | "awake";

/** One contiguous stage span within a session, in minutes relative to its start. */
export interface SleepStageSegment {
  stage: SleepStageKey;
  startMin: number;
  endMin: number;
}

/** One sleep session (structured `sleep` record). */
export interface HealthSleepSession {
  /** ISO start time */
  start: string;
  /** session duration, whole minutes */
  minutes: number;
  /** per-depth minutes, or null when the record carries no stages */
  stages: SleepStages | null;
  /** ordered stage spans for a hypnogram, or null when the record carries no stages */
  segments: SleepStageSegment[] | null;
  /** the device flagged this as a nap rather than a main sleep session */
  nap: boolean;
}

/** One day of the 건강 × 활동 cross: steps vs places-visited vs coding minutes. */
export interface ActivityCorrelationDay {
  /** KST calendar day 'YYYY-MM-DD' */
  day: string;
  /** daily step total, or null when no health rollup exists for the day */
  steps: number | null;
  /** distinct places visited that day (from location visits) */
  visits: number;
  /** coding minutes that day (WakaTime), or null when none tracked */
  codingMin: number | null;
}

export interface HealthSummary {
  hasConnection: boolean;
  status: "active" | "needs_reauth" | null;
  backfillCompletedAt: string | null;
  lastSyncedAt: string | null;
  hasAnyHistory: boolean;
  metrics: HealthMetricSeries[];
  workouts: HealthWorkout[];
  sleepSessions: HealthSleepSession[];
  /**
   * ECG / irregular-rhythm results — present ONLY when the connection holds at
   * least one of the optional scopes (absent otherwise, so the card stays hidden).
   * Optional so older fixtures/clients without it keep working.
   */
  rhythm?: HealthRhythm | null;
}

/** One ECG recording: the device's own classification + average bpm (no waveform). */
export interface HealthEcgReading {
  start: string;
  classification: string | null;
  bpm: number | null;
}

/** One irregular-rhythm check: how many alert windows were positive. */
export interface HealthIrnAlert {
  start: string;
  end: string | null;
  positiveWindows: number;
  windows: number;
}

export interface HealthRhythm {
  /** null = scope not granted; [] = granted, no readings yet */
  ecg: HealthEcgReading[] | null;
  irn: HealthIrnAlert[] | null;
}
