process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  points: [] as { lat: number; lon: number; timestamp: Date }[],
  savedPlaceRows: [] as unknown[],
  placeCacheRows: [] as Record<string, unknown>[],
  insertedVisits: [] as Record<string, unknown>[],
  insertedPlaceCache: [] as Record<string, unknown>[],
  deletedStaleKeys: [] as { latKey: number; lonKey: number }[],
  reverseGeocode: vi.fn(),
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const nameOf = (table: object) => (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
  const query = <T>(data: T) => {
    const promise = Promise.resolve(data);
    return Object.assign(promise, { orderBy: () => promise });
  };

  const select = () => ({
    from: (table: object) => ({
      where: () => {
        const name = nameOf(table);
        if (name === "location_points") return query([...state.points]);
        if (name === "saved_places") return query([...state.savedPlaceRows]);
        if (name === "place_cache") return query([...state.placeCacheRows]);
        return query([]);
      },
    }),
  });

  const deleteFrom = (table: object) => ({
    where: async () => {
      const name = nameOf(table);
      if (name === "place_cache") {
        // Mirrors visit-persister.ts's isStale rule: a cache row is stale
        // (and thus deleted before re-geocoding) only when placeName and
        // address are identical and there's no category — NOT merely
        // because region/country are null (a legitimate geocode can resolve
        // without an admin region and must stay cached as-is).
        state.deletedStaleKeys = state.placeCacheRows
          .filter((r) => r.placeName === r.address && !r.category)
          .map((r) => ({ latKey: r.latKey as number, lonKey: r.lonKey as number }));
      }
      // "visits" deletes are a no-op for these tests (nothing pre-seeded).
    },
  });

  const insert = (table: object) => ({
    values: (values: unknown[]) => {
      const name = nameOf(table);
      if (name === "place_cache")
        state.insertedPlaceCache.push(...(values as Record<string, unknown>[]));
      if (name === "visits") state.insertedVisits.push(...(values as Record<string, unknown>[]));
      const promise = Promise.resolve();
      return Object.assign(promise, { onConflictDoNothing: () => Promise.resolve() });
    },
  });

  const db = {
    select,
    delete: deleteFrom,
    insert,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback({ select, delete: deleteFrom, insert }),
  };
  return { ...actual, getDb: () => db };
});

vi.mock("@/lib/adapters/geocoding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adapters/geocoding")>();
  return {
    ...actual,
    getGeocodingAdapter: () => ({
      reverseGeocode: state.reverseGeocode,
    }),
  };
});

import { detectAndPersistVisits, isStaleCacheRow } from "./visit-persister";

beforeEach(() => {
  state.points = [];
  state.savedPlaceRows = [];
  state.placeCacheRows = [];
  state.insertedVisits = [];
  state.insertedPlaceCache = [];
  state.deletedStaleKeys = [];
  state.reverseGeocode.mockReset();
});

// Two points at the same spot, 5 minutes apart, clear the visit detector's
// 3-minute / 2-point threshold and land the visit centroid at exactly
// (37.5224999, 127). The latitude is chosen so placeCacheCoordKey (3
// decimals: 37.522) and roundCoord (6 decimals: 37.5225) diverge — if
// visit-persister.ts were ever changed to look up place_cache with
// roundCoord instead of placeCacheCoordKey, the cache lookups below would
// silently miss and every test in this suite would fail.
function seedVisitPoints() {
  state.points = [
    { lat: 37.5224999, lon: 127, timestamp: new Date("2026-07-21T15:00:00.000Z") },
    { lat: 37.5224999, lon: 127, timestamp: new Date("2026-07-21T15:05:00.000Z") },
  ];
}

describe("visit-persister region/country enrichment", () => {
  it("uses the cached region/country on a cache hit, without calling geocoding", async () => {
    seedVisitPoints();
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "강남역",
        // Leading postal code, like the real cache rows that produced the
        // `visits.city === "06628,"` bug this task fixes. Old address-splitting
        // logic would read the FIRST token ("06628") as the city; the
        // structured `region` field below is what must win instead.
        address: "06628 서울특별시 강남구 역삼동",
        category: "지하철역",
        provider: "kakao",
        region: "서울",
        country: "대한민국",
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(result).toHaveLength(1);
    expect(result[0].city).toBe("서울");
    expect(result[0].countryName).toBe("대한민국");
    expect(state.reverseGeocode).not.toHaveBeenCalled();

    // The persisted row must carry the same enrichment, not just the API response.
    expect(state.insertedVisits).toHaveLength(1);
    expect(state.insertedVisits[0].city).toBe("서울");
    expect(state.insertedVisits[0].countryName).toBe("대한민국");
  });

  it("uses a cache row with region: null and country: null as-is, without re-geocoding forever", async () => {
    seedVisitPoints();
    // A coordinate where the provider legitimately resolved neither an admin
    // region nor a country — e.g. a POI is found but the address geocode
    // call itself comes back with zero results (google.test.ts's "returns
    // null region/country when the geocode response is empty"). This row
    // predates nothing; it's what a fresh geocode of this exact coordinate
    // produces today. Treating both-null as stale would re-geocode on every
    // touch, land on the same null/null result, and never converge — the
    // permanent re-geocode loop this fix removes. The pre-migration-0040
    // rows that condition used to catch (both columns null because the
    // columns didn't exist yet) were a one-time state, already repaired by
    // scripts/backfill-visit-regions.ts.
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "Some POI",
        address: "Some Address, Somewhere",
        category: "poi",
        provider: "google",
        region: null,
        country: null,
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.reverseGeocode).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].city).toBeNull();
    expect(result[0].countryName).toBeNull();
  });

  it("treats a cache row with placeName === address and no category, older than the 90-day retry bound, as stale and re-geocodes", async () => {
    seedVisitPoints();
    // The surviving staleness signal: a row where placeName and address are
    // identical and there's no category — a geocode that never really
    // resolved to anything more than the raw address. This must re-geocode
    // regardless of what region/country happen to hold, but only once it's
    // old enough (isStaleCacheRow's 90-day bound in visit-persister.ts) —
    // resolvedAt is computed relative to "now" rather than a fixed calendar
    // date so this test keeps pinning "old enough" as real time passes.
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "서울 강남구 역삼동",
        address: "서울 강남구 역삼동",
        category: null,
        provider: "kakao",
        region: "서울",
        country: "대한민국",
        resolvedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    ];
    state.reverseGeocode.mockResolvedValue({
      placeName: "강남역",
      address: "서울 강남구 역삼동 2",
      category: "지하철역",
      provider: "kakao",
      region: "서울",
      country: "대한민국",
    });

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.reverseGeocode).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].placeName).toBe("강남역");
    expect(result[0].city).toBe("서울");

    // The stale cache row must have been deleted before re-geocoding.
    expect(state.deletedStaleKeys).toEqual([{ latKey: 37.522, lonKey: 127 }]);
  });

  it("reuses a fresh POI-less cache row instead of re-geocoding it every time a visit lands there again", async () => {
    seedVisitPoints();
    // Same placeName === address, no-category shape as the test above, but
    // resolved recently. Before the 90-day age bound, this row would have
    // been deleted and re-geocoded on every visit that ever touched this
    // coordinate again — the exact non-convergence this fix removes.
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "Incheon Airport Rd",
        address: "Incheon Airport Rd",
        category: null,
        provider: "kakao",
        region: "인천",
        country: "대한민국",
        resolvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.reverseGeocode).not.toHaveBeenCalled();
    expect(state.deletedStaleKeys).toEqual([]);
    expect(result).toHaveLength(1);
    expect(result[0].placeName).toBe("Incheon Airport Rd");
    expect(result[0].city).toBe("인천");
  });

  it("treats a cache row with region: null but a resolved country as a hit, not stale", async () => {
    seedVisitPoints();
    // A legitimate geocode where the provider resolved no admin region for
    // this coordinate (mapbox.ts/google.ts both fall back to `region: null`
    // on an otherwise-successful response) but did resolve a country.
    // Region being null is never, by itself, a staleness signal — only
    // placeName === address && !category is — or this coordinate would
    // re-geocode forever and never cache.
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "Some POI",
        address: "Some Address, Hong Kong",
        category: "poi",
        provider: "mapbox",
        region: null,
        country: "Hong Kong",
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.reverseGeocode).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].city).toBeNull();
    expect(result[0].countryName).toBe("Hong Kong");
  });

  it("layers a saved-place name over the cached region/country, rather than skipping the lookup", async () => {
    seedVisitPoints();
    state.savedPlaceRows = [
      {
        id: "sp-1",
        userId: "user-1",
        name: "우리집",
        lat: 37.5224999,
        lon: 127,
        radiusM: 100,
        category: "집",
        address: "우리집 주소",
        excludeFromTrips: false,
        tripExclusionRadiusM: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    state.placeCacheRows = [
      {
        latKey: 37.522,
        lonKey: 127,
        placeName: "강남역",
        address: "서울특별시 강남구 역삼동",
        category: "지하철역",
        provider: "kakao",
        region: "서울",
        country: "대한민국",
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    // Name identity comes from the saved place, not the cache/geocode result.
    expect(result).toHaveLength(1);
    expect(result[0].placeName).toBe("우리집");
    expect(result[0].savedPlaceId).toBe("sp-1");
    // But the administrative region still comes from the coordinate lookup —
    // home is still in 서울, a saved place doesn't erase that.
    expect(result[0].city).toBe("서울");
    expect(result[0].countryName).toBe("대한민국");
    expect(state.reverseGeocode).not.toHaveBeenCalled();

    expect(state.insertedVisits).toHaveLength(1);
    expect(state.insertedVisits[0].placeName).toBe("우리집");
    expect(state.insertedVisits[0].savedPlaceId).toBe("sp-1");
    expect(state.insertedVisits[0].city).toBe("서울");
    expect(state.insertedVisits[0].countryName).toBe("대한민국");
  });
});

// The pure staleness decision, tested directly rather than through
// detectAndPersistVisits + the DB mock — no visit/geocode plumbing needed to
// pin the rule itself.
describe("isStaleCacheRow", () => {
  const now = new Date("2026-07-22T00:00:00.000Z");
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

  const poiLessRow = (resolvedAt: Date | null) => ({
    placeName: "Incheon Airport Rd",
    address: "Incheon Airport Rd",
    category: null,
    resolvedAt,
  });

  it("does not treat a fresh POI-less row as stale", () => {
    const resolvedAt = new Date(now.getTime() - 1_000);
    expect(isStaleCacheRow(poiLessRow(resolvedAt), now)).toBe(false);
  });

  it("treats a POI-less row older than the 90-day bound as stale", () => {
    const resolvedAt = new Date(now.getTime() - NINETY_DAYS_MS - 1_000);
    expect(isStaleCacheRow(poiLessRow(resolvedAt), now)).toBe(true);
  });

  it("does not treat a POI-less row exactly at the 90-day bound as stale (strictly greater-than)", () => {
    const resolvedAt = new Date(now.getTime() - NINETY_DAYS_MS);
    expect(isStaleCacheRow(poiLessRow(resolvedAt), now)).toBe(false);
  });

  it("never treats a row with a real POI name as stale, regardless of age", () => {
    const ancient = new Date(now.getTime() - 10 * NINETY_DAYS_MS);
    expect(
      isStaleCacheRow(
        {
          placeName: "강남역",
          address: "서울 강남구 역삼동",
          category: "지하철역",
          resolvedAt: ancient,
        },
        now
      )
    ).toBe(false);
    // placeName differs from address (even with no category) → never the
    // POI-less shape at all.
    expect(
      isStaleCacheRow(
        {
          placeName: "Some POI",
          address: "Some Address, Hong Kong",
          category: null,
          resolvedAt: ancient,
        },
        now
      )
    ).toBe(false);
  });

  it("treats a POI-less row with a null resolvedAt as stale — an undated row can't be judged fresh", () => {
    expect(isStaleCacheRow(poiLessRow(null), now)).toBe(true);
  });

  it("returns false when there is no cached row at all", () => {
    expect(isStaleCacheRow(undefined, now)).toBe(false);
  });
});
