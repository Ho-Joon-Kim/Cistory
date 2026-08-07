/**
 * Backfill road-network matches for existing transportation segments without regenerating
 * visits, tracks, or segments.
 *
 * Usage:
 *   npx tsx scripts/backfill-route-matches.ts <userId> <fromDate> <toDate> [--dry-run]
 *
 * Dry runs execute only a SELECT for the current per-mode distribution. Apply runs require
 * VALHALLA_URL and invoke matchRoutesForDay sequentially, one calendar day at a time, so the
 * two-thread Valhalla service is not saturated by this maintenance job.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";
import { and, count, eq, gte, lte } from "drizzle-orm";

loadEnv({ path: ".env.local" });

import { getDb, getPool, transportationSegments } from "../src/db";
import {
  matchRoutesForDay,
  type RouteMatchSummary,
} from "../src/modules/location/services/route-match/matcher";
import { type ParsedArgs, parseArgs, resolveDateRange } from "./lib/backfill-args";

interface DayFailure {
  date: string;
  error: unknown;
}

type MatchRoutesForDay = (userId: string, date: string) => Promise<RouteMatchSummary>;
type LoadModeCounts = (
  userId: string,
  fromDate: string,
  toDate: string
) => Promise<Record<string, number>>;

interface BackfillDependencies {
  loadModeCounts?: LoadModeCounts;
  log?: (message: string) => void;
  matchRoutesForDay?: MatchRoutesForDay;
  valhallaUrl?: string;
}

export interface RouteMatchBackfillResult {
  dryRun: boolean;
  failedDays: DayFailure[];
}

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: npx tsx scripts/backfill-route-matches.ts <userId> <fromDate> <toDate> [--dry-run]"
  );
  exit(1);
}

/** Per-mode segment counts for an inclusive YYYY-MM-DD date range. */
async function modeCounts(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ mode: transportationSegments.mode, n: count() })
    .from(transportationSegments)
    .where(
      and(
        eq(transportationSegments.userId, userId),
        gte(transportationSegments.date, fromDate),
        lte(transportationSegments.date, toDate)
      )
    )
    .groupBy(transportationSegments.mode);

  return Object.fromEntries(rows.map((row) => [row.mode, row.n]));
}

function formatModeCounts(counts: Record<string, number>): string {
  const modes = Object.keys(counts).sort();
  if (modes.length === 0) return "(no segments in range)";
  return modes.map((mode) => `${mode}=${counts[mode]}`).join(", ");
}

function summaryLine(date: string, summary: RouteMatchSummary): string {
  return [
    date,
    `segments=${summary.segmentsConsidered}`,
    `matched=${summary.matched}`,
    `lowConfidence=${summary.lowConfidence}`,
    `noRoadMatch=${summary.noRoadMatch}`,
    `failed=${summary.failed}`,
    `notApplicable=${summary.notApplicable}`,
    `skipped=${summary.skipped}`,
  ].join("\t");
}

/**
 * Executes the selected backfill mode. Dependencies are injectable so CLI safety can be tested
 * without opening a database connection or contacting Valhalla.
 */
export async function runRouteMatchBackfill(
  args: ParsedArgs,
  dates: string[],
  dependencies: BackfillDependencies = {}
): Promise<RouteMatchBackfillResult> {
  const loadModeCounts = dependencies.loadModeCounts ?? modeCounts;
  const log = dependencies.log ?? console.log;

  if (args.dryRun) {
    const counts = await loadModeCounts(args.userId, args.fromDate, args.toDate);
    const segmentCount = Object.values(counts).reduce((total, value) => total + value, 0);
    log(`days=${dates.length}`);
    log(`segments=${segmentCount}`);
    log(`per-mode segment counts: ${formatModeCounts(counts)}`);
    log("No rows were changed.");
    return { failedDays: [], dryRun: true };
  }

  const valhallaUrl = Object.hasOwn(dependencies, "valhallaUrl")
    ? dependencies.valhallaUrl
    : process.env.VALHALLA_URL;
  if (!valhallaUrl?.trim()) {
    throw new Error("VALHALLA_URL is required for an apply run; refusing to backfill");
  }

  const matcher = dependencies.matchRoutesForDay ?? matchRoutesForDay;
  const failedDays: DayFailure[] = [];
  for (const date of dates) {
    try {
      const summary = await matcher(args.userId, date);
      log(summaryLine(date, summary));
    } catch (error) {
      failedDays.push({ date, error });
      log(`${date}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { failedDays, dryRun: false };
}

function reportFailuresAndExit(failedDays: DayFailure[], totalDays: number): void {
  if (failedDays.length === 0) return;
  console.error(`\n${failedDays.length}/${totalDays} day(s) failed:`);
  for (const { date, error } of failedDays) {
    console.error(`  ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
  exit(1);
}

async function main(): Promise<void> {
  const parsed = parseArgs(argv.slice(2));
  if ("error" in parsed) usageAndExit(parsed.error);

  const range = resolveDateRange(parsed.fromDate, parsed.toDate);
  if ("error" in range) usageAndExit(range.error);

  console.log(
    `${parsed.dryRun ? "DRY RUN" : "APPLY"}: backfilling route matches for ${parsed.userId} over ${parsed.fromDate} … ${parsed.toDate} (${range.length} day(s))\n`
  );

  const result = await runRouteMatchBackfill(parsed, range);
  await getPool().end();
  reportFailuresAndExit(result.failedDays, range.length);
}

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
