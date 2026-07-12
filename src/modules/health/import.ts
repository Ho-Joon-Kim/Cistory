/**
 * Parser for the on-device Health Connect importer (MacroDroid/Tasker →
 * POST /api/health-import). Normalizes each pushed record into a health_samples
 * row. Tolerant of both a clean normalized shape and raw Health Connect record
 * JSON (the plugin emits HC-native records).
 *
 * Session records (sleep, exercise) → value = duration in minutes, valueJson =
 * the record (stages / type kept for detail). Scalar records → value = the number.
 * Unknown metrics are dropped so junk can't pollute health_samples.
 */

import type { NewHealthSample } from "@/db/schema";

// Accepted metric names (many aliases) → the canonical health_samples.metric key.
const METRIC_ALIASES: Record<string, string> = {
  sleep: "sleep",
  sleepsession: "sleep",
  sleepsessionrecord: "sleep",
  exercise: "exercise",
  exercisesession: "exercise",
  exercisesessionrecord: "exercise",
  workout: "exercise",
  steps: "steps",
  stepsrecord: "steps",
  distance: "distance",
  distancerecord: "distance",
  heartrate: "heart_rate",
  heart_rate: "heart_rate",
  heartraterecord: "heart_rate",
  oxygensaturation: "spo2",
  oxygen_saturation: "spo2",
  spo2: "spo2",
  vo2max: "vo2_max",
  vo2_max: "vo2_max",
};

const SESSION_METRICS = new Set(["sleep", "exercise"]);

type Rec = Record<string, unknown>;

function parseTime(v: unknown): Date | null {
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function firstTime(rec: Rec, keys: string[]): Date | null {
  for (const k of keys) {
    const d = parseTime(rec[k]);
    if (d) return d;
  }
  return null;
}

function pickSource(rec: Rec): string {
  if (typeof rec.source === "string" && rec.source) return rec.source;
  const md = rec.metadata as { dataOrigin?: { packageName?: string } } | undefined;
  const pkg = md?.dataOrigin?.packageName;
  if (typeof pkg === "string" && pkg) return pkg;
  return "healthconnect";
}

function resolveMetric(rec: Rec): string | null {
  const raw = rec.metric ?? rec.type ?? rec.recordType;
  if (typeof raw === "string") {
    const canon = METRIC_ALIASES[raw.toLowerCase().replace(/[\s-]/g, "")];
    if (canon) return canon;
  }
  // Infer from structural fields when the type isn't labeled.
  if (rec.stages != null || rec.sleepStages != null) return "sleep";
  if (rec.exerciseType != null) return "exercise";
  return null;
}

function firstNumber(rec: Rec, keys: string[]): number | null {
  for (const k of keys) {
    const v = rec[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Normalize one pushed record → a health_samples row, or null if unusable.
 * `userId` is bound by the caller (never trusted from the payload).
 */
export function parseImportRecord(userId: string, raw: unknown): NewHealthSample | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Rec;

  const metric = resolveMetric(rec);
  if (!metric) return null;

  const start = firstTime(rec, ["start", "startTime", "time", "sampleTime", "startDate"]);
  if (!start) return null;
  const source = pickSource(rec);

  if (SESSION_METRICS.has(metric)) {
    const end = firstTime(rec, ["end", "endTime", "endDate"]);
    // duration: explicit minutes, else derived from the interval.
    const explicit = firstNumber(rec, ["durationMinutes", "minutes"]);
    const derived = end ? (end.getTime() - start.getTime()) / 60000 : null;
    const minutes = explicit ?? derived;
    return {
      userId,
      metric,
      sampleAt: start,
      source,
      value: minutes != null && minutes >= 0 ? minutes : null,
      valueJson: rec,
    };
  }

  // Scalar metric: needs a numeric value.
  const value = firstNumber(rec, [
    "value",
    "count",
    "beatsPerMinute",
    "millimeters",
    "percentage",
    "vo2Max",
  ]);
  if (value == null) return null;
  return { userId, metric, sampleAt: start, source, value, valueJson: null };
}

/** Parse a batch. Accepts `[...]` or `{ records: [...] }`. Bad rows are skipped. */
export function parseImportBatch(userId: string, body: unknown): NewHealthSample[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { records?: unknown[] })?.records)
      ? (body as { records: unknown[] }).records
      : [];
  const rows: NewHealthSample[] = [];
  for (const rec of list) {
    const parsed = parseImportRecord(userId, rec);
    if (parsed) rows.push(parsed);
  }
  return rows;
}
