/**
 * Backfills missing per-user KST daily location heatmaps.
 *
 * Preview: yarn location:backfill-heatmaps
 * Apply:   yarn location:backfill-heatmaps --apply
 * Options: --limit=250 --batch-size=25 --user=<uuid> --from=YYYY-MM-DD --to=YYYY-MM-DD
 */

import { config } from "dotenv";
import { getDb, getPool } from "../src/db";
import {
  backfillMissingLocationHeatmaps,
  parseHeatmapBackfillOptions,
} from "../src/modules/location/heatmap-backfill";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const options = parseHeatmapBackfillOptions(process.argv.slice(2));
  console.log(
    `${options.apply ? "APPLY" : "DRY RUN"}: limit=${options.limit}, batchSize=${options.batchSize}`
  );

  const result = await backfillMissingLocationHeatmaps(getDb(), options, {
    onRebuilt(candidate, rebuilt) {
      console.log(`Rebuilt ${rebuilt}/${options.limit}: ${candidate.userId} ${candidate.date}`);
    },
  });

  if (result.mode === "dry-run") {
    for (const candidate of result.candidates) {
      console.log(`${candidate.userId}\t${candidate.date}`);
    }
    console.log(`Previewed ${result.candidates.length} missing user-days; no rows were changed.`);
    return;
  }
  console.log(`Completed: rebuilt=${result.rebuilt}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
