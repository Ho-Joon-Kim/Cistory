/**
 * Sleep-stage normalization. A stored `sleep` sample's valueJson comes from one of
 * TWO sources with different shapes, and both must render the same hypnogram:
 *
 *  - Google Health API (cloud sync, `platform: FITBIT`) — ISO-8601 stage times and
 *    a string `type` ("DEEP" / "LIGHT" / "REM" / "AWAKE"), session start under
 *    `interval.startTime`.
 *  - On-device Health Connect import (MacroDroid/Tasker) — epoch-millis stage times
 *    and a numeric `stage` code, session start at the record's top-level `startTime`.
 *
 * Everything here is pure so both shapes are unit-testable without a DB.
 */

import type { SleepStageKey, SleepStageSegment, SleepStages } from "./types";

/** Health Connect numeric stage codes → depth key. 3 = out-of-bed, ignored. */
const HC_STAGE_KEY: Record<string, SleepStageKey> = {
  "1": "awake",
  "2": "light",
  "4": "light",
  "5": "deep",
  "6": "rem",
  "7": "awake",
};

/** Google Health stage enum → depth key. Anything else (UNKNOWN) is ignored. */
const GH_STAGE_KEY: Record<string, SleepStageKey> = {
  AWAKE: "awake",
  WAKE: "awake",
  RESTLESS: "awake",
  OUT_OF_BED: "awake",
  LIGHT: "light",
  SLEEPING: "light",
  DEEP: "deep",
  REM: "rem",
};

interface RawStage {
  startTime?: number | string;
  endTime?: number | string;
  /** Health Connect numeric code */
  stage?: unknown;
  /** Google Health string enum */
  type?: unknown;
}

interface RawSleep {
  startTime?: number | string;
  interval?: { startTime?: string; endTime?: string };
  stages?: RawStage[];
}

/**
 * Epoch millis (import) or an ISO-8601 string (cloud) → millis. Numeric strings are
 * treated as epoch millis, so the two shapes can't be confused.
 */
function toMillis(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v === "") return null;
  const asNum = Number(v);
  if (Number.isFinite(asNum)) return asNum;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function stageKey(s: RawStage): SleepStageKey | null {
  if (typeof s.type === "string") return GH_STAGE_KEY[s.type.toUpperCase()] ?? null;
  if (s.stage != null) return HC_STAGE_KEY[String(s.stage)] ?? null;
  return null;
}

/** The session's own start, in millis — `interval.startTime` (cloud) or `startTime` (import). */
function sessionStart(rec: RawSleep | null): number | null {
  return toMillis(rec?.interval?.startTime ?? rec?.startTime);
}

function stagesOf(valueJson: unknown): { rec: RawSleep; stages: RawStage[] } | null {
  const rec = valueJson as RawSleep | null;
  const stages = rec?.stages;
  if (!rec || !Array.isArray(stages) || stages.length === 0) return null;
  return { rec, stages };
}

/**
 * Minutes per sleep depth. Returns null when the session carries no usable stage
 * detail (some records only report a total).
 */
export function stageBreakdown(valueJson: unknown): SleepStages | null {
  const parsed = stagesOf(valueJson);
  if (!parsed) return null;
  const acc: SleepStages = { deep: 0, light: 0, rem: 0, awake: 0 };
  let any = false;
  for (const s of parsed.stages) {
    const st = toMillis(s.startTime);
    const en = toMillis(s.endTime);
    const key = stageKey(s);
    if (st == null || en == null || en <= st || !key) continue;
    acc[key] += (en - st) / 60_000;
    any = true;
  }
  return any ? acc : null;
}

/**
 * Ordered stage spans relative to the session's own start, in minutes — the
 * hypnogram's input. Null when the session carries no usable stage detail.
 */
export function stageSegments(valueJson: unknown): SleepStageSegment[] | null {
  const parsed = stagesOf(valueJson);
  if (!parsed) return null;
  const base = sessionStart(parsed.rec) ?? toMillis(parsed.stages[0]?.startTime);
  if (base == null) return null;
  const out: SleepStageSegment[] = [];
  for (const s of parsed.stages) {
    const st = toMillis(s.startTime);
    const en = toMillis(s.endTime);
    const stage = stageKey(s);
    if (st == null || en == null || en <= st || !stage) continue;
    out.push({ stage, startMin: (st - base) / 60_000, endMin: (en - base) / 60_000 });
  }
  return out.length > 0 ? out : null;
}

/** True when the record is flagged as a nap rather than a main sleep session. */
export function isNap(valueJson: unknown): boolean {
  const md = (valueJson as { metadata?: { nap?: unknown } } | null)?.metadata;
  return md?.nap === true;
}
