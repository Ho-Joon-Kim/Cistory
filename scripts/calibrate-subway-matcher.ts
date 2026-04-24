/**
 * Calibrate subway matcher weights and thresholds against a labeled dataset.
 *
 * Usage:
 *   npx tsx scripts/calibrate-subway-matcher.ts <labels.csv>
 *
 * CSV format (header row required):
 *   user_id,segment_id,truth_is_subway[,truth_line_ref]
 *   d3...,5b1...,true,2
 *   d3...,5b2...,false
 *
 * Workflow:
 *   1. For each labeled segment, compute the (segment, top-candidate) signals
 *      ONCE: coverage, speedScore, gapScore, stationScore. Cache them.
 *   2. Grid-search weight combinations + thresholds; for each combination
 *      compute predictions and tally precision / recall / F1.
 *   3. Print top-10 configurations sorted by F1 (precision-prioritized
 *      tiebreaker — false positives are worse for user trust).
 *
 * The script does NOT modify the matcher config. Update
 * src/modules/location/services/subway-match/config.ts manually with the
 * winning values, then re-run `/api/settings/subway-match-backfill` to relabel
 * historical matches.
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { getDb, getPool, transportationSegments } from "../src/db";
import { subwayMatchConfig as cfg } from "../src/modules/location/services/subway-match/config";
import {
  fetchCandidateLines,
  fetchSegmentPoints,
  pointsToWkt,
  scoreCandidate,
  type ScoredCandidate,
} from "../src/modules/location/services/subway-match/matcher";

interface Label {
  userId: string;
  segmentId: string;
  truthIsSubway: boolean;
  truthLineRef?: string;
}

interface SegmentSignals {
  segmentId: string;
  truthIsSubway: boolean;
  truthLineRef?: string;
  /** null = no candidate or insufficient data → matcher would never label this segment subway */
  best: ScoredCandidate | null;
}

function parseCsv(path: string): Label[] {
  const raw = readFileSync(path, "utf8").trim();
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have header + at least 1 row");
  const header = lines[0].split(",").map((s) => s.trim());
  const idxUser = header.indexOf("user_id");
  const idxSeg = header.indexOf("segment_id");
  const idxIs = header.indexOf("truth_is_subway");
  const idxRef = header.indexOf("truth_line_ref");
  if (idxUser < 0 || idxSeg < 0 || idxIs < 0) {
    throw new Error("CSV header must include user_id, segment_id, truth_is_subway");
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    return {
      userId: cols[idxUser],
      segmentId: cols[idxSeg],
      truthIsSubway: /^(true|1|yes)$/i.test(cols[idxIs] ?? ""),
      truthLineRef: idxRef >= 0 ? cols[idxRef] || undefined : undefined,
    };
  });
}

async function computeSignals(label: Label): Promise<SegmentSignals> {
  const db = getDb();
  const [seg] = await db
    .select({
      startTime: transportationSegments.startTime,
      endTime: transportationSegments.endTime,
      distanceMeters: transportationSegments.distanceMeters,
    })
    .from(transportationSegments)
    .where(eq(transportationSegments.id, label.segmentId))
    .limit(1);

  if (!seg) {
    return { ...label, best: null };
  }
  if (seg.distanceMeters < cfg.minSegmentLengthMeters) {
    return { ...label, best: null };
  }

  const points = await fetchSegmentPoints(label.userId, seg.startTime, seg.endTime);
  if (points.length < cfg.minSegmentPoints) {
    return { ...label, best: null };
  }

  const candidates = await fetchCandidateLines(pointsToWkt(points));
  if (candidates.length === 0) {
    return { ...label, best: null };
  }

  // Score the highest-coverage candidate. (Calibration is interested in the
  // primary line decision; case-A splits are out of scope here.)
  const top = candidates[0];
  const scored = await scoreCandidate(top, points);
  return { ...label, best: scored };
}

interface Weights {
  coverage: number;
  speed: number;
  gap: number;
  station: number;
}

interface Thresholds {
  minCoverage: number;
  minTotal: number;
}

function* weightGrid(): Generator<Weights> {
  // Grid steps. Total weights must conceptually sum to ~1 but we don't enforce
  // — what matters is the relative scaling, since thresholds adapt.
  const steps = [0.1, 0.2, 0.3, 0.4, 0.5];
  for (const c of steps) {
    for (const sp of steps) {
      for (const g of steps) {
        for (const st of steps) {
          // Constraint: at least one weight per signal (skip near-zero totals).
          const sum = c + sp + g + st;
          if (sum < 0.6 || sum > 1.4) continue;
          yield { coverage: c, speed: sp, gap: g, station: st };
        }
      }
    }
  }
}

function thresholdGrid(): Thresholds[] {
  const result: Thresholds[] = [];
  for (const minCoverage of [0.4, 0.5, 0.6]) {
    for (const minTotal of [0.4, 0.5, 0.55, 0.6, 0.65, 0.7]) {
      result.push({ minCoverage, minTotal });
    }
  }
  return result;
}

interface ConfigResult {
  weights: Weights;
  thresholds: Thresholds;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

function evaluate(
  signals: SegmentSignals[],
  weights: Weights,
  thresholds: Thresholds
): ConfigResult {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const s of signals) {
    let predicted = false;
    if (s.best) {
      const total =
        weights.coverage * s.best.coverage +
        weights.speed * s.best.speed +
        weights.gap * s.best.gap +
        weights.station * s.best.station;
      predicted =
        s.best.coverage >= thresholds.minCoverage && total >= thresholds.minTotal;
    }
    if (predicted && s.truthIsSubway) tp++;
    else if (predicted && !s.truthIsSubway) fp++;
    else if (!predicted && s.truthIsSubway) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { weights, thresholds, tp, fp, fn, tn, precision, recall, f1 };
}

async function main() {
  const csvPath = argv[2];
  if (!csvPath) {
    console.error("Usage: tsx calibrate-subway-matcher.ts <labels.csv>");
    exit(1);
  }
  const labels = parseCsv(csvPath);
  console.log(`Loaded ${labels.length} labels from ${csvPath}`);

  console.log("Computing signals (this hits Overpass-free DB only)…");
  const signals: SegmentSignals[] = [];
  let i = 0;
  for (const label of labels) {
    i++;
    if (i % 5 === 0) process.stdout.write(`.`);
    signals.push(await computeSignals(label));
  }
  console.log();

  const positives = signals.filter((s) => s.truthIsSubway).length;
  const negatives = signals.length - positives;
  console.log(`Signals computed. positives=${positives} negatives=${negatives}`);

  console.log("Grid-searching configurations…");
  const results: ConfigResult[] = [];
  for (const w of weightGrid()) {
    for (const t of thresholdGrid()) {
      results.push(evaluate(signals, w, t));
    }
  }
  // Rank by F1, tiebreak by precision then recall.
  results.sort((a, b) => {
    if (b.f1 !== a.f1) return b.f1 - a.f1;
    if (b.precision !== a.precision) return b.precision - a.precision;
    return b.recall - a.recall;
  });

  console.log(`Evaluated ${results.length} configurations. Top 10 by F1:\n`);
  console.log(
    "rank | weights (cov/sp/gap/st)        | thresh (cov, tot) | TP/FP/FN/TN  | P/R/F1"
  );
  console.log(
    "-----+-------------------------------+-------------------+--------------+--------"
  );
  for (let k = 0; k < Math.min(10, results.length); k++) {
    const r = results[k];
    const w = `${r.weights.coverage.toFixed(2)}/${r.weights.speed.toFixed(2)}/${r.weights.gap.toFixed(2)}/${r.weights.station.toFixed(2)}`;
    const t = `${r.thresholds.minCoverage.toFixed(2)}, ${r.thresholds.minTotal.toFixed(2)}`;
    const cm = `${r.tp}/${r.fp}/${r.fn}/${r.tn}`;
    const stats = `${r.precision.toFixed(2)}/${r.recall.toFixed(2)}/${r.f1.toFixed(2)}`;
    console.log(`${String(k + 1).padStart(4)} | ${w.padEnd(29)} | ${t.padEnd(17)} | ${cm.padEnd(12)} | ${stats}`);
  }

  console.log(
    "\nUpdate src/modules/location/services/subway-match/config.ts with the chosen weights+thresholds, then run /api/settings/subway-match-backfill to relabel history."
  );
  await getPool().end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await getPool().end();
  } catch {}
  exit(1);
});
