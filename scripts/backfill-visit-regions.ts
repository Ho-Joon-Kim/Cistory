/**
 * Backfill `place_cache.region`/`country` and `visits.city`/`country_name`
 * now that the geocoding adapters read structured region/country fields
 * (Task 1-4 of this feature) instead of guessing from an address string.
 * Every `place_cache` row predates migration 0040 and holds `region`/
 * `country` as null; this script re-geocodes each stale cache row and
 * propagates the result to every `visits` row that shares its coordinate.
 *
 * Usage:
 *   npx tsx scripts/backfill-visit-regions.ts <userId> [--dry-run]
 *   npx tsx scripts/backfill-visit-regions.ts 033ddddc-... --dry-run
 *
 * Steps:
 *   1. Load `place_cache` (`region IS NULL` = this run's re-geocode target).
 *      `place_cache` has no `userId` column — it's a single cache shared by
 *      every user — so this step is necessarily global, not scoped to the
 *      userId argument.
 *   2. Re-geocode each target row via the same adapter selection
 *      (`getGeocodingAdapter`) and concurrency (5) as visit-persister.ts.
 *      UPDATEs only `region`/`country` on `place_cache` — never placeName/
 *      address/category/provider, so a re-geocode (possibly via a different
 *      provider than the one that originally wrote the row) never clobbers
 *      an existing, correct place name.
 *   3. UPDATE `visits.city`/`visits.country_name`, scoped to the given
 *      `userId`, for every visit whose rounded (center_lat, center_lon) —
 *      via `placeCacheCoordKey`, the SAME 3-decimal grid key
 *      visit-persister.ts uses to read the cache — joins a place_cache row
 *      that is "resolved": either it already had a non-null region before
 *      this run, or it was freshly and successfully re-geocoded in step 2.
 *      A place_cache row that failed to re-geocode this run stays
 *      unresolved and its visits are left alone (see "Row-failure
 *      isolation" below).
 *   4. A visit with no matching place_cache row at all is left untouched.
 *
 * Row-failure isolation (spec step 6): failures are per-row, not per-day —
 * a failed re-geocode is logged and skipped, the run continues, and the
 * final failure count sets the exit code. Critically, a failed place_cache
 * row must NOT cascade into visits: `place_cache` starts this run 100% null
 * (region AND country — see the task brief's measured baseline), so if step
 * 3 blindly joined the full cache table regardless of resolution state, a
 * row that failed re-geocoding this run would still read back as null and
 * step 3 would overwrite its visits' CURRENT (possibly perfectly healthy,
 * e.g. "서울") city with null — a silent regression. The `resolved` flag on
 * each `CacheEntry` is what prevents that: it's true only for a row that was
 * already good before this run, or that this run's re-geocode actually
 * succeeded on (even if the result's region/country legitimately came back
 * null — the adapters do return null region with a set country for some
 * coordinates, and that's a genuine value, not a failure).
 *
 * `visits` are NOT re-detected: only the two administrative columns are
 * written, so visit boundaries/place names/saved-place overrides are
 * untouched.
 *
 * --dry-run performs NO writes. Because a full run re-geocodes every
 * `place_cache` row needing it (~521 at last count) against billed/
 * rate-limited APIs, --dry-run caps its OWN live geocoding to a small
 * deterministic sample (SAMPLE_SIZE, 20 — matching the spec's "바뀔 값 표본
 * 20건") instead of fetching everything, and reports:
 *   - the exact `place_cache` target count and the exact `visits` candidate
 *     count — both computable without any live geocoding (cheap in-memory
 *     joins over data already loaded), and
 *   - up to 20 real "before → after" sample rows for both place_cache and
 *     visits, drawn from that capped sample, so the preview reflects a real
 *     API response rather than a guess.
 * The `visits` "would change" count in dry-run mode is explicitly a
 * lower-bound preview limited to the sampled cache rows, NOT the true
 * full-run count — the run banner says so. The `visits` "candidate" count
 * (matches *some* place_cache coordinate, resolved or not) is exact and
 * unsampled; it is the upper bound the real number can't exceed.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";

// Next.js itself reads both files with .env.local taking precedence. The
// geocoding API keys (KAKAO_REST_API_KEY, GOOGLE_MAPS_API_KEY) live in .env
// — matches scripts/compare-region-extraction.ts, whose Task 5 comparison
// justified this backfill.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

// Scripts use relative imports, not the "@/" alias — matches
// scripts/backfill-tracks.ts and scripts/compare-region-extraction.ts.
import { and, asc, eq } from "drizzle-orm";
import { getDb, getPool, placeCache, visits } from "../src/db";
import { getGeocodingAdapter } from "../src/lib/adapters/geocoding";
import { placeCacheCoordKey } from "../src/lib/geo";
import { parseUserIdArgs } from "./lib/backfill-args";

/** Matches visit-persister.ts's own geocoding concurrency cap. */
const CONCURRENCY = 5;

/**
 * Both the dry-run's live-geocode sample size and the "바뀔 값 표본 20건"
 * preview row count from the spec — one constant serves both purposes.
 */
const SAMPLE_SIZE = 20;

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error("Usage: npx tsx scripts/backfill-visit-regions.ts <userId> [--dry-run]");
  exit(1);
}

function checkRequiredEnv(): void {
  const missing = ["KAKAO_REST_API_KEY", "GOOGLE_MAPS_API_KEY"].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    usageAndExit(
      `Missing required environment variable(s): ${missing.join(", ")}. These live in .env ` +
        `(not .env.local) — see the geocoding adapters' own constructor checks. A run without ` +
        `them would silently fail every re-geocode and report every target row as a failure ` +
        `instead of actually backfilling anything.`
    );
  }
}

function cacheKey(latKey: number, lonKey: number): string {
  return `${latKey}:${lonKey}`;
}

// ── place_cache ──────────────────────────────────────────────────────────

interface CacheRow {
  latKey: number;
  lonKey: number;
  region: string | null;
  country: string | null;
}

interface CacheEntry {
  region: string | null;
  country: string | null;
  /**
   * True iff this coordinate is safe to propagate to `visits`: either it
   * already had a non-null region before this run, or this run's re-geocode
   * succeeded on it (see the file header's "Row-failure isolation"). False
   * for a row that was null before this run AND is still unresolved
   * (skipped by a capped dry-run sample, or a live failure this run).
   */
  resolved: boolean;
}

interface GeocodeOutcome extends CacheRow {}

interface RowFailure {
  latKey: number;
  lonKey: number;
  error: unknown;
}

interface Failure {
  label: string;
  error: unknown;
}

async function loadCacheRows(): Promise<CacheRow[]> {
  const db = getDb();
  return db
    .select({
      latKey: placeCache.latKey,
      lonKey: placeCache.lonKey,
      region: placeCache.region,
      country: placeCache.country,
    })
    .from(placeCache)
    .orderBy(asc(placeCache.id));
}

function buildCacheMap(rows: CacheRow[]): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  for (const row of rows) {
    map.set(cacheKey(row.latKey, row.lonKey), {
      region: row.region,
      country: row.country,
      resolved: row.region !== null,
    });
  }
  return map;
}

/** Re-geocodes `rows` at CONCURRENCY 5, matching visit-persister.ts's own loop shape. */
async function geocodeRows(
  rows: { latKey: number; lonKey: number }[]
): Promise<{ outcomes: GeocodeOutcome[]; failures: RowFailure[] }> {
  const outcomes: GeocodeOutcome[] = [];
  const failures: RowFailure[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ latKey, lonKey }) => {
        try {
          const adapter = getGeocodingAdapter(latKey, lonKey);
          const result = await adapter.reverseGeocode(latKey, lonKey);
          if (result === null) {
            failures.push({ latKey, lonKey, error: new Error("reverseGeocode returned null") });
            return;
          }
          outcomes.push({ latKey, lonKey, region: result.region, country: result.country });
        } catch (error) {
          failures.push({ latKey, lonKey, error });
        }
      })
    );
  }

  return { outcomes, failures };
}

/** Writes only `region`/`country` — never placeName/address/category/provider. Sequential: these are local DB writes, not the rate-limited resource. */
async function applyPlaceCacheUpdates(outcomes: GeocodeOutcome[]): Promise<RowFailure[]> {
  const db = getDb();
  const failures: RowFailure[] = [];
  for (const o of outcomes) {
    try {
      await db
        .update(placeCache)
        .set({ region: o.region, country: o.country })
        .where(and(eq(placeCache.latKey, o.latKey), eq(placeCache.lonKey, o.lonKey)));
    } catch (error) {
      failures.push({ latKey: o.latKey, lonKey: o.lonKey, error });
    }
  }
  return failures;
}

function printPlaceCacheSample(
  rows: { latKey: number; lonKey: number }[],
  outcomes: GeocodeOutcome[],
  failures: RowFailure[]
): void {
  console.log(`\nplace_cache sample (${rows.length} row(s) live re-geocoded this run):`);
  if (rows.length === 0) {
    console.log("  (no target rows)");
    return;
  }
  const outcomeByKey = new Map(outcomes.map((o) => [cacheKey(o.latKey, o.lonKey), o]));
  const failedKeys = new Set(failures.map((f) => cacheKey(f.latKey, f.lonKey)));
  console.log(
    [
      "latKey",
      "lonKey",
      "region(before)",
      "country(before)",
      "region(after)",
      "country(after)",
    ].join("\t")
  );
  for (const r of rows) {
    const key = cacheKey(r.latKey, r.lonKey);
    if (failedKeys.has(key)) {
      console.log([r.latKey, r.lonKey, "null", "null", "FAILED", "FAILED"].join("\t"));
      continue;
    }
    const o = outcomeByKey.get(key);
    console.log([r.latKey, r.lonKey, "null", "null", o?.region ?? "", o?.country ?? ""].join("\t"));
  }
}

// ── visits ───────────────────────────────────────────────────────────────

interface VisitRow {
  id: string;
  centerLat: number;
  centerLon: number;
  city: string | null;
  countryName: string | null;
}

interface VisitChange {
  id: string;
  currentCity: string | null;
  currentCountry: string | null;
  newCity: string | null;
  newCountry: string | null;
}

async function loadVisitRows(userId: string): Promise<VisitRow[]> {
  const db = getDb();
  return db
    .select({
      id: visits.id,
      centerLat: visits.centerLat,
      centerLon: visits.centerLon,
      city: visits.city,
      countryName: visits.countryName,
    })
    .from(visits)
    .where(eq(visits.userId, userId))
    .orderBy(asc(visits.id));
}

/**
 * candidates: any visit whose coordinate matches SOME place_cache row,
 * resolved or not — exact, unsampled, and the upper bound the real "would
 * change" count can't exceed (step 4: no match at all means untouched).
 *
 * changes: the subset that is both resolved AND actually differs from the
 * visit's current value (skips no-op writes). In dry-run mode with a capped
 * geocode sample, this under-counts the true full-run result — see the file
 * header.
 */
function planVisitChanges(
  visitRows: VisitRow[],
  cacheMap: Map<string, CacheEntry>
): { candidates: VisitRow[]; changes: VisitChange[] } {
  const candidates: VisitRow[] = [];
  const changes: VisitChange[] = [];

  for (const v of visitRows) {
    const key = cacheKey(placeCacheCoordKey(v.centerLat), placeCacheCoordKey(v.centerLon));
    const entry = cacheMap.get(key);
    if (!entry) continue; // step 4: no matching cache row — leave untouched
    candidates.push(v);
    if (!entry.resolved) continue; // unresolved this run — leave untouched
    if (v.city === entry.region && v.countryName === entry.country) continue; // no-op
    changes.push({
      id: v.id,
      currentCity: v.city,
      currentCountry: v.countryName,
      newCity: entry.region,
      newCountry: entry.country,
    });
  }

  return { candidates, changes };
}

async function applyVisitChanges(changes: VisitChange[]): Promise<Failure[]> {
  const db = getDb();
  const failures: Failure[] = [];
  for (const c of changes) {
    try {
      await db
        .update(visits)
        .set({ city: c.newCity, countryName: c.newCountry })
        .where(eq(visits.id, c.id));
    } catch (error) {
      failures.push({ label: `visit UPDATE (${c.id})`, error });
    }
  }
  return failures;
}

function printVisitSample(changes: VisitChange[]): void {
  const sample = changes.slice(0, SAMPLE_SIZE);
  console.log(`\nvisits sample (${sample.length} of ${changes.length} would-change row(s)):`);
  if (sample.length === 0) {
    console.log("  (none)");
    return;
  }
  console.log(
    ["visitId", "city(before)", "country(before)", "city(after)", "country(after)"].join("\t")
  );
  for (const c of sample) {
    console.log(
      [c.id, c.currentCity ?? "", c.currentCountry ?? "", c.newCity ?? "", c.newCountry ?? ""].join(
        "\t"
      )
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────

function toFailure(label: string, f: RowFailure): Failure {
  return { label: `${label} (${f.latKey}, ${f.lonKey})`, error: f.error };
}

function reportFailuresAndExit(failures: Failure[]): void {
  if (failures.length === 0) return;
  console.error(`\n${failures.length} row failure(s):`);
  for (const f of failures) {
    console.error(`  ${f.label}: ${f.error instanceof Error ? f.error.message : String(f.error)}`);
  }
  exit(1);
}

async function main() {
  const parsed = parseUserIdArgs(argv.slice(2));
  if ("error" in parsed) usageAndExit(parsed.error);
  const { userId, dryRun } = parsed;

  checkRequiredEnv();

  console.log(`${dryRun ? "DRY RUN" : "APPLY"}: backfilling visit regions for user ${userId}\n`);

  const failures: Failure[] = [];

  // Steps 1-2: place_cache (global — see file header).
  const cacheRows = await loadCacheRows();
  const cacheMap = buildCacheMap(cacheRows);
  const targetRows = cacheRows.filter((r) => r.region === null);

  console.log(
    `place_cache: ${cacheRows.length} total row(s) (global cache, shared across all users), ` +
      `${targetRows.length} with region IS NULL — this run's re-geocode target.`
  );

  const rowsToGeocode = dryRun ? targetRows.slice(0, SAMPLE_SIZE) : targetRows;
  if (dryRun && targetRows.length > SAMPLE_SIZE) {
    console.log(
      `DRY RUN caps live geocoding at ${SAMPLE_SIZE} of ${targetRows.length} target row(s) to bound ` +
        `billed API calls; a real run re-geocodes all ${targetRows.length}.`
    );
  }

  const { outcomes, failures: geocodeFailures } = await geocodeRows(rowsToGeocode);
  failures.push(...geocodeFailures.map((f) => toFailure("place_cache re-geocode", f)));

  for (const o of outcomes) {
    cacheMap.set(cacheKey(o.latKey, o.lonKey), {
      region: o.region,
      country: o.country,
      resolved: true,
    });
  }

  let placeCacheWriteFailureCount = 0;
  if (!dryRun) {
    const writeFailures = await applyPlaceCacheUpdates(outcomes);
    placeCacheWriteFailureCount = writeFailures.length;
    failures.push(...writeFailures.map((f) => toFailure("place_cache UPDATE", f)));
  }

  printPlaceCacheSample(rowsToGeocode, outcomes, geocodeFailures);

  // Step 3-4: visits, scoped to userId.
  const visitRows = await loadVisitRows(userId);
  const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

  console.log(
    `\nvisits (user ${userId}): ${visitRows.length} total, ${candidates.length} match an existing ` +
      `place_cache coordinate (exact upper bound — the real "would change" count can't exceed this), ` +
      `${changes.length} would actually change value` +
      (dryRun
        ? ` based on the ${rowsToGeocode.length}-row geocode sample above (NOT the true full-run count).`
        : ".")
  );

  printVisitSample(changes);

  if (!dryRun) {
    const visitFailures = await applyVisitChanges(changes);
    failures.push(...visitFailures);
    console.log(
      `\nAPPLY totals: place_cache updated=${outcomes.length - placeCacheWriteFailureCount}/${targetRows.length}, ` +
        `visits updated=${changes.length - visitFailures.length}/${changes.length}, failures=${failures.length}.`
    );
  } else {
    console.log("\nNo rows were changed.");
  }

  await getPool().end();
  reportFailuresAndExit(failures);
}

// Only run when executed directly (npx tsx scripts/backfill-visit-regions.ts
// ...), not when imported — e.g. by
// scripts/backfill-visit-regions.test.ts, which needs
// parseUserIdArgs() without triggering a live/dry-run or a process.exit()
// on bad args.
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
