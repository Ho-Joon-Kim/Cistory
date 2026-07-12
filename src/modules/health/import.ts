/**
 * Parser for the on-device Health Connect importer (MacroDroid/Tasker →
 * POST /api/health-import). Normalizes each pushed record into a health_samples
 * row. Tolerant of raw Health Connect record JSON (the TaskerHealthConnect plugin
 * emits HC-native records: epoch-millis times, some values nested as { value }).
 *
 * Session records (sleep, exercise) → value = duration minutes, valueJson = the
 * record. Scalar records → value = the metric's number (unit-normalized). Unknown
 * metrics are dropped so junk can't pollute health_samples.
 */

import type { NewHealthSample } from "@/db/schema";

// Normalized metric-name (separators removed, "record"/"session" suffixes stripped)
// → the canonical health_samples.metric key.
const METRIC_ALIASES: Record<string, string> = {
  sleep: "sleep",
  exercise: "exercise",
  workout: "exercise",
  steps: "steps",
  distance: "distance",
  heartrate: "heart_rate",
  restingheartrate: "resting_heart_rate",
  oxygensaturation: "spo2",
  spo2: "spo2",
  vo2max: "vo2_max",
  heartratevariability: "hrv",
  heartratevariabilityrmssd: "hrv",
  hrv: "hrv",
};

const SESSION_METRICS = new Set(["sleep", "exercise"]);

// Scalar value: field to read + how to interpret it. `value` may be a bare number
// or nested as { value } (HC wraps quantities). `scale` normalizes units to match
// what the cloud path stored (distance: HC meters → millimeters).
const SCALAR_FIELDS: Record<string, { keys: string[]; scale?: number }> = {
  steps: { keys: ["count"] },
  distance: { keys: ["distance"], scale: 1000 }, // meters → mm
  heart_rate: { keys: ["beatsPerMinute"] },
  resting_heart_rate: { keys: ["beatsPerMinute"] },
  spo2: { keys: ["percentage"] },
  vo2_max: { keys: ["vo2MillilitersPerMinuteKilogram", "vo2Max"] },
  hrv: { keys: ["heartRateVariabilityMillis"] },
};

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

/** A number directly, a numeric string, or an HC quantity object `{ value }`. */
function numify(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number") {
    return (v as { value: number }).value;
  }
  return null;
}

function resolveMetric(rec: Rec): string | null {
  const raw = rec.metric ?? rec.type ?? rec.recordType;
  if (typeof raw === "string") {
    const k = raw.toLowerCase().replace(/[\s_-]/g, "");
    const stripped = k.replace(/record$/, "").replace(/session$/, "");
    const canon = METRIC_ALIASES[k] ?? METRIC_ALIASES[stripped];
    if (canon) return canon;
  }
  // Infer from structural fields when the type isn't labeled.
  if (rec.stages != null || rec.sleepStages != null) return "sleep";
  if (rec.exerciseType != null || rec.segments != null) return "exercise";
  return null;
}

function extractScalar(metric: string, rec: Rec): number | null {
  const spec = SCALAR_FIELDS[metric];
  if (spec) {
    for (const k of spec.keys) {
      const n = numify(rec[k]);
      if (n != null) return spec.scale ? n * spec.scale : n;
    }
  }
  // Normalized-shape fallback: a bare `value` (already in the target unit).
  return numify(rec.value);
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
    const explicit = numify(rec.durationMinutes ?? rec.minutes);
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

  const value = extractScalar(metric, rec);
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
