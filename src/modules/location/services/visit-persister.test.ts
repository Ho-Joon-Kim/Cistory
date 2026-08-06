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
        state.deletedStaleKeys = state.placeCacheRows
          .filter((r) => r.region === null || r.region === undefined)
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

import { detectAndPersistVisits } from "./visit-persister";

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
// (37.5, 127) so it round-trips through roundCoord() unchanged.
function seedVisitPoints() {
  state.points = [
    { lat: 37.5, lon: 127, timestamp: new Date("2026-07-21T15:00:00.000Z") },
    { lat: 37.5, lon: 127, timestamp: new Date("2026-07-21T15:05:00.000Z") },
  ];
}

describe("visit-persister region/country enrichment", () => {
  it("uses the cached region/country on a cache hit, without calling geocoding", async () => {
    seedVisitPoints();
    state.placeCacheRows = [
      {
        latKey: 37.5,
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

  it("treats a cache row with region: null as stale and re-geocodes", async () => {
    seedVisitPoints();
    // Old-style cache row from before region/country existed: distinct
    // placeName/address and a category, so it would NOT trip the old
    // (placeName === address && !category) staleness check.
    state.placeCacheRows = [
      {
        latKey: 37.5,
        lonKey: 127,
        placeName: "강남역",
        address: "서울 강남구 역삼동",
        category: "지하철역",
        provider: "kakao",
        region: null,
        country: null,
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];
    state.reverseGeocode.mockResolvedValue({
      placeName: "강남역 2",
      address: "서울 강남구 역삼동 2",
      category: "지하철역",
      provider: "kakao",
      region: "서울",
      country: "대한민국",
    });

    const result = await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.reverseGeocode).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].city).toBe("서울");
    expect(result[0].countryName).toBe("대한민국");

    // The refreshed row written back to place_cache must carry the new fields.
    expect(state.insertedPlaceCache).toHaveLength(1);
    expect(state.insertedPlaceCache[0].region).toBe("서울");
    expect(state.insertedPlaceCache[0].country).toBe("대한민국");

    // The stale cache row must have been deleted before re-geocoding.
    expect(state.deletedStaleKeys).toEqual([{ latKey: 37.5, lonKey: 127 }]);
  });

  it("treats a cache row with region: null but a resolved country as a hit, not stale", async () => {
    seedVisitPoints();
    // A legitimate geocode where the provider resolved no admin region for
    // this coordinate (mapbox.ts/google.ts both fall back to `region: null`
    // on an otherwise-successful response) but did resolve a country. Only
    // BOTH columns null means "pre-migration row" — region alone must not
    // trip staleness, or this coordinate re-geocodes forever and never caches.
    state.placeCacheRows = [
      {
        latKey: 37.5,
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
        lat: 37.5,
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
        latKey: 37.5,
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
