import type { BodyMetricColumn, ParsedMeasureGroup, WithingsMeasureGroup } from "./types";

// Withings measure type codes produced by the Body Smart scale.
// NOTE: 168 is Extracellular Water, NOT visceral fat — visceral fat is 170.
// 91 (Pulse Wave Velocity) and 155 (Vascular Age) are Body Comp/Scan-tier only
// and are intentionally NOT in the allow-list below.
export const WITHINGS_MEASURE = {
  WEIGHT: 1,
  FAT_FREE_MASS: 5,
  FAT_RATIO: 6,
  FAT_MASS: 8,
  HEART_RATE: 11,
  MUSCLE_MASS: 76,
  HYDRATION: 77,
  BONE_MASS: 88,
  VISCERAL_FAT: 170,
  BMR: 226,
  METABOLIC_AGE: 227,
} as const;

/** Measure type code → body_measurements typed column. */
export const MEASURE_TYPE_TO_COLUMN: Record<number, BodyMetricColumn> = {
  [WITHINGS_MEASURE.WEIGHT]: "weightKg",
  [WITHINGS_MEASURE.FAT_MASS]: "fatMassKg",
  [WITHINGS_MEASURE.FAT_FREE_MASS]: "fatFreeMassKg",
  [WITHINGS_MEASURE.MUSCLE_MASS]: "muscleMassKg",
  [WITHINGS_MEASURE.BONE_MASS]: "boneMassKg",
  [WITHINGS_MEASURE.HYDRATION]: "hydrationKg",
  [WITHINGS_MEASURE.FAT_RATIO]: "fatRatioPct",
  [WITHINGS_MEASURE.HEART_RATE]: "heartRateBpm",
  [WITHINGS_MEASURE.VISCERAL_FAT]: "visceralFat",
  [WITHINGS_MEASURE.BMR]: "bmrKcal",
  [WITHINGS_MEASURE.METABOLIC_AGE]: "metabolicAge",
};

/**
 * The `meastypes` allow-list we request from getmeas. Restricting the request
 * to Body Smart codes keeps other-device data (blood pressure 9/10, sleep,
 * activity) out entirely, honoring the integration's scope boundary.
 */
export const BODY_SMART_MEASURE_TYPES: number[] = Object.keys(MEASURE_TYPE_TO_COLUMN).map(Number);

/** Reconstruct one measurement group into typed metrics (value × 10^unit). */
export function parseMeasureGroup(grp: WithingsMeasureGroup): ParsedMeasureGroup {
  const metrics: Partial<Record<BodyMetricColumn, number>> = {};
  for (const m of grp.measures ?? []) {
    const col = MEASURE_TYPE_TO_COLUMN[m.type];
    if (col === undefined) continue;
    metrics[col] = m.value * 10 ** m.unit;
  }
  return {
    groupId: grp.grpid,
    measuredAt: new Date(grp.date * 1000),
    category: grp.category,
    metrics,
    raw: grp.measures ?? [],
  };
}

/**
 * Parse a list of measure groups, keeping only real measures (category 1) that
 * carry at least one Body Smart metric. Groups made up solely of unmapped
 * (other-device) codes are dropped rather than persisted.
 */
export function parseMeasureGroups(grps: WithingsMeasureGroup[]): ParsedMeasureGroup[] {
  return grps
    .filter((g) => g.category === 1)
    .map(parseMeasureGroup)
    .filter((g) => Object.keys(g.metrics).length > 0);
}
