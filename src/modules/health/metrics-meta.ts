// Display metadata for the curated /health metrics. Plain constants (no "use
// client") so both the server summary route and client components import the
// same list — the route reads `key`/`agg`; the UI reads label/unit/scale.
// Keys must exist in HEALTH_METRICS (src/modules/health/service.ts) to have data.
//
// Not every synced metric is carded: `daily_spo2` and `daily_hrv` are stored (they
// carry nightly bounds / entropy the intraday series can't express) but would just
// duplicate the `spo2` and `hrv` cards, so they stay out of the curated view and
// remain queryable from health_samples.

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
  /**
   * Stored metric keys this card merges, in PREFERENCE order: for each day the
   * first key with a value wins (never blended). Omitted = just `key`. The VO₂max
   * card reads Fitbit's `daily_vo2_max` first and falls back to the Samsung-era
   * `vo2_max` series, which stopped in 2026-04.
   */
  sourceKeys?: string[];
}

/** The stored metric keys a curated card reads, in preference order. */
export function metricSourceKeys(meta: HealthMetricMeta): string[] {
  return meta.sourceKeys ?? [meta.key];
}

export const CURATED_METRICS: HealthMetricMeta[] = [
  { key: "steps", label: "걸음 수", unit: "걸음", agg: "sum", decimals: 0 },
  { key: "distance", label: "이동 거리", unit: "km", agg: "sum", scale: 1e-6, decimals: 2 },
  { key: "active_energy", label: "활동 칼로리", unit: "kcal", agg: "sum", decimals: 0 },
  // Google's wearable-only daily rollup (BMR + activity), not a sum over sources.
  { key: "total_calories", label: "총 소모 칼로리", unit: "kcal", agg: "sum", decimals: 0 },
  { key: "active_zone_minutes", label: "활동 존 시간", unit: "분", agg: "sum", decimals: 0 },
  { key: "heart_rate", label: "심박수", unit: "bpm", agg: "avg", decimals: 0 },
  { key: "resting_heart_rate", label: "안정시 심박", unit: "bpm", agg: "avg", decimals: 0 },
  { key: "hrv", label: "심박 변이도", unit: "ms", agg: "avg", decimals: 0 },
  {
    key: "vo2_max",
    label: "VO₂max",
    unit: "mL/kg·min",
    agg: "avg",
    decimals: 1,
    sourceKeys: ["daily_vo2_max", "vo2_max"],
  },
  { key: "spo2", label: "산소포화도", unit: "%", agg: "avg", decimals: 0 },
  { key: "respiratory_rate", label: "호흡수", unit: "회/분", agg: "avg", decimals: 1 },
  { key: "skin_temperature", label: "피부 온도", unit: "°C", agg: "avg", decimals: 1 },
];

/**
 * Merge per-day series given in preference order: each day takes the point from
 * the FIRST series that has that day — values are never blended across keys.
 * Output is sorted by day.
 */
export function mergeDailySeries<T extends { day: string }>(seriesInPreferenceOrder: T[][]): T[] {
  const byDay = new Map<string, T>();
  for (const series of seriesInPreferenceOrder) {
    for (const point of series) if (!byDay.has(point.day)) byDay.set(point.day, point);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Every stored metric key the curated cards read (a card may merge several). */
export const CURATED_METRIC_KEYS = [...new Set(CURATED_METRICS.flatMap(metricSourceKeys))];

/**
 * Fixed identity color per metric (dataviz: hue follows the entity, never its rank),
 * tuned for the dark neon surface. Charts read this by key so the accent never drifts.
 */
export const METRIC_ACCENT: Record<string, string> = {
  steps: "hsl(153 70% 53%)", // green
  distance: "hsl(210 90% 62%)", // blue
  exercise: "hsl(30 92% 60%)", // orange
  active_energy: "hsl(18 90% 58%)", // ember — sibling of exercise orange
  total_calories: "hsl(95 62% 55%)", // lime — whole-day energy budget, clear of ember/amber
  active_zone_minutes: "hsl(340 78% 62%)", // pink — effort intensity
  heart_rate: "hsl(0 72% 62%)", // red
  resting_heart_rate: "hsl(355 60% 76%)", // light rose — lighter sibling of heart rate red
  hrv: "hsl(285 68% 68%)", // magenta-violet — recovery
  spo2: "hsl(263 72% 72%)", // violet
  vo2_max: "hsl(45 100% 60%)", // amber
  respiratory_rate: "hsl(190 78% 58%)", // cyan — breath
  skin_temperature: "hsl(75 62% 50%)", // lime — kept clear of the ember/orange movement hues
  sleep: "hsl(235 66% 62%)", // indigo — matches the hypnogram's deep-sleep hue
};

/** Accent for a metric key, falling back to the primary green. */
export function metricAccent(key: string): string {
  return METRIC_ACCENT[key] ?? "hsl(153 70% 53%)";
}

// Every trend card the /health grid renders — the curated scalars plus `exercise`,
// which is computed live from health_samples rather than health_daily_summaries.
// Used CLIENT-SIDE only to render the full card set (with skeletons for metrics
// that have no data yet), so it can include keys the summary route doesn't read
// from health_daily_summaries.
export const ALL_HEALTH_METRICS: HealthMetricMeta[] = [
  ...CURATED_METRICS,
  { key: "exercise", label: "운동 시간", unit: "분", agg: "sum", decimals: 0 },
];
