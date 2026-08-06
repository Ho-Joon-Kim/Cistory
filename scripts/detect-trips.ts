/**
 * Manual trip detection — detects and persists trips for a user over a range.
 *
 * Idempotent: skips trips that overlap existing ones, so it's safe to re-run or
 * to backfill the full history once and let the weekly cron take over afterwards.
 *
 * Usage:
 *   npx tsx scripts/detect-trips.ts <userId> [from] [to]
 *     from defaults to TRIP_DATA_HORIZON (the earliest visit in the data —
 *       starting any earlier loses nothing)
 *     to   defaults to today (KST)
 *
 * DATABASE_URL must be set (via .env.local or shell env).
 */

import { argv } from "node:process";
import { config as loadEnv } from "dotenv";
import { getPool } from "../src/db";
import {
  detectAndPersistTrips,
  TRIP_DATA_HORIZON,
} from "../src/modules/location/services/trip-detector";

loadEnv({ path: ".env.local" });

function todayKST(): string {
  // en-CA renders as YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export type ResolvedArgs = { userId: string; from: string; to: string } | { error: string };

/** Pure arg resolution, kept separate from main() so it's testable without
 * triggering a DB connection or process.exit() — see the isMainModule guard
 * at the bottom of this file. */
export function resolveArgs(rawArgs: string[]): ResolvedArgs {
  const [userId, fromArg, toArg] = rawArgs;
  if (!userId) {
    return { error: "Usage: npx tsx scripts/detect-trips.ts <userId> [from] [to]" };
  }
  return {
    userId,
    from: fromArg ?? TRIP_DATA_HORIZON,
    to: toArg ?? todayKST(),
  };
}

async function main() {
  const parsed = resolveArgs(argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }
  const { userId, from, to } = parsed;

  console.log(`Detecting trips for ${userId} over ${from} .. ${to} ...`);
  const result = await detectAndPersistTrips(userId, from, to);
  console.log(
    `Done: detected=${result.detected}, inserted=${result.inserted}, skipped=${result.skipped}`
  );
}

// Only run when executed directly (npx tsx scripts/detect-trips.ts ...), not
// when imported — e.g. by scripts/detect-trips.test.ts, which needs
// resolveArgs() without triggering a live DB connection.
const isMainModule = import.meta.url === `file://${argv[1]}`;
if (isMainModule) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await getPool().end();
    });
}
