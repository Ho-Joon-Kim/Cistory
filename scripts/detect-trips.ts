/**
 * Manual trip detection — detects and persists trips for a user over a range.
 *
 * Idempotent: skips trips that overlap existing ones, so it's safe to re-run or
 * to backfill the full history once and let the weekly cron take over afterwards.
 *
 * Usage:
 *   npx tsx scripts/detect-trips.ts <userId> [from] [to]
 *     from defaults to 2020-01-01
 *     to   defaults to today (KST)
 *
 * DATABASE_URL must be set (via .env.local or shell env).
 */

import { config as loadEnv } from "dotenv";
import { getPool } from "../src/db";
import { detectAndPersistTrips } from "../src/modules/location/services/trip-detector";

loadEnv({ path: ".env.local" });

function todayKST(): string {
  // en-CA renders as YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

async function main() {
  const [userId, fromArg, toArg] = process.argv.slice(2);
  if (!userId) {
    console.error("Usage: npx tsx scripts/detect-trips.ts <userId> [from] [to]");
    process.exit(1);
  }

  const from = fromArg ?? "2020-01-01";
  const to = toArg ?? todayKST();

  console.log(`Detecting trips for ${userId} over ${from} .. ${to} ...`);
  const result = await detectAndPersistTrips(userId, from, to);
  console.log(
    `Done: detected=${result.detected}, inserted=${result.inserted}, skipped=${result.skipped}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
