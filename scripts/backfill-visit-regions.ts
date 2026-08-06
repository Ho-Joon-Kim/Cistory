/**
 * Backfill `place_cache.region`/`country` and `visits.city`/`country_name`
 * now that the geocoding adapters read structured region/country fields
 * (Task 1-4 of this feature) instead of guessing from an address string.
 * Every `place_cache` row predates migration 0040 and holds `region`/
 * `country` as null; this script re-geocodes each stale cache row and
 * propagates the result to every `visits` row that shares its coordinate.
 *
 * A second, distinct gap it also closes: under the pre-4cb4e21 code, a
 * visit that matched a `savedPlaces` entry skipped the geocode lookup
 * entirely, so NO `place_cache` row was ever written for its coordinate —
 * not even a null/null one. Commit 4cb4e21 fixed the forward path
 * (saved-place visits now go through the coordinate lookup for
 * region/country and layer the saved place's name on top), but historical
 * rows were never repaired, and the original version of this script
 * couldn't reach them: step 4/5 below leaves a visit whose coordinate has
 * NO `place_cache` row at all untouched, so a visit-only coordinate would
 * never be selected no matter how many times this script ran. This
 * script's geocode target set is therefore the UNION of:
 *   - (original) `place_cache` rows where region AND country are both null
 *     — "the cache group" — and
 *   - (added) coordinates of THIS USER's visits that have no `place_cache`
 *     row at all — "the orphan group" / "visit-only coordinates",
 *     necessarily discovered by scanning `visits`, since `place_cache` has
 *     no record of a coordinate it never got a row for. `place_cache`
 *     itself stays global (no `userId` column) — a coordinate discovered
 *     this way is shared cache once written, same as any other row — but
 *     the DISCOVERY step is inherently scoped to the one user's visits
 *     passed on the command line, unlike the cache group's global scan.
 *
 * Usage:
 *   npx tsx scripts/backfill-visit-regions.ts <userId> [--dry-run]
 *   npx tsx scripts/backfill-visit-regions.ts 033ddddc-... --dry-run
 *
 * Steps:
 *   1. Load `place_cache`. A row is a CACHE-GROUP re-geocode target when
 *      BOTH `region` AND `country` are null — matches visit-persister.ts's
 *      `isStale` rule (see `isCacheRowUnresolved` below for why region
 *      alone is the wrong test).
 *      `place_cache` has no `userId` column — it's a single cache shared by
 *      every user — so this step is necessarily global, not scoped to the
 *      userId argument.
 *   2. Load the given user's `visits` and diff their rounded coordinates
 *      (`placeCacheCoordKey`) against the `place_cache` rows loaded in step
 *      1. Any coordinate with NO row at all — resolved or not — is an
 *      ORPHAN-GROUP target (`findOrphanVisitCoordinates`). A coordinate
 *      that already has a `place_cache` row, even an unresolved
 *      (cache-group) one, is never added here: that row is already going
 *      to be re-geocoded by the cache-group path in step 3, and adding it
 *      again would double the API calls for zero benefit. Two visits
 *      sharing a rounded coordinate produce exactly one orphan-group
 *      target — geocode it once, not twice.
 *   3. Re-geocode both groups TOGETHER via the same adapter selection
 *      (`getGeocodingAdapter`) as visit-persister.ts, throttled per
 *      provider through ONE combined pass (see "Throttling" below — NOT
 *      flat concurrency 5, and NOT two independent throttling windows).
 *        - Cache group: UPDATEs only `region`/`country` on the EXISTING
 *          `place_cache` row — never placeName/address/category/provider,
 *          so a re-geocode (possibly via a different provider than the one
 *          that originally wrote the row) never clobbers an existing,
 *          correct place name.
 *        - Orphan group: INSERTs a brand-new `place_cache` row with every
 *          column set from the geocode result — there is no existing row
 *          whose placeName/address/category/provider must be preserved.
 *          `onConflictDoNothing()` backstops step 2's own dedupe in case a
 *          concurrent process wrote the same coordinate between the load
 *          and this write — the same guard visit-persister.ts's own
 *          geocode-and-insert path uses. It must never touch a row that
 *          already exists, which step 2's cache-map filter already
 *          guarantees by construction.
 *   4. UPDATE `visits.city`/`visits.country_name`, scoped to the given
 *      `userId`, for every visit whose rounded (center_lat, center_lon) —
 *      via `placeCacheCoordKey`, the SAME 3-decimal grid key
 *      visit-persister.ts uses to read the cache — joins a place_cache row
 *      that is "resolved": either it already had a non-null region/country
 *      before this run, or this run both successfully re-geocoded it AND
 *      successfully persisted that result to `place_cache` (see
 *      "Row-failure isolation" below — resolution is gated on the write,
 *      not just the geocode). This one code path serves BOTH groups: a
 *      visit that matches an orphan-group coordinate is propagated
 *      identically to one that matches a cache-group coordinate, because
 *      both groups write into the same in-memory cache map before this
 *      step runs. There is no separate "orphan visit update" step.
 *   5. A visit with no matching place_cache row at all — including an
 *      orphan-group coordinate whose geocode or INSERT failed this run, so
 *      no row exists for it even now — is left untouched.
 *
 * Row-failure isolation (spec step 6): failures are per-row, not per-day —
 * a failed re-geocode or a failed write is logged and skipped, the run
 * continues, and the final failure count sets the exit code. Critically, a
 * failed place_cache row must NOT cascade into visits: `place_cache` starts
 * this run 100% null (region AND country — see the task brief's measured
 * baseline), so if step 4 blindly joined the full cache table regardless of
 * resolution state, a row that failed re-geocoding (or whose successful
 * geocode then failed to persist — lock timeout, network blip) would still
 * read back as null and step 4 would overwrite its visits' CURRENT
 * (possibly perfectly healthy, e.g. "서울") city with null — a silent
 * regression. The `resolved` flag on each `CacheEntry` is what prevents
 * that: true only for a row that was already good before this run, or whose
 * fresh value this run BOTH fetched successfully AND wrote to `place_cache`
 * successfully (even if the result's region/country legitimately came back
 * null — the adapters do return null region with a set country for some
 * coordinates, and that's a genuine value, not a failure). In dry-run mode
 * no write is ever attempted, so there's no persisted-write signal to gate
 * on there — a successful geocode alone marks the coordinate resolved, so
 * the preview stays meaningful.
 *
 * This same isolation covers the orphan group, through the SAME
 * `resolveOutcomes` function (parameterized by which persistence function
 * to call) rather than a parallel copy of the gating logic: a visit-only
 * coordinate that fails to geocode, or geocodes but fails to INSERT, never
 * gets an entry in the cache map at all. Unlike the cache group there's no
 * pre-existing null/null row to guard against overwriting — the coordinate
 * simply stays absent, so its visits fall through step 5's "no matching
 * row" case exactly as if this script had never touched them.
 *
 * `visits` are NOT re-detected: only the two administrative columns are
 * written, so visit boundaries/place names/saved-place overrides are
 * untouched.
 *
 * Throttling: this used flat concurrency 5 (matching visit-persister.ts) in
 * an earlier draft, per the original spec. Coordinator review round 1
 * overrode that with measured evidence from Task 5: an n=100 comparison run
 * at concurrency 5 produced 35 failures out of 92 live coordinates, purely
 * from Kakao rate limiting — and this script re-geocodes 521 rows, ~5x that
 * volume. It now reuses scripts/lib/geocode-throttle.ts (Kakao paced at
 * concurrency 1 with a 300ms inter-coordinate delay, everything else at
 * concurrency 5), the same module compare-region-extraction.ts was already
 * throttled through, plus that module's single retry-with-backoff — with
 * 521 rows a transient failure is likely, and a retry is far cheaper than a
 * whole re-run. The cache group and the orphan group are combined into ONE
 * `runThrottledGeocode` call, not two independent ones: both draw from the
 * same Kakao quota, so the printed throttling line and request estimate
 * must (and do) cover the whole run, not just the cache group.
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
 * The orphan group gets the identical treatment — its own SAMPLE_SIZE-capped
 * live sample, its own exact unsampled target count, and its own
 * "before → after" preview (`printOrphanCacheSample`) — printed separately
 * from the cache group's so the two are never conflated: the orphan-group
 * preview has no "before" state, since there is no row yet.
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
import type { GeocodingResult } from "../src/lib/adapters/geocoding";
import { getGeocodingAdapter, isInKorea } from "../src/lib/adapters/geocoding";
import { placeCacheCoordKey } from "../src/lib/geo";
import { parseUserIdArgs } from "./lib/backfill-args";
import {
  describeThrottlingPlan,
  reverseGeocodeWithRetry,
  runThrottledGeocode,
} from "./lib/geocode-throttle";

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

export function cacheKey(latKey: number, lonKey: number): string {
  return `${latKey}:${lonKey}`;
}

// ── place_cache ──────────────────────────────────────────────────────────

interface CacheRow {
  latKey: number;
  lonKey: number;
  region: string | null;
  country: string | null;
}

export interface CacheEntry {
  region: string | null;
  country: string | null;
  /**
   * True iff this coordinate is safe to propagate to `visits`: either it
   * already had a non-null region/country before this run (see
   * `isCacheRowUnresolved`), or this run BOTH re-geocoded it successfully
   * AND (apply mode only) successfully persisted that result to
   * `place_cache` — see the file header's "Row-failure isolation". A
   * successful geocode whose write then fails must NOT flip this to true,
   * or `visits` would end up holding a value `place_cache` itself never
   * actually stored. In dry-run mode no write is attempted, so a
   * successful geocode alone is enough (there's nothing to gate on).
   * False for a row that was null before this run AND is still unresolved
   * (skipped by a capped dry-run sample, a failed geocode, or a failed
   * write). An orphan-group coordinate that never resolves has no entry
   * here at all, rather than a `resolved: false` one — see
   * `findOrphanVisitCoordinates`.
   */
  resolved: boolean;
}

interface GeocodeOutcome extends CacheRow {}

/**
 * A successfully re-geocoded orphan-group (visit-only) coordinate, carrying
 * every field the fresh `place_cache` INSERT needs — unlike the cache
 * group's `GeocodeOutcome`, which only carries region/country because it
 * UPDATEs an existing row.
 */
interface OrphanGeocodeOutcome extends GeocodeOutcome {
  placeName: string;
  address: string;
  category: string | null;
  provider: GeocodingResult["provider"];
}

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

/**
 * A `place_cache` row is a re-geocode target — and, symmetrically, NOT yet
 * safe to propagate to `visits` — exactly when BOTH `region` and `country`
 * are null. Matches visit-persister.ts's `isStale` rule (see that file's
 * comment): a legitimate geocode can return `region: null` with a set
 * `country` (mapbox.ts/google.ts fall back to null region when no admin
 * region resolves for a coordinate, while still setting country). Testing
 * `region` alone would re-select and re-geocode that row on every future
 * run forever without ever converging — the exact bug this mirrors from
 * visit-persister.ts. Keep this in sync with that file's `isStale` if
 * either changes.
 */
export function isCacheRowUnresolved(row: {
  region: string | null;
  country: string | null;
}): boolean {
  return row.region === null && row.country === null;
}

export function buildCacheMap(rows: CacheRow[]): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  for (const row of rows) {
    map.set(cacheKey(row.latKey, row.lonKey), {
      region: row.region,
      country: row.country,
      resolved: !isCacheRowUnresolved(row),
    });
  }
  return map;
}

/**
 * Discovers the orphan group: coordinates of `visitRows` that have NO
 * `place_cache` row at all in `cacheMap` — not even an unresolved one. A
 * coordinate already present in `cacheMap` (resolved or not) is skipped
 * here unconditionally, because it's either already good or already queued
 * for re-geocode by the cache group — adding it again would geocode the
 * same coordinate twice for no benefit and, worse, risk a duplicate INSERT
 * attempt racing the cache group's UPDATE. Deduplicates by rounded
 * coordinate so two visits sharing a `placeCacheCoordKey` produce exactly
 * one target, matching the cache group's one-row-per-coordinate shape.
 */
export function findOrphanVisitCoordinates(
  visitRows: { centerLat: number; centerLon: number }[],
  cacheMap: Map<string, CacheEntry>
): { latKey: number; lonKey: number }[] {
  const seen = new Map<string, { latKey: number; lonKey: number }>();
  for (const v of visitRows) {
    const latKey = placeCacheCoordKey(v.centerLat);
    const lonKey = placeCacheCoordKey(v.centerLon);
    const key = cacheKey(latKey, lonKey);
    if (cacheMap.has(key)) continue; // already has a place_cache row — not an orphan
    if (seen.has(key)) continue; // another visit already queued this coordinate
    seen.set(key, { latKey, lonKey });
  }
  return Array.from(seen.values());
}

/** Which group a geocode target belongs to — routes the outcome to the UPDATE or INSERT persistence path. */
type GeocodeTargetKind = "cache" | "orphan";

interface GeocodeTarget {
  latKey: number;
  lonKey: number;
  kind: GeocodeTargetKind;
}

/**
 * Re-geocodes `targets` — cache-group and orphan-group coordinates
 * TOGETHER in one throttled pass — via scripts/lib/geocode-throttle.ts
 * (Kakao paced at concurrency 1, everything else at concurrency 5 — see the
 * file header's "Throttling" section for why this replaced a flat
 * concurrency 5, and why the two groups share one pass rather than two).
 * Each row gets one retry after a backoff before being recorded as a
 * failure (also from that module). Failures and outcomes are split by
 * group so the caller can route them to the right persistence function
 * (UPDATE vs INSERT) and label failures distinctly in the run's output.
 */
async function geocodeTargets(targets: GeocodeTarget[]): Promise<{
  cacheOutcomes: GeocodeOutcome[];
  orphanOutcomes: OrphanGeocodeOutcome[];
  cacheFailures: RowFailure[];
  orphanFailures: RowFailure[];
}> {
  const cacheOutcomes: GeocodeOutcome[] = [];
  const orphanOutcomes: OrphanGeocodeOutcome[] = [];
  const cacheFailures: RowFailure[] = [];
  const orphanFailures: RowFailure[] = [];

  await runThrottledGeocode(
    targets,
    (t) => isInKorea(t.latKey, t.lonKey),
    async ({ latKey, lonKey, kind }) => {
      const adapter = getGeocodingAdapter(latKey, lonKey);
      const { result, failed } = await reverseGeocodeWithRetry(adapter, latKey, lonKey);
      if (failed || result === null) {
        const failure: RowFailure = {
          latKey,
          lonKey,
          error: new Error("reverseGeocode returned null after retry"),
        };
        (kind === "cache" ? cacheFailures : orphanFailures).push(failure);
        return;
      }
      if (kind === "cache") {
        cacheOutcomes.push({ latKey, lonKey, region: result.region, country: result.country });
      } else {
        orphanOutcomes.push({
          latKey,
          lonKey,
          region: result.region,
          country: result.country,
          placeName: result.placeName,
          address: result.address,
          category: result.category ?? null,
          provider: result.provider,
        });
      }
    }
  );

  return { cacheOutcomes, orphanOutcomes, cacheFailures, orphanFailures };
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

/**
 * INSERTs a brand-new `place_cache` row per orphan-group outcome, setting
 * every column from the geocode result — there is no existing row whose
 * placeName/address/category/provider must be preserved, unlike the
 * cache-group UPDATE path above. `onConflictDoNothing()` backstops
 * `findOrphanVisitCoordinates`'s own dedupe in case a concurrent process
 * wrote the same coordinate between the load and this write — the same
 * guard visit-persister.ts's own geocode-and-insert path uses; it must
 * never overwrite a row that already exists. Sequential and per-row
 * try/catch for the same row-failure isolation as `applyPlaceCacheUpdates`.
 */
async function applyPlaceCacheInserts(
  outcomes: OrphanGeocodeOutcome[],
  resolvedAt: Date
): Promise<RowFailure[]> {
  const db = getDb();
  const failures: RowFailure[] = [];
  for (const o of outcomes) {
    try {
      await db
        .insert(placeCache)
        .values({
          latKey: o.latKey,
          lonKey: o.lonKey,
          placeName: o.placeName,
          address: o.address,
          category: o.category,
          provider: o.provider,
          region: o.region,
          country: o.country,
          resolvedAt,
        })
        .onConflictDoNothing();
    } catch (error) {
      failures.push({ latKey: o.latKey, lonKey: o.lonKey, error });
    }
  }
  return failures;
}

/**
 * Marks each successful `outcome` resolved in `cacheMap` (mutated in
 * place), gated on the persisted write actually landing — NOT just on the
 * geocode having succeeded (Finding 1, coordinator review round 1). In
 * dry-run mode no write is attempted, so there's nothing to gate on: a
 * successful geocode alone is enough, matching the dry-run preview's own
 * "what would a real run change" framing. `applyWrites` is injected so the
 * SAME gating logic serves both the cache group (UPDATE) and the orphan
 * group (INSERT) — the orphan group cannot bypass this gate by taking a
 * different code path, it just supplies a different writer. Returns the
 * write failures (always empty in dry-run mode).
 */
export async function resolveOutcomes<T extends GeocodeOutcome>(
  outcomes: T[],
  cacheMap: Map<string, CacheEntry>,
  dryRun: boolean,
  applyWrites: (outcomes: T[]) => Promise<RowFailure[]>
): Promise<RowFailure[]> {
  if (dryRun) {
    for (const o of outcomes) {
      cacheMap.set(cacheKey(o.latKey, o.lonKey), {
        region: o.region,
        country: o.country,
        resolved: true,
      });
    }
    return [];
  }

  const writeFailures = await applyWrites(outcomes);
  const failedWriteKeys = new Set(writeFailures.map((f) => cacheKey(f.latKey, f.lonKey)));
  for (const o of outcomes) {
    const key = cacheKey(o.latKey, o.lonKey);
    if (failedWriteKeys.has(key)) continue; // write failed — must not flip to resolved
    cacheMap.set(key, { region: o.region, country: o.country, resolved: true });
  }
  return writeFailures;
}

function printPlaceCacheSample(
  rows: { latKey: number; lonKey: number }[],
  outcomes: GeocodeOutcome[],
  failures: RowFailure[]
): void {
  console.log(
    `\nplace_cache sample (${rows.length} row(s) live re-geocoded this run — cache group, UPDATE):`
  );
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

/**
 * Distinct from `printPlaceCacheSample`: the orphan group has no "before"
 * state (there is no row yet), so this shows the new row's fields directly
 * instead of a before/after diff, and is labelled "NEW place_cache INSERT"
 * so a reader never mistakes it for a cache-group UPDATE preview.
 */
function printOrphanCacheSample(
  rows: { latKey: number; lonKey: number }[],
  outcomes: OrphanGeocodeOutcome[],
  failures: RowFailure[]
): void {
  console.log(
    `\nvisit-only coordinates sample (${rows.length} row(s) live re-geocoded this run — orphan group, NEW place_cache INSERT):`
  );
  if (rows.length === 0) {
    console.log("  (no target rows)");
    return;
  }
  const outcomeByKey = new Map(outcomes.map((o) => [cacheKey(o.latKey, o.lonKey), o]));
  const failedKeys = new Set(failures.map((f) => cacheKey(f.latKey, f.lonKey)));
  console.log(["latKey", "lonKey", "placeName(new)", "region(new)", "country(new)"].join("\t"));
  for (const r of rows) {
    const key = cacheKey(r.latKey, r.lonKey);
    if (failedKeys.has(key)) {
      console.log([r.latKey, r.lonKey, "FAILED", "FAILED", "FAILED"].join("\t"));
      continue;
    }
    const o = outcomeByKey.get(key);
    console.log(
      [r.latKey, r.lonKey, o?.placeName ?? "", o?.region ?? "", o?.country ?? ""].join("\t")
    );
  }
}

// ── visits ───────────────────────────────────────────────────────────────

export interface VisitRow {
  id: string;
  centerLat: number;
  centerLon: number;
  city: string | null;
  countryName: string | null;
}

export interface VisitChange {
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
 * change" count can't exceed (step 5: no match at all means untouched).
 * This is unchanged by the orphan group: `cacheMap` is the single source of
 * truth, and by the time this runs it already holds every orphan-group
 * coordinate that resolved this run alongside the originally-loaded cache
 * rows, so a visit matching either group is treated identically here.
 *
 * changes: the subset that is both resolved AND actually differs from the
 * visit's current value (skips no-op writes). In dry-run mode with a capped
 * geocode sample, this under-counts the true full-run result — see the file
 * header.
 */
export function planVisitChanges(
  visitRows: VisitRow[],
  cacheMap: Map<string, CacheEntry>
): { candidates: VisitRow[]; changes: VisitChange[] } {
  const candidates: VisitRow[] = [];
  const changes: VisitChange[] = [];

  for (const v of visitRows) {
    const key = cacheKey(placeCacheCoordKey(v.centerLat), placeCacheCoordKey(v.centerLon));
    const entry = cacheMap.get(key);
    if (!entry) continue; // step 5: no matching cache row — leave untouched
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
  const now = new Date();

  // Step 1: place_cache cache group (global — see file header).
  const cacheRows = await loadCacheRows();
  const cacheMap = buildCacheMap(cacheRows);
  const cacheTargetRows = cacheRows.filter(isCacheRowUnresolved);

  console.log(
    `place_cache: ${cacheRows.length} total row(s) (global cache, shared across all users), ` +
      `${cacheTargetRows.length} with region AND country both null — this run's cache-group re-geocode target.`
  );

  // Step 2: orphan group — this user's visit coordinates with no place_cache
  // row at all. Discovery is necessarily scoped to userId's visits, even
  // though the resulting place_cache rows are global once written.
  const visitRows = await loadVisitRows(userId);
  const orphanCoordinates = findOrphanVisitCoordinates(visitRows, cacheMap);

  console.log(
    `visits (user ${userId}) coordinate discovery: ${orphanCoordinates.length} distinct visit ` +
      `coordinate(s) with NO place_cache row at all — this run's orphan-group re-geocode target ` +
      `(scoped to this user's visits; the resulting place_cache rows are global once written).`
  );

  const cacheRowsToGeocode = dryRun ? cacheTargetRows.slice(0, SAMPLE_SIZE) : cacheTargetRows;
  if (dryRun && cacheTargetRows.length > SAMPLE_SIZE) {
    console.log(
      `DRY RUN caps cache-group live geocoding at ${SAMPLE_SIZE} of ${cacheTargetRows.length} target ` +
        `row(s) to bound billed API calls; a real run re-geocodes all ${cacheTargetRows.length}.`
    );
  }

  const orphanRowsToGeocode = dryRun ? orphanCoordinates.slice(0, SAMPLE_SIZE) : orphanCoordinates;
  if (dryRun && orphanCoordinates.length > SAMPLE_SIZE) {
    console.log(
      `DRY RUN caps orphan-group live geocoding at ${SAMPLE_SIZE} of ${orphanCoordinates.length} ` +
        `coordinate(s) to bound billed API calls; a real run re-geocodes all ${orphanCoordinates.length}.`
    );
  }

  // Step 3: re-geocode both groups together through one throttled pass, so
  // the printed estimate and the pacing cover the whole run.
  const combinedTargets: GeocodeTarget[] = [
    ...cacheRowsToGeocode.map((r) => ({
      latKey: r.latKey,
      lonKey: r.lonKey,
      kind: "cache" as const,
    })),
    ...orphanRowsToGeocode.map((r) => ({
      latKey: r.latKey,
      lonKey: r.lonKey,
      kind: "orphan" as const,
    })),
  ];
  console.log(
    `\nRe-geocode plan: ${cacheRowsToGeocode.length} cache-group row(s) + ${orphanRowsToGeocode.length} ` +
      `orphan-group coordinate(s) = ${combinedTargets.length} total this run.`
  );

  const kakaoCount = combinedTargets.filter((t) => isInKorea(t.latKey, t.lonKey)).length;
  console.log(describeThrottlingPlan(kakaoCount, combinedTargets.length - kakaoCount));

  const {
    cacheOutcomes,
    orphanOutcomes,
    cacheFailures: cacheGeocodeFailures,
    orphanFailures: orphanGeocodeFailures,
  } = await geocodeTargets(combinedTargets);
  failures.push(
    ...cacheGeocodeFailures.map((f) => toFailure("place_cache re-geocode (cache group)", f))
  );
  failures.push(
    ...orphanGeocodeFailures.map((f) => toFailure("visit-coordinate geocode (orphan group)", f))
  );

  const cacheWriteFailures = await resolveOutcomes(
    cacheOutcomes,
    cacheMap,
    dryRun,
    applyPlaceCacheUpdates
  );
  const placeCacheUpdateFailureCount = cacheWriteFailures.length;
  failures.push(...cacheWriteFailures.map((f) => toFailure("place_cache UPDATE (cache group)", f)));

  const orphanWriteFailures = await resolveOutcomes(orphanOutcomes, cacheMap, dryRun, (outs) =>
    applyPlaceCacheInserts(outs, now)
  );
  const placeCacheInsertFailureCount = orphanWriteFailures.length;
  failures.push(
    ...orphanWriteFailures.map((f) => toFailure("place_cache INSERT (orphan group)", f))
  );

  printPlaceCacheSample(cacheRowsToGeocode, cacheOutcomes, cacheGeocodeFailures);
  printOrphanCacheSample(orphanRowsToGeocode, orphanOutcomes, orphanGeocodeFailures);

  // Step 4-5: visits, scoped to userId. Reads the single cacheMap, now
  // holding both groups' resolved outcomes — same code as before the
  // orphan group existed.
  const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

  console.log(
    `\nvisits (user ${userId}): ${visitRows.length} total, ${candidates.length} match an existing ` +
      `place_cache coordinate (exact upper bound — the real "would change" count can't exceed this), ` +
      `${changes.length} would actually change value` +
      (dryRun
        ? ` based on the ${cacheRowsToGeocode.length} cache-group + ${orphanRowsToGeocode.length} ` +
          `orphan-group geocode sample above (NOT the true full-run count).`
        : ".")
  );

  printVisitSample(changes);

  if (!dryRun) {
    const visitFailures = await applyVisitChanges(changes);
    failures.push(...visitFailures);
    console.log(
      `\nAPPLY totals: place_cache updated=${cacheOutcomes.length - placeCacheUpdateFailureCount}/${cacheTargetRows.length}, ` +
        `place_cache inserted=${orphanOutcomes.length - placeCacheInsertFailureCount}/${orphanCoordinates.length}, ` +
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
