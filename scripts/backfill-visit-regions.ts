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
 *      BOTH `region` AND `country` are null — the signature every row held
 *      before migration 0040 introduced those columns (see
 *      `isCacheRowUnresolved` below for why testing region alone is wrong,
 *      and why this rule is now independent of visit-persister.ts's own
 *      `isStale` check).
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
 *      target — geocode it once, not twice — but this step also keeps ONE
 *      representative TRUE visit center (`centerLat`/`centerLon`, not the
 *      rounded grid key) per target, for step 3 to geocode against.
 *   3. Re-geocode both groups TOGETHER via the same adapter selection
 *      (`getGeocodingAdapter`) as visit-persister.ts, throttled per
 *      provider through ONE combined pass (see "Throttling" below — NOT
 *      flat concurrency 5, and NOT two independent throttling windows).
 *        - Cache group: calls `reverseGeocode` against the ROUNDED grid key
 *          itself (there is no other coordinate on record for an existing
 *          `place_cache` row), and UPDATEs only `region`/`country` on that
 *          EXISTING row — never placeName/address/category/provider, so a
 *          re-geocode (possibly via a different provider than the one that
 *          originally wrote the row) never clobbers an existing, correct
 *          place name.
 *        - Orphan group: calls `reverseGeocode` against the TRUE visit
 *          center kept in step 2, NOT the rounded grid key — matching
 *          visit-persister.ts's own geocode-and-insert path, which geocodes
 *          `visit.centerLat`/`centerLon` and only KEYS the cache row by the
 *          rounded value. This matters more here than for the cache group:
 *          the cache group only ever writes region/country (시/도-level, far
 *          coarser than the grid cell), but the orphan group writes
 *          `placeName`/`address`/`category` into the GLOBAL `place_cache`
 *          table — geocoding the rounded key (up to ~78m off true center at
 *          the edge of a 3-decimal cell) would give every later visit
 *          landing in that grid cell a place name describing a point up to
 *          78m away. The result is still stored keyed by the ROUNDED
 *          coordinate (`placeCacheCoordKey`'s grid), only the geocode CALL
 *          itself targets the true center. INSERTs a brand-new
 *          `place_cache` row with every column set from the geocode result
 *          — there is no existing row whose placeName/address/category/
 *          provider must be preserved. `onConflictDoNothing()` backstops
 *          step 2's own dedupe in case a concurrent process wrote the same
 *          coordinate between the load and this write — the same guard
 *          visit-persister.ts's own geocode-and-insert path uses. It must
 *          never touch a row that already exists, which step 2's cache-map
 *          filter already guarantees by construction.
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
 * 20건") PER GROUP instead of fetching everything, and reports:
 *   - the exact `place_cache` target count for the cache group, and the
 *     exact orphan-coordinate count for the orphan group — both computable
 *     without any live geocoding (cheap in-memory joins/scans over data
 *     already loaded), and
 *   - up to 20 real "before → after" sample rows for the cache group's
 *     `place_cache` UPDATEs and the orphan group's `place_cache` INSERTs
 *     separately (`printPlaceCacheSample` / `printOrphanCacheSample`, never
 *     conflated — the orphan-group preview has no "before" state, since
 *     there is no row yet), plus one combined `visits` preview, all drawn
 *     from that capped sample so previews reflect real API responses rather
 *     than a guess.
 * The `visits` "would change" count in dry-run mode is explicitly a
 * lower-bound preview limited to the sampled rows, NOT the true full-run
 * count — the run banner says so. The `visits` "candidate" count (matches
 * *some* place_cache coordinate already in `cacheMap`, resolved or not) is
 * exact and unsampled ONLY for the cache group — see `planVisitChanges`'s
 * own doc comment for why the orphan group breaks that guarantee
 * specifically in dry-run mode (an orphan coordinate past the sample cap
 * never enters `cacheMap` at all, so its visits are excluded from
 * `candidates` too, not just from `changes`) — the printed banner must
 * spell this out rather than calling the combined number "exact,
 * unsampled" the way the pre-orphan-group version of this script did.
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
 * are null: the signature every row held before migration 0040 introduced
 * those two columns. A legitimate geocode can return `region: null` with a
 * set `country` (mapbox.ts/google.ts fall back to null region when no admin
 * region resolves for a coordinate, while still setting country), so
 * testing `region` alone would re-select and re-geocode that row on every
 * future run forever without ever converging.
 *
 * This rule is now INDEPENDENT of visit-persister.ts's own `isStale` check
 * (`cached.placeName === cached.address && !cached.category`) — do NOT try
 * to keep the two "in sync". They test different signatures for different
 * purposes: `isStale` detects a low-quality/failed geocode so
 * visit-persister.ts can retry it inline on the next visit-detection run.
 * The two DID overlap once — visit-persister.ts's comment at its `isStale`
 * definition explains its null/null clause was deliberately retired,
 * specifically because this backfill script already ran and cleared every
 * row matching it (521/521, zero failures) — so there is nothing left
 * predating migration 0040 for that clause to catch. A future editor
 * following a "keep these in sync" instruction would be reintroducing dead
 * code there, or worse, coupling this script's target selection to an
 * unrelated retry heuristic.
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
 * An orphan-group target: the ROUNDED grid key it will be stored/looked-up
 * under (`latKey`/`lonKey`, `place_cache`'s actual primary lookup key) PLUS
 * a representative TRUE visit center (`centerLat`/`centerLon` — the first
 * visit's raw coordinate found at this grid cell) to geocode against. See
 * `geocodeCoordinateOf` for why the two must not be conflated.
 */
export interface OrphanTarget {
  latKey: number;
  lonKey: number;
  centerLat: number;
  centerLon: number;
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
 * one target, matching the cache group's one-row-per-coordinate shape — the
 * FIRST visit found at a given grid cell becomes that target's
 * `centerLat`/`centerLon`, kept alongside the rounded key so step 3 can
 * geocode the true center instead of the grid key (see `geocodeCoordinateOf`).
 */
export function findOrphanVisitCoordinates(
  visitRows: { centerLat: number; centerLon: number }[],
  cacheMap: Map<string, CacheEntry>
): OrphanTarget[] {
  const seen = new Map<string, OrphanTarget>();
  for (const v of visitRows) {
    const latKey = placeCacheCoordKey(v.centerLat);
    const lonKey = placeCacheCoordKey(v.centerLon);
    const key = cacheKey(latKey, lonKey);
    if (cacheMap.has(key)) continue; // already has a place_cache row — not an orphan
    if (seen.has(key)) continue; // another visit already queued this coordinate
    seen.set(key, { latKey, lonKey, centerLat: v.centerLat, centerLon: v.centerLon });
  }
  return Array.from(seen.values());
}

interface CacheGeocodeTarget {
  kind: "cache";
  latKey: number;
  lonKey: number;
}

interface OrphanGeocodeTarget {
  kind: "orphan";
  latKey: number;
  lonKey: number;
  centerLat: number;
  centerLon: number;
}

/** Which group a geocode target belongs to — routes the outcome to the UPDATE or INSERT persistence path. */
type GeocodeTarget = CacheGeocodeTarget | OrphanGeocodeTarget;

/**
 * The coordinate to actually call `reverseGeocode` against. For the cache
 * group this IS the rounded grid key — an existing `place_cache` row has no
 * other coordinate on record, and re-geocoding it is what the original
 * script always did. For the orphan group this is the TRUE visit center,
 * never the rounded grid key: geocoding the grid key would be off by up to
 * ~78m at the edge of a 3-decimal cell, and unlike the cache group (which
 * only ever writes 시/도-level region/country) the orphan group writes
 * placeName/address/category into the GLOBAL `place_cache` table — a wrong
 * coordinate here leaks a place name describing the wrong point to every
 * later visit that lands in the same grid cell. Matches
 * visit-persister.ts's own geocode-and-insert path, which geocodes
 * `visit.centerLat`/`centerLon` and only KEYS the cache row by the rounded
 * value.
 */
function geocodeCoordinateOf(target: GeocodeTarget): { lat: number; lon: number } {
  return target.kind === "orphan"
    ? { lat: target.centerLat, lon: target.centerLon }
    : { lat: target.latKey, lon: target.lonKey };
}

/**
 * Maps one successful geocode `result` to the outcome shape its target's
 * group expects. This is the ONLY place that decides "this result belongs
 * to the cache group's UPDATE path" vs "the orphan group's INSERT path" —
 * pulled out of `geocodeTargets`'s worker as its own pure function
 * specifically so that routing decision is unit-testable without a live
 * geocode call. A mis-routing bug here (e.g. an orphan target's result
 * built as a bare `GeocodeOutcome` and pushed into `cacheOutcomes`) would
 * be invisible to the type system — `OrphanGeocodeOutcome` structurally
 * extends `GeocodeOutcome`, so it satisfies that array's element type too —
 * and would only surface as `applyPlaceCacheUpdates` silently UPDATE-ing
 * zero rows (see that function's own rowCount guard) while the coordinate
 * still gets marked resolved without any `place_cache` row ever having been
 * written.
 */
export function buildOutcome(
  target: GeocodeTarget,
  result: GeocodingResult
): { kind: "cache"; outcome: GeocodeOutcome } | { kind: "orphan"; outcome: OrphanGeocodeOutcome } {
  if (target.kind === "cache") {
    return {
      kind: "cache",
      outcome: {
        latKey: target.latKey,
        lonKey: target.lonKey,
        region: result.region,
        country: result.country,
      },
    };
  }
  return {
    kind: "orphan",
    outcome: {
      latKey: target.latKey,
      lonKey: target.lonKey,
      region: result.region,
      country: result.country,
      placeName: result.placeName,
      address: result.address,
      category: result.category ?? null,
      provider: result.provider,
    },
  };
}

/**
 * Re-geocodes `targets` — cache-group and orphan-group coordinates
 * TOGETHER in one throttled pass — via scripts/lib/geocode-throttle.ts
 * (Kakao paced at concurrency 1, everything else at concurrency 5 — see the
 * file header's "Throttling" section for why this replaced a flat
 * concurrency 5, and why the two groups share one pass rather than two).
 * Each row gets one retry after a backoff before being recorded as a
 * failure (also from that module). The coordinate actually sent to
 * `reverseGeocode` comes from `geocodeCoordinateOf` (true center for the
 * orphan group, grid key for the cache group); the coordinate used to KEY
 * the outcome/failure is always the rounded `latKey`/`lonKey`. Outcomes and
 * failures are split by group via `buildOutcome` so the caller can route
 * them to the right persistence function (UPDATE vs INSERT) and label
 * failures distinctly in the run's output.
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
    (t) => {
      const { lat, lon } = geocodeCoordinateOf(t);
      return isInKorea(lat, lon);
    },
    async (target) => {
      const { latKey, lonKey, kind } = target;
      const { lat, lon } = geocodeCoordinateOf(target);
      const adapter = getGeocodingAdapter(lat, lon);
      const { result, failed } = await reverseGeocodeWithRetry(adapter, lat, lon);
      if (failed || result === null) {
        const failure: RowFailure = {
          latKey,
          lonKey,
          error: new Error("reverseGeocode returned null after retry"),
        };
        (kind === "cache" ? cacheFailures : orphanFailures).push(failure);
        return;
      }
      const built = buildOutcome(target, result);
      if (built.kind === "cache") {
        cacheOutcomes.push(built.outcome);
      } else {
        orphanOutcomes.push(built.outcome);
      }
    }
  );

  return { cacheOutcomes, orphanOutcomes, cacheFailures, orphanFailures };
}

/**
 * Writes only `region`/`country` — never placeName/address/category/
 * provider. Sequential: these are local DB writes, not the rate-limited
 * resource.
 *
 * Also asserts the UPDATE actually matched a row (`rowCount`). It always
 * should — every outcome here came from a `cacheTargetRows` row this same
 * run loaded from `place_cache` — so a 0-row match means either the row
 * vanished between load and write, or (the scenario `buildOutcome`'s own
 * doc comment calls out) an orphan-group outcome was mis-routed into this
 * UPDATE path instead of `applyPlaceCacheInserts`'s INSERT path. Either way
 * it must be treated as a failure, not silently marked resolved: without
 * this guard, `resolveOutcomes` would see no write failure and flip the
 * coordinate to `resolved: true` even though no `place_cache` row for it
 * was ever actually written.
 */
async function applyPlaceCacheUpdates(outcomes: GeocodeOutcome[]): Promise<RowFailure[]> {
  const db = getDb();
  const failures: RowFailure[] = [];
  for (const o of outcomes) {
    try {
      const result = await db
        .update(placeCache)
        .set({ region: o.region, country: o.country })
        .where(and(eq(placeCache.latKey, o.latKey), eq(placeCache.lonKey, o.lonKey)));
      if (!result.rowCount) {
        failures.push({
          latKey: o.latKey,
          lonKey: o.lonKey,
          error: new Error(
            "UPDATE matched 0 rows — no place_cache row exists at this coordinate (possible mis-routed orphan-group outcome; see buildOutcome)"
          ),
        });
      }
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
 *
 * Returns `insertedCount` separately from `failures`: a conflict-skip
 * (`rowCount === 0` via `onConflictDoNothing`, i.e. some other writer got
 * there first) is NOT a failure — the coordinate is still safe to resolve,
 * since a `place_cache` row now exists for it either way — but it also
 * didn't actually insert anything THIS run, so the caller's printed
 * "inserted=N" total must not count it as one.
 */
async function applyPlaceCacheInserts(
  outcomes: OrphanGeocodeOutcome[],
  resolvedAt: Date
): Promise<{ failures: RowFailure[]; insertedCount: number }> {
  const db = getDb();
  const failures: RowFailure[] = [];
  let insertedCount = 0;
  for (const o of outcomes) {
    try {
      const result = await db
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
      if (result.rowCount) insertedCount++;
    } catch (error) {
      failures.push({ latKey: o.latKey, lonKey: o.lonKey, error });
    }
  }
  return { failures, insertedCount };
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
 * resolved or not, ALREADY PRESENT IN `cacheMap` at call time (step 5: no
 * match at all means untouched). `cacheMap` is the single source of truth
 * for both groups — a visit matching either the cache group or the orphan
 * group is treated identically here, there is no separate code path.
 *
 * Whether `candidates` is the exact, unsampled upper bound on the real
 * "would change" count depends on how completely `cacheMap` was populated
 * before this call, which differs by group and by run mode:
 *   - cache group: ALWAYS exact. `buildCacheMap` loads every `place_cache`
 *     row into `cacheMap` regardless of dry-run sampling — sampling only
 *     controls which UNRESOLVED rows get re-geocoded, not whether they're
 *     present at all.
 *   - orphan group in an APPLY run: exact. Every orphan coordinate gets
 *     geocoded (and, on success, an entry in `cacheMap`) this run.
 *   - orphan group in a DRY run: NOT exact — only capped to SAMPLE_SIZE,
 *     so an orphan coordinate past the cap never enters `cacheMap` at all,
 *     and its visits are excluded from `candidates` too (not just from
 *     `changes`). A dry run's `candidates` count can therefore come in
 *     LOWER than what a real apply run would show. The caller (`main`)
 *     must reflect this in what it prints, not call the number "exact,
 *     unsampled" unconditionally.
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
  // the printed estimate and the pacing cover the whole run. The orphan
  // group carries its true visit center through so geocodeTargets calls
  // reverseGeocode against it, not the rounded grid key (see
  // geocodeCoordinateOf).
  const combinedTargets: GeocodeTarget[] = [
    ...cacheRowsToGeocode.map(
      (r): GeocodeTarget => ({
        kind: "cache",
        latKey: r.latKey,
        lonKey: r.lonKey,
      })
    ),
    ...orphanRowsToGeocode.map(
      (r): GeocodeTarget => ({
        kind: "orphan",
        latKey: r.latKey,
        lonKey: r.lonKey,
        centerLat: r.centerLat,
        centerLon: r.centerLon,
      })
    ),
  ];
  console.log(
    `\nRe-geocode plan: ${cacheRowsToGeocode.length} cache-group row(s) + ${orphanRowsToGeocode.length} ` +
      `orphan-group coordinate(s) = ${combinedTargets.length} total this run.`
  );

  const kakaoCount = combinedTargets.filter((t) => {
    const { lat, lon } = geocodeCoordinateOf(t);
    return isInKorea(lat, lon);
  }).length;
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

  // insertedCount tracks rows this run ACTUALLY inserted, separate from
  // write failures — an onConflictDoNothing no-op is neither (see
  // applyPlaceCacheInserts's own doc comment), so orphanOutcomes.length
  // minus failures would overstate "inserted" by counting no-ops as if
  // they were fresh rows.
  let orphanInsertedCount = 0;
  const orphanWriteFailures = await resolveOutcomes(
    orphanOutcomes,
    cacheMap,
    dryRun,
    async (outs) => {
      const { failures: insertFailures, insertedCount } = await applyPlaceCacheInserts(outs, now);
      orphanInsertedCount += insertedCount;
      return insertFailures;
    }
  );
  failures.push(
    ...orphanWriteFailures.map((f) => toFailure("place_cache INSERT (orphan group)", f))
  );

  printPlaceCacheSample(cacheRowsToGeocode, cacheOutcomes, cacheGeocodeFailures);
  printOrphanCacheSample(orphanRowsToGeocode, orphanOutcomes, orphanGeocodeFailures);

  // Step 4-5: visits, scoped to userId. Reads the single cacheMap, now
  // holding both groups' resolved outcomes — same code as before the
  // orphan group existed.
  const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

  // "candidates" is only genuinely exact/unsampled for the cache group: ALL
  // of `cacheRows` loads into `cacheMap` regardless of dry-run sampling, so
  // a visit matching a cache-group coordinate is always counted. The orphan
  // group is different in dry-run mode specifically: an orphan coordinate
  // never gets a cacheMap entry until it resolves, and dry-run only
  // resolves the sampled `orphanRowsToGeocode` slice — so a visit at an
  // unsampled orphan coordinate is silently excluded from `candidates` too,
  // not just from `changes`. Calling this "exact, unsampled" unconditionally
  // (as the pre-orphan-group version of this line did) would be false for a
  // dry run that has more than SAMPLE_SIZE orphan coordinates; the real
  // apply-run number can come in HIGHER than what dry-run shows here.
  console.log(
    `\nvisits (user ${userId}): ${visitRows.length} total, ${candidates.length} match a ` +
      `place_cache coordinate already in memory this run` +
      (dryRun
        ? ` (exact for the cache group; for the orphan group this only reflects the ` +
          `${orphanRowsToGeocode.length}-of-${orphanCoordinates.length} sampled coordinate(s) that ` +
          `resolved above — an apply run's candidate count can come in HIGHER than this).`
        : ` (exact upper bound — the real "would change" count can't exceed this).`) +
      ` ${changes.length} would actually change value` +
      (dryRun ? ` based on that same sample (NOT the true full-run count).` : ".")
  );

  printVisitSample(changes);

  if (!dryRun) {
    const visitFailures = await applyVisitChanges(changes);
    failures.push(...visitFailures);
    console.log(
      `\nAPPLY totals: place_cache updated=${cacheOutcomes.length - placeCacheUpdateFailureCount}/${cacheTargetRows.length}, ` +
        `place_cache inserted=${orphanInsertedCount}/${orphanCoordinates.length} ` +
        `(${orphanOutcomes.length - orphanInsertedCount - orphanWriteFailures.length} conflict-skip no-op(s) not counted as inserts), ` +
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
