// Display metadata for the curated /health metrics. Plain constants (no "use
// client") so both the server summary route and client components import the
// same list — the route reads `key`/`agg`; the UI reads label/unit/scale.
// Keys must exist in HEALTH_METRICS (src/modules/health/service.ts) to have data;
// sleep / resting HR are intentionally absent until Fitbit populates them.

export interface HealthMetricMeta {
  key: string;
  /** Korean display label */
  label: string;
  unit: string;
  /** which daily-summary field the trend uses: sum (accumulating) or avg (instant) */
  agg: "sum" | "avg";
  /** multiply the stored value for display (e.g. mm → km) */
  scale?: number;
  /** decimal places for the display value */
  decimals?: number;
}

export const CURATED_METRICS: HealthMetricMeta[] = [
  { key: "steps", label: "걸음 수", unit: "걸음", agg: "sum", decimals: 0 },
  { key: "distance", label: "이동 거리", unit: "km", agg: "sum", scale: 1e-6, decimals: 2 },
  { key: "heart_rate", label: "심박수", unit: "bpm", agg: "avg", decimals: 0 },
  { key: "spo2", label: "산소포화도", unit: "%", agg: "avg", decimals: 0 },
  { key: "vo2_max", label: "VO₂max", unit: "mL/kg·min", agg: "avg", decimals: 1 },
];

export const CURATED_METRIC_KEYS = CURATED_METRICS.map((m) => m.key);

// Every trend card the /health grid renders — the curated scalars plus the ones
// computed live (resting HR, exercise). Used CLIENT-SIDE only to render the full
// card set (with skeletons for metrics that have no data yet), so it can include
// keys the summary route doesn't read from health_daily_summaries.
export const ALL_HEALTH_METRICS: HealthMetricMeta[] = [
  ...CURATED_METRICS,
  { key: "resting_heart_rate", label: "안정시 심박", unit: "bpm", agg: "avg", decimals: 0 },
  { key: "exercise", label: "운동 시간", unit: "분", agg: "sum", decimals: 0 },
];
