/**
 * Calibrate the personal travel-time matcher (src/modules/location/travel-time.ts):
 * the endpoint radius, the minimum sample count, and the adjacent-visit tolerance.
 * Read-only: every pooled connection starts with `default_transaction_read_only = on`
 * (via PGOPTIONS), and nothing is written.
 *
 * Usage:
 *   npx tsx scripts/calibrate-travel-time-radius.ts <userId> [lookbackDays=365]
 *
 * What it measures:
 *  [1] Adjacent-visit gap: for every track, how far (seconds) the nearest visit end
 *      sits from the track start and the nearest visit start from the track end, and
 *      the share of tracks that get both neighbours at several tolerances.
 *  [2] Radius: ground truth is journeys whose origin AND destination visits are pinned
 *      to saved places (`visits.saved_place_id`). For each frequent pinned pair (A, B)
 *      and each radius r, a coordinate-only query around A's and B's coordinates (what
 *      the tool does for coordinate input) is scored by
 *        recall   = pinned A→B journeys retrieved / pinned A→B journeys
 *        mismatch = retrieved journeys pinned to some OTHER place on either side
 *                   / retrieved journeys
 *      Days are split 75/25 by a stable hash; the radius is chosen on the train split
 *      and reported on the held-out split.
 *  [3] Split journeys: how often an A→B trip shows up only as two tracks chained
 *      through a short stop (the second track starting within 30 min of the first's
 *      end with the stop under 15 min), which a single-track query cannot see.
 *  [4] Minimum samples: for pairs with ≥ 10 journeys of one mode, how far the median of
 *      the first k journeys lands from the full median, for k = 2..5.
 *
 * It never edits the constants — copy the recommendation into travel-time.ts by hand,
 * with the numbers next to the constant.
 */

import { argv, exit } from "node:process";
import { toKstCalendarDate } from "../src/lib/date-key";
import { distanceM } from "../src/lib/geo";
import {
  deriveJourneys,
  type Journey,
  quantileR7,
  type TrackRow,
  type VisitRow,
} from "../src/modules/location/travel-time";

export const RADII_M = [100, 200, 300, 500, 800] as const;
export const TOLERANCES_SEC = [120, 300, 600, 900, 1800] as const;
export const MIN_PAIR_JOURNEYS = 5;
export const TARGET_RECALL = 0.9;
export const MAX_MISMATCH = 0.05;
const CHAIN_MAX_GAP_MS = 30 * 60_000;
const CHAIN_MAX_STOP_MS = 15 * 60_000;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Stable 75/25 split (FNV-1a of the KST date key). */
export function isTestDay(dateKey: string): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 4 === 0;
}

export interface Anchor {
  id: string;
  lat: number;
  lon: number;
}

export interface PairScore {
  truth: number;
  retrieved: number;
  hit: number;
  mismatched: number;
}

/** Score one (A, B) pair at one radius over a journey list. */
export function scorePair(
  journeys: readonly Journey[],
  a: Anchor,
  b: Anchor,
  radiusM: number
): PairScore {
  let truth = 0;
  let retrieved = 0;
  let hit = 0;
  let mismatched = 0;
  for (const j of journeys) {
    const isTruth = j.origin.savedPlaceId === a.id && j.destination.savedPlaceId === b.id;
    const near =
      distanceM(j.origin.centerLat, j.origin.centerLon, a.lat, a.lon) <= radiusM &&
      distanceM(j.destination.centerLat, j.destination.centerLon, b.lat, b.lon) <= radiusM;
    if (isTruth) truth++;
    if (!near) continue;
    retrieved++;
    if (isTruth) hit++;
    const wrongOrigin = j.origin.savedPlaceId !== null && j.origin.savedPlaceId !== a.id;
    const wrongDest = j.destination.savedPlaceId !== null && j.destination.savedPlaceId !== b.id;
    if (wrongOrigin || wrongDest) mismatched++;
  }
  return { truth, retrieved, hit, mismatched };
}

export function sumScores(scores: readonly PairScore[]): {
  recall: number | null;
  mismatch: number | null;
} {
  const t = scores.reduce(
    (s, x) => ({
      truth: s.truth + x.truth,
      retrieved: s.retrieved + x.retrieved,
      hit: s.hit + x.hit,
      mismatched: s.mismatched + x.mismatched,
    }),
    { truth: 0, retrieved: 0, hit: 0, mismatched: 0 }
  );
  return {
    recall: t.truth > 0 ? t.hit / t.truth : null,
    mismatch: t.retrieved > 0 ? t.mismatched / t.retrieved : null,
  };
}

/** Smallest radius meeting both targets, else the one with the best recall under the mismatch cap. */
export function pickRadius(
  byRadius: ReadonlyArray<{ radiusM: number; recall: number | null; mismatch: number | null }>
): number | null {
  const scored = byRadius.filter((r) => r.recall !== null);
  const meeting = scored.filter(
    (r) => (r.recall ?? 0) >= TARGET_RECALL && (r.mismatch ?? 0) <= MAX_MISMATCH
  );
  if (meeting.length > 0) return Math.min(...meeting.map((r) => r.radiusM));
  const capped = scored.filter((r) => (r.mismatch ?? 0) <= MAX_MISMATCH);
  if (capped.length === 0) return null;
  return capped.reduce((best, r) => ((r.recall ?? 0) > (best.recall ?? 0) ? r : best)).radiusM;
}

/**
 * Count consecutive track pairs chained through a short stop: the second starts
 * within CHAIN_MAX_GAP_MS of the first's end and any visit between them is
 * shorter than CHAIN_MAX_STOP_MS.
 */
export function countChainedTracks(
  tracks: readonly TrackRow[],
  visits: readonly VisitRow[]
): { chains: number; tracks: number } {
  const sorted = [...tracks].sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
  let chains = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endTime.getTime();
    const nextStart = sorted[i].startTime.getTime();
    if (nextStart - prevEnd > CHAIN_MAX_GAP_MS || nextStart < prevEnd) continue;
    const longStop = visits.some(
      (v) =>
        v.startTime.getTime() < nextStart &&
        v.endTime.getTime() > prevEnd &&
        v.endTime.getTime() - v.startTime.getTime() >= CHAIN_MAX_STOP_MS
    );
    if (!longStop) chains++;
  }
  return { chains, tracks: sorted.length };
}

/** |median(first k) − median(all)| / median(all) for each k. */
export function medianDrift(minutesInOrder: readonly number[], ks: readonly number[]): number[] {
  const full = quantileR7(
    [...minutesInOrder].sort((a, b) => a - b),
    0.5
  );
  return ks.map((k) => {
    const head = quantileR7(
      minutesInOrder.slice(0, k).sort((a, b) => a - b),
      0.5
    );
    return full && head !== null ? Math.abs(head - full) / full : Number.NaN;
  });
}

function pct(n: number | null): string {
  return n === null ? "-" : `${(n * 100).toFixed(1)}%`;
}

function nearestGapSec(keys: number[], target: number): number {
  let best = Number.POSITIVE_INFINITY;
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < keys.length) best = Math.min(best, Math.abs(keys[i] - target) / 1000);
  }
  return best;
}

// ── Reports ──────────────────────────────────────────────────────────────────

const sortedAsc = (xs: readonly number[]) => xs.filter(Number.isFinite).sort((a, b) => a - b);

function reportAdjacency(trackRows: TrackRow[], visitRows: VisitRow[]): void {
  const endKeys = visitRows.map((v) => v.endTime.getTime()).sort((a, b) => a - b);
  const startKeys = visitRows.map((v) => v.startTime.getTime()).sort((a, b) => a - b);
  const originGaps = trackRows.map((t) => nearestGapSec(endKeys, t.startTime.getTime()));
  const destGaps = trackRows.map((t) => nearestGapSec(startKeys, t.endTime.getTime()));
  const q = (xs: number[], p: number) => quantileR7(sortedAsc(xs), p)?.toFixed(0) ?? "-";
  console.log("\n[1] nearest visit gap (seconds)");
  console.table({
    origin: { p50: q(originGaps, 0.5), p80: q(originGaps, 0.8), p95: q(originGaps, 0.95) },
    destination: { p50: q(destGaps, 0.5), p80: q(destGaps, 0.8), p95: q(destGaps, 0.95) },
  });
  const tolTable: Record<string, string> = {};
  for (const tol of TOLERANCES_SEC) {
    const { journeys } = deriveJourneys(trackRows, visitRows, tol);
    tolTable[`${tol}s`] = pct(trackRows.length ? journeys.length / trackRows.length : null);
  }
  console.log("tracks with both neighbours, by tolerance");
  console.table(tolTable);
}

/** Pinned (A, B) pairs with at least MIN_PAIR_JOURNEYS journeys. */
function frequentPinnedPairs(
  journeys: readonly Journey[],
  anchors: ReadonlyMap<string, Anchor>
): [Anchor, Anchor][] {
  const pairCounts = new Map<string, number>();
  for (const j of journeys) {
    const a = j.origin.savedPlaceId;
    const b = j.destination.savedPlaceId;
    if (!a || !b || a === b) continue;
    pairCounts.set(`${a}|${b}`, (pairCounts.get(`${a}|${b}`) ?? 0) + 1);
  }
  const pairs: [Anchor, Anchor][] = [];
  for (const [key, n] of pairCounts) {
    const [a, b] = key.split("|").map((id) => anchors.get(id));
    if (n >= MIN_PAIR_JOURNEYS && a && b) pairs.push([a, b]);
  }
  return pairs;
}

function reportRadius(journeys: Journey[], anchors: ReadonlyMap<string, Anchor>): number | null {
  const pairs = frequentPinnedPairs(journeys, anchors);
  console.log(`\n[2] frequent pinned pairs (≥ ${MIN_PAIR_JOURNEYS} journeys): ${pairs.length}`);
  const evaluate = (list: Journey[]) =>
    RADII_M.map((radiusM) => ({
      radiusM,
      ...sumScores(pairs.map(([a, b]) => scorePair(list, a, b, radiusM))),
    }));
  const trainRows = evaluate(journeys.filter((j) => !isTestDay(toKstCalendarDate(j.startTime))));
  const testRows = evaluate(journeys.filter((j) => isTestDay(toKstCalendarDate(j.startTime))));
  console.table(
    Object.fromEntries(
      RADII_M.map((r, i) => [
        `${r} m`,
        {
          trainRecall: pct(trainRows[i].recall),
          trainMismatch: pct(trainRows[i].mismatch),
          testRecall: pct(testRows[i].recall),
          testMismatch: pct(testRows[i].mismatch),
        },
      ])
    )
  );
  return pickRadius(trainRows);
}

function reportMinSamples(journeys: readonly Journey[]): number | undefined {
  const ks = [2, 3, 4, 5];
  const drifts: number[][] = ks.map(() => []);
  const groups = new Map<string, Journey[]>();
  for (const j of journeys) {
    if (!j.origin.savedPlaceId || !j.destination.savedPlaceId) continue;
    const key = `${j.origin.savedPlaceId}|${j.destination.savedPlaceId}|${j.mode}`;
    const list = groups.get(key);
    if (list) list.push(j);
    else groups.set(key, [j]);
  }
  for (const list of groups.values()) {
    if (list.length < 10) continue;
    const ordered = [...list]
      .sort((x, y) => x.startTime.getTime() - y.startTime.getTime())
      .map((j) => j.durationSeconds / 60);
    medianDrift(ordered, ks).forEach((d, i) => {
      if (Number.isFinite(d)) drifts[i].push(d);
    });
  }
  console.log(
    "\n[4] |median(first k) − median(all)| / median(all), pinned pair×mode groups with ≥ 10"
  );
  console.table(
    Object.fromEntries(
      ks.map((k, i) => [
        `k=${k}`,
        {
          groups: drifts[i].length,
          p50: pct(quantileR7(sortedAsc(drifts[i]), 0.5)),
          p80: pct(quantileR7(sortedAsc(drifts[i]), 0.8)),
        },
      ])
    )
  );
  return ks.find((_, i) => {
    const p80 = quantileR7(sortedAsc(drifts[i]), 0.8);
    return p80 !== null && p80 <= 0.15;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  // Hard guarantee this script cannot write: pg reads PGOPTIONS as the startup
  // `options` of every connection the (lazily created) pool opens.
  process.env.PGOPTIONS =
    `${process.env.PGOPTIONS ?? ""} -c default_transaction_read_only=on`.trim();

  const userId = argv[2];
  const lookbackDays = Number(argv[3] ?? 365);
  if (!userId || !Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    console.error("usage: npx tsx scripts/calibrate-travel-time-radius.ts <userId> [lookbackDays]");
    exit(1);
  }

  const { eq } = await import("drizzle-orm");
  const { getDb, getPool, savedPlaces } = await import("../src/db");
  const { loadTracksAndVisits } = await import("../src/modules/location/travel-time");
  const db = getDb();
  const until = new Date();
  const since = new Date(until.getTime() - lookbackDays * 86_400_000);

  const { trackRows, visitRows, truncated } = await loadTracksAndVisits(userId, since, until, db);
  const places = await db
    .select({ id: savedPlaces.id, lat: savedPlaces.lat, lon: savedPlaces.lon })
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));
  console.log(
    `tracks ${trackRows.length}${truncated ? " (truncated)" : ""}, visits ${visitRows.length}, saved places ${places.length}`
  );

  reportAdjacency(trackRows, visitRows);
  const { journeys } = deriveJourneys(trackRows, visitRows);
  const chosen = reportRadius(journeys, new Map(places.map((p) => [p.id, p])));

  const { chains, tracks } = countChainedTracks(trackRows, visitRows);
  console.log(
    `\n[3] consecutive tracks chained through a < 15 min stop: ${chains} of ${tracks} tracks (${pct(tracks ? chains / tracks : null)})`
  );

  const minK = reportMinSamples(journeys);

  console.log("\nRecommendation (copy by hand into src/modules/location/travel-time.ts):");
  console.log(
    `  TRAVEL_TIME_RADIUS_M     = ${chosen ?? "(no pinned pairs — keep 300)"}  (target recall ≥ ${pct(TARGET_RECALL)}, mismatch ≤ ${pct(MAX_MISMATCH)} on train)`
  );
  console.log(
    `  TRAVEL_TIME_MIN_SAMPLES  = ${minK ?? "(not enough data — keep 3)"}  (median of first k within 15% of the full median for 80% of groups)`
  );
  console.log("  ADJACENT_VISIT_TOLERANCE_SEC: pick from [1] — the p95 gap, rounded up");

  await getPool().end();
}

if (process.argv[1]?.endsWith("calibrate-travel-time-radius.ts")) {
  main().catch(async (error) => {
    console.error(error);
    try {
      const { getPool } = await import("../src/db");
      await getPool().end();
    } catch {}
    exit(1);
  });
}
