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

export interface HealthSummary {
  hasConnection: boolean;
  status: "active" | "needs_reauth" | null;
  backfillCompletedAt: string | null;
  lastSyncedAt: string | null;
  hasAnyHistory: boolean;
  metrics: HealthMetricSeries[];
  workouts: HealthWorkout[];
}
