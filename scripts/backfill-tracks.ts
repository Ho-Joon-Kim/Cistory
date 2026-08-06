/**
 * Backfill `tracks` + `transportation_segments` for a date range using the
 * fixed stay-splitting buildTracks() (branch fix/track-splitting-stay-detection):
 * a day of GPS points now splits into movement tracks at "stay" intervals
 * rather than only on 30-minute gaps, so tracks generated before this fix
 * (often one 24-hour track per day) need regenerating.
 *
 * Usage:
 *   npx tsx scripts/backfill-tracks.ts <userId> <fromDate> <toDate> [--dry-run]
 *   npx tsx scripts/backfill-tracks.ts d3f1... 2026-02-01 2026-08-06 --dry-run
 *
 * --dry-run performs NO writes: it's the safety check to run before the real
 * pass. Per day it reports the current `tracks` row count vs. the count the
 * new buildTracks() would produce (computed directly, not via
 * detectAndPersistTracks), then prints totals.
 *
 * Without --dry-run, calls the existing detectAndPersistTracks(userId, date)
 * per day — that function deletes and reinserts the day's tracks +
 * transportation_segments inside one transaction, so this script is
 * idempotent and safe to re-run. It does NOT touch `visits` and issues no DDL.
 *
 * A day that throws is logged and skipped; the remaining days still run. The
 * process exits non-zero if any day failed.
 *
 * This script does NOT reset `period_narratives` (status 'ready') or re-run
 * subway matching — see the reminder printed at the end.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";
import { and, asc, count, eq, gte, isNull, lt, lte, or } from "drizzle-orm";

loadEnv({ path: ".env.local" });

// Scripts use relative imports, not the "@/" alias — matches
// scripts/calibrate-track-splitting.ts and scripts/calibrate-subway-matcher.ts.
import { getDb, getPool, locationPoints, tracks } from "../src/db";
import { endOfLocalDay, startOfLocalDay } from "../src/lib/utils";
import { buildTracks, type TrackPoint } from "../src/modules/location/services/track-builder";
import { detectAndPersistTracks } from "../src/modules/location/services/track-persister";
import { parseArgs, resolveDateRange } from "./lib/backfill-args";

/** Same day-window + point filters as track-persister.ts's detectAndPersistTracks. */
async function loadDayPoints(userId: string, dateStr: string): Promise<TrackPoint[]> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  const points = await db
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
        gte(locationPoints.timestamp, dayStart),
        lt(locationPoints.timestamp, dayEnd),
        or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
      )
    )
    .orderBy(asc(locationPoints.timestamp));

  return points;
}

async function currentTrackCount(userId: string, dateStr: string): Promise<number> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  const [row] = await db
    .select({ n: count() })
    .from(tracks)
    .where(
      and(eq(tracks.userId, userId), gte(tracks.startTime, dayStart), lt(tracks.startTime, dayEnd))
    );
  return row?.n ?? 0;
}

async function projectedTrackCount(userId: string, dateStr: string): Promise<number> {
  const points = await loadDayPoints(userId, dateStr);
  return buildTracks(points).length;
}

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: npx tsx scripts/backfill-tracks.ts <userId> <fromDate> <toDate> [--dry-run]"
  );
  exit(1);
}

function printReminder() {
  console.log(
    [
      "",
      "REMINDER — this script did NOT do either of the following; do them manually:",
      "  1. Reset `period_narratives` rows with status 'ready' so their AI narrative",
      "     text gets regenerated against the new track data.",
      "  2. Re-run subway matching (transportation_segments changed underneath it) —",
      "     see /api/settings/subway-match-backfill.",
    ].join("\n")
  );
}

interface DayFailure {
  date: string;
  error: unknown;
}

/** Preview only: SELECTs current vs. projected track counts, writes nothing. */
async function runDryRun(userId: string, dates: string[]): Promise<DayFailure[]> {
  const failedDays: DayFailure[] = [];
  let totalCurrent = 0;
  let totalProjected = 0;
  console.log(["date", "currentTracks", "projectedTracks"].join("\t"));

  for (const date of dates) {
    try {
      const [current, projected] = await Promise.all([
        currentTrackCount(userId, date),
        projectedTrackCount(userId, date),
      ]);
      totalCurrent += current;
      totalProjected += projected;
      console.log([date, current, projected].join("\t"));
    } catch (error) {
      console.error(`${date}: FAILED — ${error instanceof Error ? error.message : error}`);
      failedDays.push({ date, error });
    }
  }

  console.log(
    `\nDRY RUN totals: days=${dates.length}, currentTracks=${totalCurrent}, projectedTracks=${totalProjected}, delta=${totalProjected - totalCurrent}, failedDays=${failedDays.length}`
  );
  console.log("No rows were changed.");
  return failedDays;
}

/** Real run: regenerates tracks + transportation_segments per day via detectAndPersistTracks. */
async function runApply(userId: string, dates: string[]): Promise<DayFailure[]> {
  const failedDays: DayFailure[] = [];
  let totalTracks = 0;
  let totalSegments = 0;

  for (const date of dates) {
    try {
      const result = await detectAndPersistTracks(userId, date);
      totalTracks += result.trackCount;
      totalSegments += result.segmentCount;
      console.log(`${date}\ttracks=${result.trackCount}\tsegments=${result.segmentCount}`);
    } catch (error) {
      console.error(`${date}: FAILED — ${error instanceof Error ? error.message : error}`);
      failedDays.push({ date, error });
    }
  }

  console.log(
    `\nAPPLY totals: days=${dates.length}, tracksWritten=${totalTracks}, segmentsWritten=${totalSegments}, failedDays=${failedDays.length}`
  );
  return failedDays;
}

function reportFailuresAndExit(failedDays: DayFailure[], totalDays: number): void {
  if (failedDays.length === 0) return;
  console.error(`\n${failedDays.length}/${totalDays} day(s) failed:`);
  for (const { date, error } of failedDays) {
    console.error(`  ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
  exit(1);
}

async function main() {
  const parsed = parseArgs(argv.slice(2));
  if ("error" in parsed) usageAndExit(parsed.error);
  const { userId, fromDate, toDate, dryRun } = parsed;

  const rangeResult = resolveDateRange(fromDate, toDate);
  if ("error" in rangeResult) usageAndExit(rangeResult.error);
  const dates = rangeResult;

  console.log(
    `${dryRun ? "DRY RUN" : "APPLY"}: backfilling tracks for ${userId} over ${fromDate} … ${toDate} (${dates.length} day(s))\n`
  );

  const failedDays = dryRun ? await runDryRun(userId, dates) : await runApply(userId, dates);

  printReminder();
  await getPool().end();
  reportFailuresAndExit(failedDays, dates.length);
}

// Only run when executed directly (npx tsx scripts/backfill-tracks.ts ...), not
// when imported — e.g. by scripts/backfill-tracks.test.ts, which needs
// parseArgs()/resolveDateRange() without triggering a live/dry-run or a
// process.exit() on bad args.
const isMainModule = import.meta.url === `file://${argv[1]}`;
if (isMainModule) {
  main().catch(async (error) => {
    console.error(error);
    try {
      await getPool().end();
    } catch {}
    exit(1);
  });
}
