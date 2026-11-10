/**
 * Health-evidence refinement of transportation modes.
 *
 * The speed/acceleration classifier cannot tell a bike from a run in the 7–20 km/h
 * band: it used to split that band on average acceleration, and GPS jitter inflates
 * acceleration, so ~76% of bike rides that a watch had logged as BIKING/ELECTRIC_BIKE
 * were stored as `running` (the user has one RUNNING session in all their data, and
 * it has no GPS track). Two pieces of health data answer the question directly:
 *
 *  1. Exercise sessions (`health_samples.metric = 'exercise'`) — the watch or phone
 *     recorded what the activity was. Used as ground truth, but only among
 *     human-powered modes and only at speeds that mode can actually reach, so a car
 *     ride inside a long "walk" session is never relabelled.
 *  2. Per-minute step counts (`metric = 'steps'`) — pedalling produces almost no
 *     steps, walking ~100/min, running 150+/min. Used when there is no session.
 *
 * Every threshold here was measured on the owner's session-labelled segments by
 * `scripts/calibrate-mode-vs-health.ts`; re-run it before changing one. Pure and
 * DB-free; `health-evidence-loader.ts` fetches the inputs per day.
 */

import { type Confidence, RUNNING_MAX_KMH, type TransportMode } from "./mode-classifier";
import { mergeSameMode, type TransportSegment } from "./movement-analyzer";

export type HumanPoweredMode = "walking" | "running" | "cycling";

export interface ExerciseSessionEvidence {
  start: Date;
  end: Date;
  /** Google Health `exerciseType`, e.g. "ELECTRIC_BIKE". */
  exerciseType: string;
}

export interface StepSampleEvidence {
  /** Bucket start. Fitbit and Health Connect phone sources write ~1-minute buckets. */
  at: Date;
  source: string;
  count: number;
}

/** Already deduplicated sessions (see modules/health/sessions.ts) and raw step rows. */
export interface HealthEvidence {
  sessions: ExerciseSessionEvidence[];
  steps: StepSampleEvidence[];
}

export interface HealthRefineOptions {
  /** Minimum share of the segment's duration a session must cover to label it. */
  sessionOverlapMin: number;
  /** Highest average speed (km/h) at which a session may claim a segment, per mode. */
  sessionSpeedCapKmh: Record<HumanPoweredMode, number>;
  /** Window-averaged steps/min at or above which a band segment is on foot. */
  onFootCadenceMin: number;
  /** Window-averaged steps/min at or above which an on-foot segment is running. */
  runningCadenceMin: number;
  /** A step source counts as "present" only with a sample this close to the segment. */
  stepCoverageMarginMs: number;
  /** Rows above this are daily aggregates (Samsung Health writes one per day), not minutes. */
  maxStepsPerSample: number;
  /** Shorter segments are too short for a stable cadence. */
  minCadenceWindowSec: number;
}

/**
 * Calibrated by scripts/calibrate-mode-vs-health.ts on 2026-11-10 (train split, 300
 * session days, 1,897 segments). In short:
 *  - overlap 0.5: session label vs step cadence agrees 88–100% at every overlap share
 *    ≥ 0.7 and 88% across the sparse 0.4–0.7 buckets, so "the session covers most of
 *    the segment" is enough; nothing supports a stricter cut.
 *  - cycling cap 35 km/h: bike-session segments top out at 27.5 km/h; the next ones
 *    up are 50+ km/h GPS teleports and car rides. Matches CYCLING_MAX_LIKELY.
 *  - walking cap 12 km/h: walking sessions run long and swallow bus/subway legs. The
 *    fastest walking-session segment with on-foot cadence is 12.0 km/h (GPS-inflated);
 *    the next one with step coverage is a 27.6 km/h vehicle leg.
 *  - running cap = the classifier's 20 km/h band ceiling (no on-road running in the data).
 *  - on-foot cadence 40 steps/min: bike-session segments never exceed 34.1 (p95 13.4);
 *    the best plain-accuracy threshold on train band segments (95/96).
 *  - running cadence 140: no on-road running exists to calibrate against; 140 sits
 *    above every walking-session window (max ~111) and below typical running (150–180).
 */
export const DEFAULT_HEALTH_REFINE_OPTIONS: HealthRefineOptions = {
  sessionOverlapMin: 0.5,
  sessionSpeedCapKmh: { cycling: 35, walking: 12, running: RUNNING_MAX_KMH },
  onFootCadenceMin: 40,
  runningCadenceMin: 140,
  stepCoverageMarginMs: 30 * 60_000,
  maxStepsPerSample: 300,
  minCadenceWindowSec: 120,
};

/** Fitbit is worn on the wrist all day; phones sit in a pocket or a bag. */
const PREFERRED_STEP_SOURCE = "FITBIT";

const SESSION_TYPE_MODES: Record<string, HumanPoweredMode> = {
  BIKING: "cycling",
  ELECTRIC_BIKE: "cycling",
  MOUNTAIN_BIKING: "cycling",
  ROAD_BIKING: "cycling",
  WALKING: "walking",
  HIKING: "walking",
  RUNNING: "running",
};

/**
 * Exercise types that move along the ground under the person's own power. TREADMILL,
 * STRENGTH_TRAINING and generic WORKOUT/CARDIO sessions say nothing about the GPS track.
 */
export function exerciseTypeToMode(exerciseType: string): HumanPoweredMode | null {
  return SESSION_TYPE_MODES[exerciseType] ?? null;
}

/** Modes a session or step cadence must never overwrite. */
const NEVER_REFINED: ReadonlySet<TransportMode> = new Set([
  "stationary",
  "flying",
  "train",
  "boat",
]);

function overlapMs(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  return Math.max(
    0,
    Math.min(aEnd.getTime(), bEnd.getTime()) - Math.max(aStart.getTime(), bStart.getTime())
  );
}

function segmentMs(seg: TransportSegment): number {
  return seg.endTime.getTime() - seg.startTime.getTime();
}

/** The movement session covering the largest share of the segment, if any. */
export function sessionForSegment(
  seg: TransportSegment,
  sessions: ExerciseSessionEvidence[]
): { mode: HumanPoweredMode; overlap: number } | null {
  const total = segmentMs(seg);
  if (total <= 0) return null;
  let best: { mode: HumanPoweredMode; overlap: number } | null = null;
  for (const s of sessions) {
    const mode = exerciseTypeToMode(s.exerciseType);
    if (!mode) continue;
    const overlap = overlapMs(seg.startTime, seg.endTime, s.start, s.end) / total;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { mode, overlap };
  }
  return best;
}

/**
 * Average steps/min over the segment from ONE source — sources overlap (the phone and
 * the watch both count the same steps), so summing them would double-count. A source
 * is eligible only if it has a sample within `stepCoverageMarginMs` of the segment:
 * an absent row means "zero steps" for a worn tracker but "unknown" for one that was
 * off the wrist. Fitbit wins when eligible; otherwise the densest source near the
 * segment, chosen by sample count rather than step total so the pick is not biased
 * toward on-foot.
 */
export function stepCadenceForSegment(
  seg: TransportSegment,
  steps: StepSampleEvidence[],
  opts: HealthRefineOptions = DEFAULT_HEALTH_REFINE_OPTIONS
): { source: string; stepsPerMinute: number } | null {
  const total = segmentMs(seg);
  if (total < opts.minCadenceWindowSec * 1000) return null;

  const start = seg.startTime.getTime();
  const end = seg.endTime.getTime();
  const nearStart = start - opts.stepCoverageMarginMs;
  const nearEnd = end + opts.stepCoverageMarginMs;

  const nearCount = new Map<string, number>();
  const inWindow = new Map<string, number>();
  for (const s of steps) {
    const t = s.at.getTime();
    // Rows above the cap are daily aggregates, not minute buckets.
    if (s.count > opts.maxStepsPerSample || t < nearStart || t >= nearEnd) continue;
    nearCount.set(s.source, (nearCount.get(s.source) ?? 0) + 1);
    if (t >= start && t < end) inWindow.set(s.source, (inWindow.get(s.source) ?? 0) + s.count);
  }
  if (nearCount.size === 0) return null;

  const source = pickStepSource(nearCount);
  return { source, stepsPerMinute: (inWindow.get(source) ?? 0) / (total / 60_000) };
}

/** Fitbit if present, else the source with most samples (name breaks ties, deterministically). */
function pickStepSource(sampleCounts: Map<string, number>): string {
  if (sampleCounts.has(PREFERRED_STEP_SOURCE)) return PREFERRED_STEP_SOURCE;
  return [...sampleCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/**
 * Below this the walking label is trusted even with zero steps: at a normal walking
 * pace, a step-less segment is far more often a phone riding in a bus or GPS drift
 * than a bike. 7 km/h is the classifier's original walking ceiling; the 7–9 km/h
 * slice it now calls walking is exactly where slow rides hide.
 */
export const CADENCE_BAND_MIN_KMH = 7;

const CADENCE_BAND_MODES: ReadonlySet<TransportMode> = new Set(["walking", "running", "cycling"]);

function isCadenceBand(seg: TransportSegment): boolean {
  return (
    CADENCE_BAND_MODES.has(seg.mode) &&
    seg.avgSpeedKmh > CADENCE_BAND_MIN_KMH &&
    seg.avgSpeedKmh <= RUNNING_MAX_KMH
  );
}

export interface RefinedMode {
  mode: TransportMode;
  confidence: Confidence;
  basis: "session" | "steps" | "classifier";
}

export function refineSegmentMode(
  seg: TransportSegment,
  evidence: HealthEvidence,
  opts: HealthRefineOptions = DEFAULT_HEALTH_REFINE_OPTIONS
): RefinedMode {
  const unchanged: RefinedMode = {
    mode: seg.mode,
    confidence: seg.confidence,
    basis: "classifier",
  };
  if (NEVER_REFINED.has(seg.mode)) return unchanged;

  // 1. Ground truth: a recorded workout, at a speed that workout can reach.
  const session = sessionForSegment(seg, evidence.sessions);
  if (
    session &&
    session.overlap >= opts.sessionOverlapMin &&
    seg.avgSpeedKmh <= opts.sessionSpeedCapKmh[session.mode]
  ) {
    return { mode: session.mode, confidence: "high", basis: "session" };
  }

  // 2. Step cadence, only in the band speed cannot split (CADENCE_BAND_MIN_KMH–20 km/h).
  if (!isCadenceBand(seg)) return unchanged;
  const cadence = stepCadenceForSegment(seg, evidence.steps, opts);
  if (!cadence) return unchanged;
  if (cadence.stepsPerMinute < opts.onFootCadenceMin) {
    return { mode: "cycling", confidence: "medium", basis: "steps" };
  }
  return {
    mode: cadence.stepsPerMinute >= opts.runningCadenceMin ? "running" : "walking",
    confidence: "medium",
    basis: "steps",
  };
}

/**
 * Refine every segment of one track and re-merge neighbours that now share a mode
 * (a ride the classifier had split into cycling/running pieces becomes one segment).
 */
export function refineSegmentsWithHealth(
  segments: TransportSegment[],
  evidence: HealthEvidence,
  opts: HealthRefineOptions = DEFAULT_HEALTH_REFINE_OPTIONS
): TransportSegment[] {
  if (evidence.sessions.length === 0 && evidence.steps.length === 0) return segments;
  const refined = segments.map((seg) => {
    const { mode, confidence } = refineSegmentMode(seg, evidence, opts);
    return mode === seg.mode && confidence === seg.confidence ? seg : { ...seg, mode, confidence };
  });
  return mergeSameMode(refined);
}
