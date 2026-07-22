import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { distanceM } from "@/lib/geo";
import {
  findDominantVisitCenter,
  markTripNotATrip,
  TripHasNoVisitsError,
  TripNotFoundError,
} from "./not-a-trip";

type Visit = Parameters<typeof findDominantVisitCenter>[0][number];

function visit(
  lat: number,
  lon: number,
  durationSeconds: number,
  overrides: Partial<Visit> = {}
): Visit {
  return {
    centerLat: lat,
    centerLon: lon,
    durationSeconds,
    placeName: null,
    address: null,
    city: null,
    ...overrides,
  };
}

describe("findDominantVisitCenter", () => {
  it("여러 지역 중 총 체류 시간이 가장 긴 지역의 가중 중심을 고른다", () => {
    const center = findDominantVisitCenter([
      visit(36.35, 127.38, 7_200, { city: "대전" }),
      visit(36.36, 127.39, 3_600, { city: "대전" }),
      visit(35.18, 129.08, 14_400, { placeName: "부산역", city: "부산" }),
      visit(35.19, 129.09, 10_800, { city: "부산" }),
    ]);

    expect(center).toMatchObject({ city: "부산", placeName: "부산역", durationSeconds: 25_200 });
    expect(center?.lat).toBeCloseTo(35.1843, 3);
    expect(center?.lon).toBeCloseTo(129.0843, 3);
  });

  it("방문이 없으면 null을 반환한다", () => {
    expect(findDominantVisitCenter([])).toBeNull();
  });
});

interface FakeOptions {
  trip?: { id: string; startDate: string; endDate: string; name: string } | null;
  visits?: Visit[];
  places?: Array<Record<string, unknown>>;
  failDelete?: boolean;
}

const homePlace = {
  id: "place-home",
  userId: "user-1",
  name: "집",
  lat: 37.5,
  lon: 127,
  radiusM: 100,
  category: "home",
  address: null,
  excludeFromTrips: false,
  tripExclusionRadiusM: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function fakeDatabase(options: FakeOptions = {}) {
  const events: string[] = [];
  const trip =
    options.trip === undefined
      ? { id: "trip-1", startDate: "2026-07-15", endDate: "2026-07-18", name: "논산 여행" }
      : options.trip;
  const tripVisits = options.visits ?? [visit(36.19, 127.1, 7_200, { city: "논산" })];
  const places = options.places ?? [];
  const userPlaces = [...places, homePlace];
  const createdPlaces: Array<Record<string, unknown>> = [];
  const updatedPlaces: Array<Record<string, unknown>> = [];
  let selectCall = 0;

  const tx = {
    execute: vi.fn(async () => {
      events.push("lock");
      return { rows: [] };
    }),
    select: vi.fn(() => {
      selectCall += 1;
      const rows =
        selectCall === 1 ? (trip ? [trip] : []) : selectCall === 2 ? userPlaces : tripVisits;
      const builder: Record<string, unknown> = {};
      for (const method of ["from", "where", "orderBy"]) builder[method] = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable thenables.
      builder.then = (resolve: (value: unknown) => void) => {
        events.push(selectCall === 1 ? "trip" : selectCall === 2 ? "places" : "visits");
        resolve(rows);
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          events.push("create-place");
          const created = { id: "place-new", ...row };
          createdPlaces.push(created);
          return [created];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            events.push("update-place");
            const updated = { ...places[0], ...updates };
            updatedPlaces.push(updated);
            return [updated];
          },
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: () => ({
        returning: async () => {
          events.push("delete-trip");
          if (options.failDelete) throw new Error("delete failed");
          return trip ? [{ id: trip.id }] : [];
        },
      }),
    })),
  };
  const db = {
    transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) => {
      events.push("begin");
      try {
        const result = await operation(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    }),
  } as unknown as Database;

  return { db, events, createdPlaces, updatedPlaces };
}

describe("markTripNotATrip", () => {
  it("제외 장소를 만든 뒤 같은 transaction에서 여행을 삭제한다", async () => {
    const fake = fakeDatabase();

    const result = await markTripNotATrip("user-1", "trip-1", fake.db);

    expect(result).toMatchObject({ tripId: "trip-1", reusedPlace: false });
    expect(result.place).toMatchObject({
      userId: "user-1",
      radiusM: 100,
      excludeFromTrips: true,
      tripExclusionRadiusM: 10_000,
    });
    expect(fake.events).toEqual([
      "begin",
      "lock",
      "trip",
      "places",
      "visits",
      "create-place",
      "delete-trip",
      "commit",
    ]);
  });

  it("10km 안의 기존 장소를 재사용해 중복 생성을 막는다", async () => {
    const existing = {
      id: "place-existing",
      userId: "user-1",
      name: "본가",
      lat: 36.2,
      lon: 127.1,
      radiusM: 100,
      category: null,
      address: null,
      excludeFromTrips: false,
      tripExclusionRadiusM: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const fake = fakeDatabase({ places: [existing] });

    const result = await markTripNotATrip("user-1", "trip-1", fake.db);

    expect(result).toMatchObject({ reusedPlace: true, place: { id: "place-existing" } });
    expect(fake.createdPlaces).toHaveLength(0);
    expect(fake.updatedPlaces[0]).toMatchObject({
      excludeFromTrips: true,
      tripExclusionRadiusM: 10_000,
    });
  });

  it("경계일의 집 체류가 더 길어도 목적지에 제외 장소를 만든다", async () => {
    const fake = fakeDatabase({
      visits: [
        visit(37.5, 127, 18 * 60 * 60, { placeName: "집", city: "서울" }),
        visit(35.18, 129.08, 4 * 60 * 60, {
          placeName: "부산역",
          address: "부산광역시 동구",
          city: "부산",
        }),
      ],
    });

    const result = await markTripNotATrip("user-1", "trip-1", fake.db);

    expect(result.place).toMatchObject({
      name: "부산역",
      lat: 35.18,
      lon: 129.08,
      address: "부산광역시 동구",
      excludeFromTrips: true,
    });
    expect(
      distanceM(homePlace.lat, homePlace.lon, result.place.lat, result.place.lon)
    ).toBeGreaterThan(100_000);
  });

  it("여행 삭제가 실패하면 장소 생성까지 rollback한다", async () => {
    const fake = fakeDatabase({ failDelete: true });

    await expect(markTripNotATrip("user-1", "trip-1", fake.db)).rejects.toThrow("delete failed");

    expect(fake.events.at(-1)).toBe("rollback");
    expect(fake.events).not.toContain("commit");
  });

  it("다른 사용자의 여행처럼 소유한 여행이 없으면 장소를 만들지 않는다", async () => {
    const fake = fakeDatabase({ trip: null });

    await expect(markTripNotATrip("user-1", "other-trip", fake.db)).rejects.toBeInstanceOf(
      TripNotFoundError
    );
    expect(fake.events).toEqual(["begin", "lock", "trip", "rollback"]);
    expect(fake.createdPlaces).toHaveLength(0);
  });

  it("방문이 없으면 여행을 삭제하지 않고 400 도메인 오류를 낸다", async () => {
    const fake = fakeDatabase({ visits: [] });

    await expect(markTripNotATrip("user-1", "trip-1", fake.db)).rejects.toBeInstanceOf(
      TripHasNoVisitsError
    );
    expect(fake.events).not.toContain("delete-trip");
    expect(fake.events.at(-1)).toBe("rollback");
  });

  it("집 방문만 남으면 여행을 삭제하지 않는다", async () => {
    const fake = fakeDatabase({ visits: [visit(37.5, 127, 7_200, { placeName: "집" })] });

    await expect(markTripNotATrip("user-1", "trip-1", fake.db)).rejects.toBeInstanceOf(
      TripHasNoVisitsError
    );

    expect(fake.events).not.toContain("create-place");
    expect(fake.events).not.toContain("delete-trip");
    expect(fake.events.at(-1)).toBe("rollback");
  });
});
