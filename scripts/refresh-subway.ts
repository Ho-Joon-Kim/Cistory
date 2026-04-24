/**
 * Manual subway refresh — fetches OSM subway data for one or all cities.
 *
 * Usage:
 *   npx tsx scripts/refresh-subway.ts                 # refresh all registered systems
 *   npx tsx scripts/refresh-subway.ts seoul           # refresh only "seoul"
 *   npx tsx scripts/refresh-subway.ts --seed          # run seed (insert SEED_CITIES if empty)
 *   npx tsx scripts/refresh-subway.ts --seed seoul    # seed then refresh one city
 *
 * DATABASE_URL must be set (via .env.local or shell env).
 */

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { getDb, subwaySystems } from "../src/db";
import { getPool } from "../src/db";
import {
  fetchAndPersistSubwaySystem,
  refreshAllSubwaySystems,
  seedSubwaySystemsIfEmpty,
} from "../src/modules/subway/service";

loadEnv({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const shouldSeed = args.includes("--seed");
  const cityKey = args.find((a) => !a.startsWith("--"));

  if (shouldSeed) {
    console.log("Seeding subway_systems (if empty)...");
    await seedSubwaySystemsIfEmpty();
  }

  if (cityKey) {
    const db = getDb();
    const [sys] = await db
      .select()
      .from(subwaySystems)
      .where(eq(subwaySystems.cityKey, cityKey))
      .limit(1);
    if (!sys) {
      console.error(`City "${cityKey}" not found in subway_systems. Did you run --seed?`);
      process.exit(1);
    }
    console.log(`Refreshing ${sys.cityKey} (${sys.cityName})...`);
    const counts = await fetchAndPersistSubwaySystem(sys);
    console.log(`Done: ${counts.lineCount} lines, ${counts.stationCount} stations`);
  } else {
    console.log("Refreshing ALL subway systems...");
    await refreshAllSubwaySystems();
    console.log("All done");
  }
}

main()
  .then(async () => {
    await getPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("refresh-subway failed:", err);
    try {
      await getPool().end();
    } catch {}
    process.exit(1);
  });
