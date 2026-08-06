import { describe, expect, it } from "vitest";
import type { GeocodingResult } from "../src/lib/adapters/geocoding";
import { placeCacheCoordKey } from "../src/lib/geo";
import type { CacheEntry, VisitRow } from "./backfill-visit-regions";
import {
  buildOutcome,
  cacheKey,
  findOrphanVisitCoordinates,
  isCacheRowUnresolved,
  planVisitChanges,
  resolveOutcomes,
} from "./backfill-visit-regions";
import { parseUserIdArgs } from "./lib/backfill-args";

// Covers the same review findings backfill-tracks.test.ts guards for a
// similarly destructive script: this one repairs place_cache.region/country
// and visits.city/country_name for real users, so a typo'd --dry-run must
// never silently resolve to a live run.

describe("parseUserIdArgs", () => {
  it("parses a valid dry run", () => {
    const result = parseUserIdArgs(["u1", "--dry-run"]);
    expect(result).toEqual({ userId: "u1", dryRun: true });
  });

  it("parses a valid live run (no flag)", () => {
    const result = parseUserIdArgs(["u1"]);
    expect(result).toEqual({ userId: "u1", dryRun: false });
  });

  // The reviewer pattern from backfill-args.test.ts's sibling coverage:
  // each of these must resolve to a loud error, never a silent live run —
  // i.e. never `{ userId: "u1", dryRun: false }`.
  const dryRunTypos = ["--dryrun", "-dry-run", "--Dry-Run", " --dry-run"];

  for (const typo of dryRunTypos) {
    it(`rejects the typo'd flag ${JSON.stringify(typo)} as an error, not a silent live run`, () => {
      const result = parseUserIdArgs(["u1", typo]);

      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toBeTruthy();

      // The specific failure mode under test: it must NOT be the shape a
      // silent live run would produce.
      expect(result).not.toEqual({ userId: "u1", dryRun: false });
      expect(result).not.toHaveProperty("dryRun", false);
    });
  }

  it("errors on too few positionals (no userId)", () => {
    const result = parseUserIdArgs([]);
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("dryRun", false);
  });

  it("errors on too few positionals (--dry-run only, no userId)", () => {
    const result = parseUserIdArgs(["--dry-run"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on too many positionals", () => {
    const result = parseUserIdArgs(["u1", "u2"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on an unknown flag such as --force", () => {
    const result = parseUserIdArgs(["u1", "--force"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--force/);
  });

  it("errors on an unknown flag even when the positional is otherwise valid", () => {
    // Guards the exact bug shape: 1 good positional + one bad token that
    // must not just fall off the end of a destructure.
    const result = parseUserIdArgs(["--force", "u1"]);
    expect(result).toHaveProperty("error");
  });
});

// Coordinator review round 1, Finding 2: the target filter used to test
// `region === null` alone, reproducing a bug already fixed in
// visit-persister.ts's `isStale` check. A legitimate geocode can return
// `region: null` with a set `country` (mapbox.ts/google.ts fall back to
// null region when no admin region resolves for a coordinate) — testing
// region alone would re-select and re-geocode that row on every future run
// forever, burning API quota without ever converging.
describe("isCacheRowUnresolved", () => {
  it("treats a row with both region and country null as unresolved — a re-geocode target", () => {
    expect(isCacheRowUnresolved({ region: null, country: null })).toBe(true);
  });

  it("does NOT treat a null region with a set country as unresolved — the exact case the old single-column filter got wrong", () => {
    // Under the old `row.region === null` filter this row would have been
    // wrongly selected as a target (and re-geocoded, forever, every run).
    expect(isCacheRowUnresolved({ region: null, country: "Hong Kong" })).toBe(false);
  });

  it("treats a row with both region and country set as resolved", () => {
    expect(isCacheRowUnresolved({ region: "서울", country: "대한민국" })).toBe(false);
  });

  it("treats a row with a set region but null country as resolved", () => {
    expect(isCacheRowUnresolved({ region: "서울", country: null })).toBe(false);
  });
});

// Covers the gap this branch closes: under the pre-4cb4e21 code, a
// saved-place visit skipped the geocode lookup entirely, so no
// place_cache row was ever created for its coordinate. The original
// script's step 4/5 ("no matching place_cache row at all is left
// untouched") could never reach those visits no matter how many times it
// ran — this "orphan group" is what discovers them.
describe("findOrphanVisitCoordinates", () => {
  it("a visit coordinate with no place_cache row becomes an orphan-group target, carrying the TRUE center alongside the rounded grid key", () => {
    const cacheMap = new Map<string, CacheEntry>();
    const centerLat = 37.5665;
    const centerLon = 126.978;

    const result = findOrphanVisitCoordinates([{ centerLat, centerLon }], cacheMap);

    // Both the rounded grid key (what place_cache is looked up/written by)
    // AND the true visit center (what reverseGeocode must be called
    // against — see geocodeCoordinateOf) must be present. Losing the true
    // center here would silently regress to geocoding the rounded key.
    expect(result).toEqual([
      {
        latKey: placeCacheCoordKey(centerLat),
        lonKey: placeCacheCoordKey(centerLon),
        centerLat,
        centerLon,
      },
    ]);
  });

  it("a visit coordinate that already has a place_cache row does NOT become an orphan-group target (no duplicate geocode, no INSERT attempt)", () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    const key = cacheKey(placeCacheCoordKey(centerLat), placeCacheCoordKey(centerLon));
    const cacheMap = new Map<string, CacheEntry>([
      [key, { region: "서울", country: "대한민국", resolved: true }],
    ]);

    const result = findOrphanVisitCoordinates([{ centerLat, centerLon }], cacheMap);

    expect(result).toEqual([]);
  });

  it("also excludes a coordinate whose existing place_cache row is itself unresolved — that row is already the cache group's job, not the orphan group's", () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    const key = cacheKey(placeCacheCoordKey(centerLat), placeCacheCoordKey(centerLon));
    const cacheMap = new Map<string, CacheEntry>([
      [key, { region: null, country: null, resolved: false }],
    ]);

    const result = findOrphanVisitCoordinates([{ centerLat, centerLon }], cacheMap);

    expect(result).toEqual([]);
  });

  it("two visits sharing a rounded coordinate produce exactly one geocode target", () => {
    const cacheMap = new Map<string, CacheEntry>();
    const visitA = { centerLat: 37.56651, centerLon: 126.97801 };
    const visitB = { centerLat: 37.56654, centerLon: 126.97804 };
    // Sanity-check the premise: both raw coordinates really do round to the
    // same place_cache grid key.
    expect(placeCacheCoordKey(visitA.centerLat)).toBe(placeCacheCoordKey(visitB.centerLat));
    expect(placeCacheCoordKey(visitA.centerLon)).toBe(placeCacheCoordKey(visitB.centerLon));

    const result = findOrphanVisitCoordinates([visitA, visitB], cacheMap);

    // The FIRST visit at the grid cell is the representative true center —
    // visitA's raw coordinates, not visitB's, and not the rounded key.
    expect(result).toEqual([
      {
        latKey: placeCacheCoordKey(visitA.centerLat),
        lonKey: placeCacheCoordKey(visitA.centerLon),
        centerLat: visitA.centerLat,
        centerLon: visitA.centerLon,
      },
    ]);
  });
});

// Coordinator review round 2, Finding 3: geocodeTargets' routing of a
// geocode result to the cache group's UPDATE path vs the orphan group's
// INSERT path had no direct test — a mis-routing bug (e.g. an orphan
// result built as a bare cache outcome) would be invisible to the type
// system, since OrphanGeocodeOutcome structurally satisfies GeocodeOutcome
// too. buildOutcome is the one place that decision is made; pin it here
// without needing a live geocode call.
describe("buildOutcome", () => {
  const fakeResult: GeocodingResult = {
    placeName: "스타벅스 강남R점",
    address: "서울 강남구 역삼동",
    category: "카페",
    provider: "kakao",
    region: "서울",
    country: "대한민국",
  };

  it("routes a cache-group target to a bare region/country outcome for the UPDATE path", () => {
    const target = { kind: "cache" as const, latKey: 37.5, lonKey: 127.0 };

    const built = buildOutcome(target, fakeResult);

    expect(built).toEqual({
      kind: "cache",
      outcome: { latKey: 37.5, lonKey: 127.0, region: "서울", country: "대한민국" },
    });
  });

  it("routes an orphan-group target to a full outcome (placeName/address/category/provider) for the INSERT path", () => {
    const target = {
      kind: "orphan" as const,
      latKey: 37.5,
      lonKey: 127.0,
      centerLat: 37.50044,
      centerLon: 127.00048,
    };

    const built = buildOutcome(target, fakeResult);

    expect(built).toEqual({
      kind: "orphan",
      outcome: {
        latKey: 37.5,
        lonKey: 127.0,
        region: "서울",
        country: "대한민국",
        placeName: "스타벅스 강남R점",
        address: "서울 강남구 역삼동",
        category: "카페",
        provider: "kakao",
      },
    });
  });

  it("keys both groups' outcomes by the ROUNDED grid key, not the orphan target's true center", () => {
    const target = {
      kind: "orphan" as const,
      latKey: 37.5,
      lonKey: 127.0,
      centerLat: 37.50044,
      centerLon: 127.00048,
    };

    const built = buildOutcome(target, fakeResult);

    expect(built.outcome.latKey).toBe(37.5);
    expect(built.outcome.lonKey).toBe(127.0);
  });
});

// The load-bearing coverage for the orphan group: it must go through the
// SAME resolution gate as the cache group (resolution requires the geocode
// to succeed AND, in apply mode, the write to persist), not around it —
// see the file header's "Row-failure isolation" and its orphan-group
// addendum.
describe("resolveOutcomes + planVisitChanges (orphan-group resolution gate)", () => {
  it("an orphan coordinate that never produced a geocode outcome (failed reverseGeocode) stays absent from the cache map, and its visit is left untouched", () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    // A failed reverseGeocode (after retry) never reaches resolveOutcomes as
    // an outcome — it only shows up in geocodeTargets' failures list, so
    // there is nothing to resolve and cacheMap simply never gets an entry
    // for this coordinate. Exercised directly via planVisitChanges rather
    // than a no-op resolveOutcomes([], ...) call (which would pass whether
    // or not the resolution gate exists at all, and isn't real coverage).
    const cacheMap = new Map<string, CacheEntry>();

    const visitRows: VisitRow[] = [
      {
        id: "v1",
        centerLat,
        centerLon,
        city: "목척7길", // real parsed-address garbage this backfill targets
        countryName: null,
      },
    ];
    const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

    // step 5: no matching place_cache row — left untouched, not even a
    // candidate.
    expect(candidates).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("dry-run mode never invokes the writer — an INSERT/UPDATE firing during --dry-run is the worst bug this script could have", async () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    const latKey = placeCacheCoordKey(centerLat);
    const lonKey = placeCacheCoordKey(centerLon);
    const cacheMap = new Map<string, CacheEntry>();
    const outcome = { latKey, lonKey, region: "서울", country: "대한민국" };

    let writerCalls = 0;
    const writer = async () => {
      writerCalls++;
      return [];
    };

    const writeFailures = await resolveOutcomes([outcome], cacheMap, true, writer);

    // The direct pin: if the `if (dryRun) { ...; return []; }` early return
    // in resolveOutcomes were ever removed, this would call `writer` and
    // writerCalls would be 1, failing this assertion.
    expect(writerCalls).toBe(0);
    expect(writeFailures).toEqual([]);
    // Resolution still happens from the geocode alone — dry-run has nothing
    // to gate a write on, so a successful geocode is enough (matches the
    // file header's "--dry-run" section).
    expect(cacheMap.get(cacheKey(latKey, lonKey))).toEqual({
      region: "서울",
      country: "대한민국",
      resolved: true,
    });
  });

  it("an orphan coordinate whose place_cache INSERT fails after a successful geocode stays unresolved, and its visit is left untouched", async () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    const latKey = placeCacheCoordKey(centerLat);
    const lonKey = placeCacheCoordKey(centerLon);
    const cacheMap = new Map<string, CacheEntry>(); // orphan: no pre-existing row

    const outcome = {
      latKey,
      lonKey,
      region: "서울",
      country: "대한민국",
      placeName: "Some Place",
      address: "Some Address",
      category: null as string | null,
      provider: "kakao" as const,
    };

    // Simulates the INSERT throwing/failing for this exact row — e.g. a
    // lock timeout or a network blip after a successful geocode.
    const failingWriter = async (outs: (typeof outcome)[]) =>
      outs.map((o) => ({ latKey: o.latKey, lonKey: o.lonKey, error: new Error("insert failed") }));

    const writeFailures = await resolveOutcomes([outcome], cacheMap, false, failingWriter);

    expect(writeFailures).toHaveLength(1);
    // The load-bearing assertion: a successful geocode whose write failed
    // must NOT appear in the cache map as resolved. If the gate were
    // bypassed (e.g. resolveOutcomes marked every outcome resolved
    // regardless of write success), this coordinate would show up here
    // with resolved: true instead of being absent.
    expect(cacheMap.has(cacheKey(latKey, lonKey))).toBe(false);

    const visitRows: VisitRow[] = [
      {
        id: "v1",
        centerLat,
        centerLon,
        city: "Nonhyeon-dong,", // real parsed-address garbage this backfill targets
        countryName: null,
      },
    ];
    const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

    // Untouched: not even counted as a candidate, and definitely not queued
    // for a visits UPDATE — this is exactly what would break (city silently
    // flips to "서울" / countryName to "대한민국") if the gate were bypassed.
    expect(candidates).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("resolves normally when the write succeeds, so the gate isn't just permanently closed", async () => {
    const centerLat = 37.5665;
    const centerLon = 126.978;
    const latKey = placeCacheCoordKey(centerLat);
    const lonKey = placeCacheCoordKey(centerLon);
    const cacheMap = new Map<string, CacheEntry>();

    const outcome = {
      latKey,
      lonKey,
      region: "서울",
      country: "대한민국",
      placeName: "Some Place",
      address: "Some Address",
      category: null as string | null,
      provider: "kakao" as const,
    };

    const writeFailures = await resolveOutcomes([outcome], cacheMap, false, async () => []);

    expect(writeFailures).toEqual([]);
    expect(cacheMap.get(cacheKey(latKey, lonKey))).toEqual({
      region: "서울",
      country: "대한민국",
      resolved: true,
    });

    const visitRows: VisitRow[] = [
      { id: "v1", centerLat, centerLon, city: "목척7길", countryName: null },
    ];
    const { candidates, changes } = planVisitChanges(visitRows, cacheMap);

    expect(candidates).toHaveLength(1);
    expect(changes).toEqual([
      {
        id: "v1",
        currentCity: "목척7길",
        currentCountry: null,
        newCity: "서울",
        newCountry: "대한민국",
      },
    ]);
  });
});
