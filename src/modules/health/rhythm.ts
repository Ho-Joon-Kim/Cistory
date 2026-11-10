/**
 * ECG + irregular-rhythm notification (IRN) — optional-scope Google Health types
 * (design §5, decisions 8/9). Plain constants + pure parsers, shared by the sync
 * service and the /health summary route.
 *
 * Shapes are from the documentation only: the owner's Fitbit Air has no ECG,
 * and neither scope had been granted when this was written, so every field is
 * read defensively and the real payload is confirmed after re-consent
 * (health_raw_pages keeps the verbatim response for re-normalization).
 *
 *   electrocardiogram:  { interval{startTime,endTime}, resultClassification,
 *     waveformSamples[], beatsPerMinuteAvg (int64 string), samplingFrequencyHertz,
 *     millivoltsScalingFactor, leadNumber, medicalDeviceInfo }
 *   irregular-rhythm-notification: { interval, alertWindows[{startTime, endTime,
 *     positive, heartBeats[{physicalTime, beatsPerMinute}]}], medicalDeviceInfo }
 *
 * Stored as SUMMARIES only (decision 9): no waveform, no heartBeats. Neither
 * metric gets a daily summary, and neither ever reaches the /overview AI
 * narrative (its health aggregate is an explicit allowlist — see
 * overview/aggregate/health.ts).
 */

import type { GoogleHealthOptionalScope } from "@/lib/adapters/google-health/google-health";
import type { GoogleHealthDataPoint } from "@/lib/adapters/google-health/interface";

export const ECG_METRIC = "ecg";
export const IRN_METRIC = "irn";
export const RHYTHM_METRIC_KEYS = [ECG_METRIC, IRN_METRIC] as const;

export interface RhythmConfig {
  key: typeof ECG_METRIC | typeof IRN_METRIC;
  dataType: string;
  /** Candidate camelCase wrapper keys (first present wins). */
  wrappers: string[];
  scope: GoogleHealthOptionalScope;
  /**
   * `list` filter field. ECG documents ONLY `>=` on this field, so there is never
   * an upper bound. IRN's filter field is undocumented — it is attempted, and a
   * 400 falls back to an unfiltered newest-first read (`unfilteredFallback`).
   */
  filterField: string;
  unfilteredFallback: boolean;
}

export const RHYTHM_CONFIGS: RhythmConfig[] = [
  {
    key: ECG_METRIC,
    dataType: "electrocardiogram",
    wrappers: ["electrocardiogram"],
    scope: "ecg",
    filterField: "electrocardiogram.interval.start_time",
    unfilteredFallback: false,
  },
  {
    key: IRN_METRIC,
    dataType: "irregular-rhythm-notification",
    wrappers: ["irregularRhythmNotification", "irregularRhythm"],
    scope: "irn",
    filterField: "irregular_rhythm_notification.interval.start_time",
    unfilteredFallback: true,
  },
];

export interface ParsedRhythm {
  sampleAt: Date;
  value: number | null;
  valueJson: Record<string, unknown>;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function instant(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function wrapperOf(config: RhythmConfig, point: GoogleHealthDataPoint): Obj | null {
  for (const key of config.wrappers) {
    const w = obj(point[key]);
    if (w) return w;
  }
  return null;
}

function intervalOf(w: Obj): { start: Date; startTime: string; endTime: string | null } | null {
  const i = obj(w.interval);
  const start = instant(i?.startTime);
  if (!i || !start) return null;
  return {
    start,
    startTime: start.toISOString(),
    endTime: instant(i.endTime)?.toISOString() ?? null,
  };
}

/** ECG → value = average bpm (int64 string → number), valueJson = summary, no waveform. */
export function parseEcg(config: RhythmConfig, point: GoogleHealthDataPoint): ParsedRhythm | null {
  const w = wrapperOf(config, point);
  const interval = w && intervalOf(w);
  if (!w || !interval) return null;
  return {
    sampleAt: interval.start,
    value: num(w.beatsPerMinuteAvg),
    valueJson: {
      startTime: interval.startTime,
      endTime: interval.endTime,
      resultClassification: str(w.resultClassification),
      samplingFrequencyHertz: num(w.samplingFrequencyHertz),
      millivoltsScalingFactor: num(w.millivoltsScalingFactor),
      leadNumber: num(w.leadNumber),
      medicalDeviceInfo: obj(w.medicalDeviceInfo),
    },
  };
}

/** IRN → value = positive alert windows, valueJson = windows WITHOUT heartBeats. */
export function parseIrn(config: RhythmConfig, point: GoogleHealthDataPoint): ParsedRhythm | null {
  const w = wrapperOf(config, point);
  const interval = w && intervalOf(w);
  if (!w || !interval) return null;
  const windows = (Array.isArray(w.alertWindows) ? w.alertWindows : [])
    .map(obj)
    .filter((x): x is Obj => x !== null)
    .map((x) => ({
      startTime: instant(x.startTime)?.toISOString() ?? null,
      endTime: instant(x.endTime)?.toISOString() ?? null,
      positive: x.positive === true,
    }));
  return {
    sampleAt: interval.start,
    value: windows.filter((x) => x.positive).length,
    valueJson: {
      startTime: interval.startTime,
      endTime: interval.endTime,
      alertWindows: windows,
      medicalDeviceInfo: obj(w.medicalDeviceInfo),
    },
  };
}

export function parseRhythm(config: RhythmConfig, point: GoogleHealthDataPoint) {
  return config.key === ECG_METRIC ? parseEcg(config, point) : parseIrn(config, point);
}

/** Device classification → Korean label. We relay it; we never re-interpret a trace. */
export const ECG_CLASSIFICATION_LABELS: Record<string, string> = {
  NORMAL_SINUS_RHYTHM: "정상 동리듬",
  ATRIAL_FIBRILLATION: "심방세동 징후",
  INCONCLUSIVE: "판정 불가",
  INCONCLUSIVE_HIGH_HEART_RATE: "판정 불가 (심박수 높음)",
  INCONCLUSIVE_LOW_HEART_RATE: "판정 불가 (심박수 낮음)",
  UNREADABLE: "판독 불가",
  NOT_ANALYZED: "분석되지 않음",
};

export function ecgClassificationLabel(value: unknown): string {
  return (typeof value === "string" && ECG_CLASSIFICATION_LABELS[value]) || "알 수 없음";
}
