/**
 * Re-run subway matching over `transportation_segments` for a date range.
 *
 * Context (branch fix/track-splitting-stay-detection): `tracks` +
 * `transportation_segments` were just regenerated for 187 days
 * (2026-02-01…2026-08-06) by scripts/backfill-tracks.ts to pick up the fixed
 * stay-splitting buildTracks(). Subway matching runs *on top of*
 * transportation segments and relabels matching segments' `mode` as
 * `"subway"` — regenerating the segments destroyed those labels (the
 * `subway` mode went from 15 segments to 0), so it needs re-running over the
 * same range.
 *
 * This is a thin CLI wrapper around the existing
 * backfillSubwayMatches(userId, from, to) — see
 * src/modules/location/services/subway-match/backfill.ts — the same
 * function POST /api/settings/subway-match-backfill calls. It does NOT
 * reimplement matching or session grouping.
 *
 * Usage:
 *   npx tsx scripts/backfill-subway-matches.ts <userId> <fromDate> <toDate> [--dry-run]
 *   npx tsx scripts/backfill-subway-matches.ts d3f1... 2026-02-01 2026-08-06 --dry-run
 *
 * --dry-run performs NO writes: backfillSubwayMatches() itself writes (it
 * calls matchSubwayTrips + groupMatchesIntoSessions, which insert/update
 * subway_trip_matches and relabel transportation_segments.mode), so a dry
 * run must never call it. Instead it reports the day count and the current
 * per-mode `transportation_segments` counts in the range — particularly how
 * many are currently labelled `subway` — so the operator can compare
 * before/after.
 *
 * Without --dry-run, calls backfillSubwayMatches(userId, date, date) once
 * per day in the range (the function's own internal loop already processes
 * one calendar day at a time via matchSubwayTrips(userId, dateStr) +
 * groupMatchesIntoSessions(userId, dateStr), so calling it with a single-day
 * range per iteration is equivalent to one iteration of the function's own
 * loop — not a reimplementation) and prints a progress line per day, then
 * totals. backfillSubwayMatches swallows per-day matcher/grouper errors
 * internally (logs via logger.error and continues) rather than throwing, so
 * for a single-day call the only signal that day failed is
 * `daysProcessed === 0`; this script treats that as a day failure. A day
 * that failed is skipped; the remaining days still run. The process exits
 * non-zero if any day failed.
 *
 * This script does NOT touch `visits`, `tracks`, or `location_points`, and
 * issues no DDL — it only relabels `transportation_segments.mode` (and
 * subway_trip_matches) via the existing matcher/session-grouper.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";
import { and, count, eq, gte, lt } from "drizzle-orm";

loadEnv({ path: ".env.local" });

// Scripts use relative imports, not the "@/" alias — matches
// scripts/backfill-tracks.ts and scripts/calibrate-subway-matcher.ts.
import { getDb, getPool, transportationSegments } from "../src/db";
import { endOfLocalDay, startOfLocalDay } from "../src/lib/utils";
import { backfillSubwayMatches } from "../src/modules/location/services/subway-match/backfill";
import { parseArgs, resolveDateRange } from "./lib/backfill-args";

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: npx tsx scripts/backfill-subway-matches.ts <userId> <fromDate> <toDate> [--dry-run]"
  );
  exit(1);
}

/** Per-mode transportation_segments counts for the user within [fromDate, toDate] inclusive. */
async function modeCounts(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, number>> {
  const db = getDb();
  const rangeStart = startOfLocalDay(fromDate);
  const rangeEnd = endOfLocalDay(toDate);

  const rows = await db
    .select({ mode: transportationSegments.mode, n: count() })
    .from(transportationSegments)
    .where(
      and(
        eq(transportationSegments.userId, userId),
        gte(transportationSegments.startTime, rangeStart),
        lt(transportationSegments.startTime, rangeEnd)
      )
    )
    .groupBy(transportationSegments.mode);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.mode] = row.n;
  return counts;
}

function formatModeCounts(counts: Record<string, number>): string {
  const modes = Object.keys(counts).sort();
  if (modes.length === 0) return "(no segments in range)";
  return modes.map((m) => `${m}=${counts[m]}`).join(", ");
}

interface DayFailure {
  date: string;
  error: unknown;
}

/** Preview only: SELECTs current per-mode segment counts, writes nothing. */
async function runDryRun(
  userId: string,
  dates: string[],
  fromDate: string,
  toDate: string
): Promise<void> {
  const counts = await modeCounts(userId, fromDate, toDate);
  console.log(`days=${dates.length}`);
  console.log(`current per-mode segment counts: ${formatModeCounts(counts)}`);
  console.log(`current subway segments: ${counts.subway ?? 0}`);
  console.log("\nNo rows were changed.");
}

/** Real run: re-runs matcher + session grouper per day via backfillSubwayMatches. */
async function runApply(userId: string, dates: string[]): Promise<DayFailure[]> {
  const failedDays: DayFailure[] = [];
  let daysProcessed = 0;
  let totalLegs = 0;
  let totalSessions = 0;

  for (const date of dates) {
    try {
      const result = await backfillSubwayMatches(userId, date, date);
      if (result.daysProcessed === 0) {
        // backfillSubwayMatches doesn't throw on a per-day matcher/grouper
        // failure — it logs via logger.error and moves on — so for a
        // single-day call this is the only signal the day failed.
        throw new Error("matcher/session-grouper failed for this day (see the logged error above)");
      }
      daysProcessed += result.daysProcessed;
      totalLegs += result.totalLegs;
      totalSessions += result.totalSessions;
      console.log(`${date}\tlegs=${result.totalLegs}\tsessions=${result.totalSessions}`);
    } catch (error) {
      console.error(`${date}: FAILED — ${error instanceof Error ? error.message : error}`);
      failedDays.push({ date, error });
    }
  }

  console.log(
    `\nAPPLY totals: days=${dates.length}, daysProcessed=${daysProcessed}, legsInserted=${totalLegs}, sessions=${totalSessions}, failedDays=${failedDays.length}`
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
    `${dryRun ? "DRY RUN" : "APPLY"}: backfilling subway matches for ${userId} over ${fromDate} … ${toDate} (${dates.length} day(s))\n`
  );

  if (dryRun) {
    await runDryRun(userId, dates, fromDate, toDate);
    await getPool().end();
    return;
  }

  const failedDays = await runApply(userId, dates);

  const finalCounts = await modeCounts(userId, fromDate, toDate);
  console.log(`\nFinal per-mode segment counts: ${formatModeCounts(finalCounts)}`);
  console.log(`subway segments after run: ${finalCounts.subway ?? 0}`);

  await getPool().end();
  reportFailuresAndExit(failedDays, dates.length);
}

// Only run when executed directly (npx tsx scripts/backfill-subway-matches.ts
// ...), not when imported — e.g. by scripts/backfill-subway-matches.test.ts,
// which needs parseArgs()/resolveDateRange() without triggering a
// live/dry-run or a process.exit() on bad args.
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
