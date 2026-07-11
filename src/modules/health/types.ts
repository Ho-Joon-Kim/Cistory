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

export interface HealthSummary {
  hasConnection: boolean;
  status: "active" | "needs_reauth" | null;
  backfillCompletedAt: string | null;
  lastSyncedAt: string | null;
  hasAnyHistory: boolean;
  metrics: HealthMetricSeries[];
}
