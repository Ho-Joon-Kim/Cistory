/**
 * Calibrate transportation-mode refinement against health data (exercise sessions +
 * per-minute step counts). Read-only: every pooled connection starts with
 * `default_transaction_read_only = on` (via PGOPTIONS), and nothing is written.
 *
 * Usage:
 *   npx tsx scripts/calibrate-mode-vs-health.ts <userId> [fromDate] [toDate]
 *
 * What it does:
 *  1. Re-runs the pure track pipeline (buildTracks → detectTransportModes, no health
 *     evidence) on every KST day that has a movement exercise session, so the segments
 *     are exactly what the current code produces.
 *  2. Labels a segment with its session's mode (BIKING/ELECTRIC_BIKE → cycling,
 *     WALKING/HIKING → walking, RUNNING → running) when the session covers at least
 *     `sessionOverlapMin` of it and its speed is under that mode's cap.
 *  3. Splits days 75/25 by a stable hash of the date. Thresholds are chosen on the
 *     train split only; confusion matrices are reported on the held-out split.
 *  4. Prints the evidence for each constant in DEFAULT_HEALTH_REFINE_OPTIONS
 *     (src/modules/location/services/transportation/health-evidence.ts) and for the
 *     7–20 km/h no-evidence rule in mode-classifier.ts. It never edits them — copy the
 *     winners by hand, then reclassify history.
 *
 * WALKING_MAX in mode-classifier.ts changes segment boundaries, so [4b] cannot rank it
 * on its own; compare the "[5] train accuracy" line across edited values instead
 * (2026-11-10: 7 → 82.0%, 8 → 84.0%, 9 → 85.1%, 10 → 83.1%).
 *
 * Results on 2026-11-10 (the owner, 300 session days, 1,897 segments; held-out 144
 * labelled segments), walking/cycling recall:
 *   legacy classifier (accel > 0.25 ⇒ running)   53.5%  77% / 16%  (43 rides → running)
 *   new classifier, no health evidence            90.3%  92% / 88%
 *   + step cadence (sessions hidden)              91.0%  92% / 89%
 *   + step cadence, step-covered segments only    97.9% 100% / 97%  (legacy: 34.0%)
 * Session-labelled segments are relabelled from the session itself, so they cannot
 * score that path; the matrices above all hide sessions from the classifier.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
// Hard guarantee this script cannot write, whatever DATABASE_URL points at: pg reads
// PGOPTIONS as the startup `options` of every connection the pool opens.
process.env.PGOPTIONS = `${process.env.PGOPTIONS ?? ""} -c default_transaction_read_only=on`.trim();

import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, getPool, healthSamples, locationPoints } from "../src/db";
import { endOfLocalDay, startOfLocalDay, toLocalDateString } from "../src/lib/utils";
import { buildTracks } from "../src/modules/location/services/track-builder";
import { detectTransportModes } from "../src/modules/location/services/transportation/detector";
import {
  CADENCE_BAND_MIN_KMH,
  DEFAULT_HEALTH_REFINE_OPTIONS,
  type ExerciseSessionEvidence,
  exerciseTypeToMode,
  type HealthEvidence,
  type HealthRefineOptions,
  type HumanPoweredMode,
  refineSegmentMode,
  type StepSampleEvidence,
  sessionForSegment,
  stepCadenceForSegment,
} from "../src/modules/location/services/transportation/health-evidence";
import { toExerciseSessions } from "../src/modules/location/services/transportation/health-evidence-loader";
import { RUNNING_MAX_KMH } from "../src/modules/location/services/transportation/mode-classifier";
import type { TransportSegment } from "../src/modules/location/services/transportation/movement-analyzer";

const OPTS = DEFAULT_HEALTH_REFINE_OPTIONS;
const LEGACY_RUNNING_ACCEL = 0.25; // the pre-2026-11 7–20 km/h split

interface Row {
  date: string;
  test: boolean;
  seg: TransportSegment;
  session: { mode: HumanPoweredMode; overlap: number } | null;
  cadence: number | null;
}

/** Stable 75/25 day split (FNV-1a of the date key). */
function isTestDay(date: string): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 4 === 0;
}

function label(row: Row, opts: HealthRefineOptions = OPTS): HumanPoweredMode | null {
  const s = row.session;
  if (!s || s.overlap < opts.sessionOverlapMin) return null;
  if (row.seg.mode === "stationary" || row.seg.mode === "flying" || row.seg.mode === "train") {
    return null;
  }
  return row.seg.avgSpeedKmh <= opts.sessionSpeedCapKmh[s.mode] ? s.mode : null;
}

function inBand(seg: TransportSegment): boolean {
  return seg.avgSpeedKmh > CADENCE_BAND_MIN_KMH && seg.avgSpeedKmh <= RUNNING_MAX_KMH;
}

/** The pre-change classifier's band rule, re-applied to the current segment features. */
function legacyMode(seg: TransportSegment): string {
  if (!inBand(seg)) return seg.mode;
  return seg.avgAcceleration > LEGACY_RUNNING_ACCEL ? "running" : "cycling";
}

function confusion(title: string, pairs: { truth: string; pred: string }[]): void {
  const truths = ["walking", "running", "cycling"];
  const preds = [...new Set(pairs.map((p) => p.pred))].sort();
  const table: Record<string, Record<string, number | string>> = {};
  for (const t of truths) {
    const rows = pairs.filter((p) => p.truth === t);
    if (rows.length === 0) continue;
    const line: Record<string, number | string> = {};
    for (const p of preds) line[p] = rows.filter((r) => r.pred === p).length;
    line.recall = `${((rows.filter((r) => r.pred === t).length / rows.length) * 100).toFixed(0)}%`;
    table[t] = line;
  }
  const correct = pairs.filter((p) => p.truth === p.pred).length;
  console.log(
    `\n${title} — accuracy ${correct}/${pairs.length} (${((correct / Math.max(1, pairs.length)) * 100).toFixed(1)}%)`
  );
  console.table(table);
}

function quantiles(values: number[]): string {
  if (values.length === 0) return "n=0";
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.floor(p * (s.length - 1))].toFixed(1);
  return `n=${s.length} p05=${q(0.05)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p95=${q(0.95)} max=${q(1)}`;
}

async function loadEvidence(userId: string, from: Date, to: Date) {
  const db = getDb();
  const exerciseRows = await db
    .select({
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
      value: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, userId),
        eq(healthSamples.metric, "exercise"),
        gte(healthSamples.sampleAt, new Date(from.getTime() - 86_400_000)),
        lt(healthSamples.sampleAt, to)
      )
    );
  const stepRows = await db
    .select({
      at: healthSamples.sampleAt,
      source: healthSamples.source,
      count: healthSamples.value,
    })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, userId),
        eq(healthSamples.metric, "steps"),
        gte(healthSamples.sampleAt, new Date(from.getTime() - OPTS.stepCoverageMarginMs)),
        lt(healthSamples.sampleAt, new Date(to.getTime() + OPTS.stepCoverageMarginMs))
      )
    );
  const sessions = toExerciseSessions(exerciseRows);
  const steps: StepSampleEvidence[] = stepRows.flatMap((r) =>
    r.count == null ? [] : [{ at: r.at, source: r.source, count: r.count }]
  );
  return { sessions, steps };
}

function movementDays(sessions: ExerciseSessionEvidence[], from: string, to: string): string[] {
  const days = new Set<string>();
  for (const s of sessions) {
    if (!exerciseTypeToMode(s.exerciseType)) continue;
    for (const d of [toLocalDateString(s.start), toLocalDateString(s.end)]) {
      if (d >= from && d <= to) days.add(d);
    }
  }
  return [...days].sort();
}

async function segmentsForDay(userId: string, date: string): Promise<TransportSegment[]> {
  const points = await getDb()
    .select({
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      altitude: locationPoints.altitude,
      velocity: locationPoints.velocity,
      timestamp: locationPoints.timestamp,
    })
    .from(locationPoints)
    .where(
      and(
        eq(locationPoints.userId, userId),
        gte(locationPoints.timestamp, startOfLocalDay(date)),
        lt(locationPoints.timestamp, endOfLocalDay(date)),
        or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
      )
    )
    .orderBy(asc(locationPoints.timestamp));
  return buildTracks(points).flatMap((track) => detectTransportModes(track.points));
}

/**
 * Sweep `value ≥ t ⇒ positive`. Picks by plain accuracy when `by` is "accuracy" (the
 * rule is applied to exactly this population, so its base rate is the real one), else
 * by balanced accuracy (the classes come from how often sessions happen to be logged).
 */
function sweep(
  title: string,
  rows: { value: number; positive: boolean }[],
  candidates: number[],
  by: "accuracy" | "balanced" = "balanced"
): number {
  const pos = rows.filter((r) => r.positive);
  const neg = rows.filter((r) => !r.positive);
  let best = { t: candidates[0], score: -1 };
  const out: Record<string, string>[] = [];
  for (const t of candidates) {
    const tpr = pos.filter((r) => r.value >= t).length / Math.max(1, pos.length);
    const tnr = neg.filter((r) => r.value < t).length / Math.max(1, neg.length);
    const score = (tpr + tnr) / 2;
    const correct = pos.filter((r) => r.value >= t).length + neg.filter((r) => r.value < t).length;
    out.push({
      t: String(t),
      tpr: tpr.toFixed(3),
      tnr: tnr.toFixed(3),
      balanced: score.toFixed(3),
      accuracy: `${correct}/${rows.length}`,
    });
    const objective = by === "accuracy" ? correct / Math.max(1, rows.length) : score;
    if (objective > best.score) best = { t, score: objective };
  }
  console.log(`\n${title} (positives=${pos.length}, negatives=${neg.length})`);
  console.table(out);
  console.log(`→ best ${best.t} (${by} ${best.score.toFixed(3)})`);
  return best.t;
}

async function main() {
  const [userId, from = "2025-01-01", to = toLocalDateString(new Date())] = argv.slice(2);
  if (!userId) {
    console.error("usage: npx tsx scripts/calibrate-mode-vs-health.ts <userId> [from] [to]");
    exit(1);
  }

  const evidence = await loadEvidence(userId, startOfLocalDay(from), endOfLocalDay(to));
  const days = movementDays(evidence.sessions, from, to);
  console.log(
    `sessions (deduped): ${evidence.sessions.length}, step rows: ${evidence.steps.length}, days with movement sessions: ${days.length}`
  );

  const rows: Row[] = [];
  for (const date of days) {
    const test = isTestDay(date);
    for (const seg of await segmentsForDay(userId, date)) {
      const cad = stepCadenceForSegment(seg, evidence.steps, OPTS);
      rows.push({
        date,
        test,
        seg,
        session: sessionForSegment(seg, evidence.sessions),
        cadence: cad ? cad.stepsPerMinute : null,
      });
    }
  }
  const train = rows.filter((r) => !r.test);
  const test = rows.filter((r) => r.test);
  console.log(`segments: ${rows.length} (train ${train.length}, test ${test.length})`);

  // ── 1. Overlap threshold: does the session label agree with step cadence? ─────
  const agreeRows: Record<string, Record<string, string | number>> = {};
  for (let lo = 0; lo < 1; lo += 0.1) {
    const bucket = train.filter(
      (r) =>
        r.session &&
        r.cadence !== null &&
        r.session.overlap >= lo &&
        r.session.overlap < lo + 0.1 + (lo >= 0.9 ? 1e-9 : 0) &&
        r.seg.mode !== "stationary"
    );
    const agree = bucket.filter((r) =>
      r.session?.mode === "cycling"
        ? (r.cadence ?? 0) < OPTS.onFootCadenceMin
        : (r.cadence ?? 0) >= OPTS.onFootCadenceMin
    );
    agreeRows[`${lo.toFixed(1)}–${(lo + 0.1).toFixed(1)}`] = {
      segments: bucket.length,
      cadenceAgrees: bucket.length ? `${((agree.length / bucket.length) * 100).toFixed(0)}%` : "-",
    };
  }
  console.log("\n[1] session-label vs cadence agreement by overlap share (train)");
  console.table(agreeRows);

  // ── 2. Speed caps: where does cadence stop agreeing with the session? ─────────
  console.log("\n[2] avg speed of segments ≥ overlap threshold, by session mode (train)");
  for (const mode of ["cycling", "walking", "running"] as const) {
    const r = train.filter(
      (x) => x.session?.mode === mode && x.session.overlap >= OPTS.sessionOverlapMin
    );
    console.log(`  ${mode}: ${quantiles(r.map((x) => x.seg.avgSpeedKmh))}`);
    if (mode === "walking") {
      // Walking sessions run long and swallow bus/subway legs, so the cap is where
      // step cadence stops saying "on foot".
      const pairs = r
        .filter((x) => x.cadence !== null && x.seg.avgSpeedKmh > CADENCE_BAND_MIN_KMH)
        .sort((a, b) => a.seg.avgSpeedKmh - b.seg.avgSpeedKmh)
        .map((x) => `${x.seg.avgSpeedKmh.toFixed(1)}km/h:${(x.cadence ?? 0).toFixed(0)}spm`);
      console.log(`    > 7 km/h with step coverage (speed:cadence): ${pairs.join(", ")}`);
    }
    console.log(
      `    speeds > 20 km/h: ${r
        .filter((x) => x.seg.avgSpeedKmh > 20)
        .map((x) => x.seg.avgSpeedKmh.toFixed(1))
        .sort((a, b) => Number(a) - Number(b))
        .join(", ")}`
    );
  }

  // ── 3. Cadence threshold (on foot vs cycling) ─────────────────────────────────
  // Only the 7–20 km/h band: that is the only place refineSegmentMode consults cadence.
  const cadTrain = train.flatMap((r) => {
    const l = label(r);
    return l && r.cadence !== null && inBand(r.seg)
      ? [{ value: r.cadence, positive: l !== "cycling" }]
      : [];
  });
  console.log(
    `\n[3] cadence by label (train): cycling ${quantiles(cadTrain.filter((r) => !r.positive).map((r) => r.value))}`
  );
  console.log(
    `                             on-foot ${quantiles(cadTrain.filter((r) => r.positive).map((r) => r.value))}`
  );
  const bestCad = sweep(
    "on-foot cadence threshold sweep (steps/min, train, 7–20 km/h band)",
    cadTrain,
    [10, 20, 30, 40, 45, 50, 55, 60, 70, 80],
    "accuracy"
  );

  // ── 4. No-evidence band rule (7–20 km/h) ──────────────────────────────────────
  const bandTrain = train.filter((r) => label(r) && inBand(r.seg));
  const bandOut: Record<string, string>[] = [];
  for (const t of [0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, Number.POSITIVE_INFINITY]) {
    const ok = bandTrain.filter(
      (r) => (r.seg.avgAcceleration > t ? "running" : "cycling") === label(r)
    ).length;
    bandOut.push({
      rule: Number.isFinite(t) ? `accel > ${t} ⇒ running` : "always cycling",
      accuracy: `${ok}/${bandTrain.length} (${((ok / Math.max(1, bandTrain.length)) * 100).toFixed(1)}%)`,
    });
  }
  console.log("\n[4] 7–20 km/h no-evidence rule (train, labelled band segments)");
  console.table(bandOut);
  const bandLabels: Record<string, number> = {};
  for (const r of bandTrain) {
    const l = label(r) ?? "none";
    bandLabels[l] = (bandLabels[l] ?? 0) + 1;
  }
  console.log("  labels inside the band:", bandLabels);

  // Walking/cycling speed boundary with no evidence: is 7 km/h still right?
  const slowTrain = train.flatMap((r) => {
    const l = label(r);
    return l && l !== "running" && r.seg.avgSpeedKmh > 1 && r.seg.avgSpeedKmh <= RUNNING_MAX_KMH
      ? [{ value: r.seg.avgSpeedKmh, positive: l === "cycling" }]
      : [];
  });
  sweep(
    "[4b] walking/cycling speed boundary (km/h, train; ≥ t ⇒ cycling)",
    slowTrain,
    [6, 7, 8, 9, 10, 11, 12]
  );

  // ── 5. Held-out confusion matrices ────────────────────────────────────────────
  if (bestCad !== OPTS.onFootCadenceMin) {
    console.log(
      `\nNOTE: train-optimal cadence ${bestCad} ≠ configured ${OPTS.onFootCadenceMin}; matrices below use the configured value.`
    );
  }
  const labelled = (set: Row[]) => set.flatMap((r) => (label(r) ? [{ r, truth: label(r)! }] : []));
  const testLabelled = labelled(test);
  // Self-consistent train score of the pipeline as configured: compare it across
  // classifier edits (e.g. WALKING_MAX) — [4b] alone is computed on segments whose
  // boundaries were drawn by the current WALKING_MAX, so it cannot rank them.
  const trainLabelled = labelled(train);
  const trainOk = trainLabelled.filter(({ r, truth }) => r.seg.mode === truth).length;
  console.log(
    `\n[5] train accuracy of the current classifier (no evidence): ${trainOk}/${trainLabelled.length} (${((trainOk / Math.max(1, trainLabelled.length)) * 100).toFixed(1)}%)`
  );
  const stepsOnly: HealthEvidence = { sessions: [], steps: evidence.steps };
  confusion(
    "[5a] BEFORE — legacy classifier (accel > 0.25 ⇒ running), held-out days",
    testLabelled.map(({ r, truth }) => ({ truth, pred: legacyMode(r.seg) }))
  );
  confusion(
    "[5b] AFTER, no health evidence — current classifier only, held-out days",
    testLabelled.map(({ r, truth }) => ({ truth, pred: r.seg.mode }))
  );
  confusion(
    "[5c] AFTER, steps only (sessions hidden) — held-out days",
    testLabelled.map(({ r, truth }) => ({
      truth,
      pred: refineSegmentMode(r.seg, stepsOnly, OPTS).mode,
    }))
  );
  const withSteps = testLabelled.filter(({ r }) => r.cadence !== null);
  confusion(
    "[5d] AFTER, steps only, restricted to segments that have step coverage — held-out days",
    withSteps.map(({ r, truth }) => ({
      truth,
      pred: refineSegmentMode(r.seg, stepsOnly, OPTS).mode,
    }))
  );
  confusion(
    "[5e] BEFORE on the same step-covered subset — held-out days",
    withSteps.map(({ r, truth }) => ({ truth, pred: legacyMode(r.seg) }))
  );

  // ── 6. Impact on the whole calibration set (all days, with full evidence) ─────
  const changes: Record<string, number> = {};
  for (const r of rows) {
    const after = refineSegmentMode(r.seg, evidence, OPTS).mode;
    const before = legacyMode(r.seg);
    if (after !== before)
      changes[`${before} → ${after}`] = (changes[`${before} → ${after}`] ?? 0) + 1;
  }
  console.log("\n[6] mode changes legacy → refined (all segments on session days)");
  console.table(changes);

  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await getPool().end();
  } catch {}
  exit(1);
});
