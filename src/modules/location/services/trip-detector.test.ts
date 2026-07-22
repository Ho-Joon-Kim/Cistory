// TZ is pinned so these tests exercise the production KST calendar-day rules.
process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SavedPlaceRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  excludeFromTrips: boolean;
  tripExclusionRadiusM: number | null;
  updatedAt: Date;
}

interface TrackRow {
  startTime: Date;
  endTime: Date;
  distanceMeters: number;
}

const mockState = vi.hoisted(() => ({
  savedPlaceRows: [] as SavedPlaceRow[],
  visitRows: [] as unknown[],
  trackRows: [] as TrackRow[],
  insertedRows: [] as unknown[],
  trackSelectCount: 0,
  selectError: null as Error | null,
  transactionCount: 0,
  excludeBusanOnFirstTransaction: false,
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const emptySelect = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {
      from: (table: unknown) => {
        if (table === actual.savedPlaces) rows = mockState.savedPlaceRows;
        return builder;
      },
      where: () => Promise.resolve(rows),
    };
    return builder;
  };
  return {
    ...actual,
    getDb: () => {
      const database = {
        select: () => {
          let rows: unknown[] = [];
          const builder: Record<string, unknown> = {
            from: (table: unknown) => {
              if (table === actual.savedPlaces) rows = mockState.savedPlaceRows;
              else if (table === actual.tracks) {
                rows = mockState.trackRows;
                mockState.trackSelectCount += 1;
              } else rows = mockState.visitRows;
              return builder;
            },
            // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are awaitable thenables
            then: (resolve: (value: unknown[]) => void, reject: (error: Error) => void) =>
              mockState.selectError ? reject(mockState.selectError) : resolve(rows),
          };
          for (const method of ["where", "limit", "orderBy", "groupBy"]) {
            builder[method] = () => builder;
          }
          return builder;
        },
        insert: () => ({
          values: (rows: unknown[]) => {
            mockState.insertedRows = rows;
            return Promise.resolve();
          },
        }),
        transaction: async (operation: (tx: Record<string, unknown>) => Promise<unknown>) => {
          mockState.transactionCount += 1;
          if (mockState.transactionCount === 1 && mockState.excludeBusanOnFirstTransaction) {
            mockState.savedPlaceRows.push(
              savedPlace("부산 생활권", BUSAN, {
                excludeFromTrips: true,
                tripExclusionRadiusM: 10_000,
                updatedAt: new Date("2026-07-22T01:00:00Z"),
              })
            );
          }
          return operation({
            execute: () => Promise.resolve({ rows: [] }),
            select: emptySelect,
            delete: () => ({ where: () => Promise.resolve({ rowCount: 0 }) }),
            insert: database.insert,
            update: () => ({
              set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
            }),
          });
        },
      };
      return database;
    },
  };
});

import { detectAndPersistTrips, detectTrips, persistTrips, regenerateTrips } from "./trip-detector";

const HOME = { lat: 37.5665, lon: 126.978 };
const NEAR_HOME = { lat: 37.57, lon: 126.98 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const CHEONAN = { lat: 36.8151, lon: 127.1139 };
const DAEJEON_HOME = { lat: 36.3504, lon: 127.3845 };
const DAEJEON_8KM = { lat: 36.4223, lon: 127.3845 };
const JEONNAM = { lat: 34.8118, lon: 126.3922 };

interface Coord {
  lat: number;
  lon: number;
}

function savedPlace(
  name: string,
  at: Coord,
  options: Partial<Omit<SavedPlaceRow, "name" | "lat" | "lon">> = {}
): SavedPlaceRow {
  return {
    id: `place-${name}`,
    name,
    ...at,
    category: null,
    excludeFromTrips: false,
    tripExclusionRadiusM: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...options,
  };
}

function visit(startTimeIso: string, at: Coord, city: string | null, countryName: string | null) {
  return {
    centerLat: at.lat,
    centerLon: at.lon,
    startTime: new Date(startTimeIso),
    city,
    countryName,
    durationSeconds: 3600,
  };
}

const homeVisit = (date: string, hour = 8) =>
  visit(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`, NEAR_HOME, "서울", "대한민국");
const busanVisit = (date: string, hour = 12) =>
  visit(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`, BUSAN, "부산", "대한민국");

beforeEach(() => {
  mockState.savedPlaceRows = [savedPlace("집", HOME)];
  mockState.visitRows = [];
  mockState.trackRows = [];
  mockState.insertedRows = [];
  mockState.trackSelectCount = 0;
  mockState.selectError = null;
  mockState.transactionCount = 0;
  mockState.excludeBusanOnFirstTransaction = false;
});

describe("detectTrips", () => {
  it("includes mixed departure and arrival boundary days around consecutive core days", async () => {
    mockState.visitRows = [
      homeVisit("2026-07-15", 8),
      busanVisit("2026-07-15", 18),
      busanVisit("2026-07-16"),
      busanVisit("2026-07-17"),
      busanVisit("2026-07-18", 8),
      homeVisit("2026-07-18", 20),
    ];

    const result = await detectTrips("user-1", "2026-07-15", "2026-07-18");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startDate: "2026-07-15",
      endDate: "2026-07-18",
      visitedCities: ["부산"],
    });
  });

  it("does not treat a location under 100km from home as away", async () => {
    mockState.visitRows = [
      visit("2026-03-01T12:00:00+09:00", CHEONAN, "천안", "대한민국"),
      visit("2026-03-02T12:00:00+09:00", CHEONAN, "천안", "대한민국"),
    ];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toEqual([]);
  });

  it("drops consecutive days spent only inside a trip-excluded saved place", async () => {
    mockState.savedPlaceRows.push(
      savedPlace("본가", DAEJEON_HOME, {
        excludeFromTrips: true,
        tripExclusionRadiusM: 10_000,
      })
    );
    mockState.visitRows = [
      visit("2026-10-24T12:00:00+09:00", DAEJEON_HOME, "대전", "대한민국"),
      visit("2026-10-25T12:00:00+09:00", DAEJEON_8KM, "대전", "대한민국"),
    ];

    expect(await detectTrips("user-1", "2026-10-24", "2026-10-25")).toEqual([]);
  });

  it("uses a 10km default exclusion radius when none is configured", async () => {
    mockState.savedPlaceRows.push(savedPlace("본가", DAEJEON_HOME, { excludeFromTrips: true }));
    mockState.visitRows = [
      visit("2026-02-14T12:00:00+09:00", DAEJEON_8KM, "대전", "대한민국"),
      visit("2026-02-15T12:00:00+09:00", DAEJEON_8KM, "대전", "대한민국"),
    ];

    expect(await detectTrips("user-1", "2026-02-14", "2026-02-15")).toEqual([]);
  });

  it("여행 아님 장소 생성 후 재감지는 막고 설정을 끄면 다시 허용한다", async () => {
    mockState.visitRows = [busanVisit("2026-03-01"), busanVisit("2026-03-02")];
    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toHaveLength(1);

    const correctionPlace = savedPlace("부산 정기 방문지", BUSAN, {
      excludeFromTrips: true,
      tripExclusionRadiusM: 10_000,
      updatedAt: new Date("2026-07-22T01:00:00Z"),
    });
    mockState.savedPlaceRows.push(correctionPlace);
    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toEqual([]);

    correctionPlace.excludeFromTrips = false;
    correctionPlace.updatedAt = new Date("2026-07-22T02:00:00Z");
    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toHaveLength(1);
  });

  it("trims leading excluded days and keeps the subsequent one-night trip", async () => {
    mockState.savedPlaceRows.push(
      savedPlace("본가", DAEJEON_HOME, {
        excludeFromTrips: true,
        tripExclusionRadiusM: 10_000,
      })
    );
    mockState.visitRows = [
      visit("2026-02-14T12:00:00+09:00", DAEJEON_HOME, "대전", "대한민국"),
      visit("2026-02-15T12:00:00+09:00", DAEJEON_8KM, "대전", "대한민국"),
      visit("2026-02-16T12:00:00+09:00", DAEJEON_HOME, "대전", "대한민국"),
      visit("2026-02-17T12:00:00+09:00", JEONNAM, "전남", "대한민국"),
      visit("2026-02-18T08:00:00+09:00", JEONNAM, "전남", "대한민국"),
      homeVisit("2026-02-18", 20),
    ];

    const result = await detectTrips("user-1", "2026-02-14", "2026-02-18");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-02-17", endDate: "2026-02-18" });
  });

  it("trims trailing excluded days from an otherwise valid trip", async () => {
    mockState.savedPlaceRows.push(savedPlace("본가", DAEJEON_HOME, { excludeFromTrips: true }));
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      busanVisit("2026-03-02"),
      visit("2026-03-03T12:00:00+09:00", DAEJEON_HOME, "대전", "대한민국"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-03");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-02" });
  });

  it("keeps an excluded day when it is between valid core days", async () => {
    mockState.savedPlaceRows.push(savedPlace("본가", DAEJEON_HOME, { excludeFromTrips: true }));
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      visit("2026-03-02T12:00:00+09:00", DAEJEON_HOME, "대전", "대한민국"),
      busanVisit("2026-03-03"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-03");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-03" });
  });

  it("keeps a valid boundary day between core days", async () => {
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      homeVisit("2026-03-02", 8),
      busanVisit("2026-03-02", 18),
      busanVisit("2026-03-03"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-03");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-03" });
  });

  it("does not create a trip from boundary days without a core day", async () => {
    mockState.visitRows = [
      homeVisit("2026-03-01", 8),
      busanVisit("2026-03-01", 18),
      homeVisit("2026-03-02", 8),
      busanVisit("2026-03-02", 18),
    ];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toEqual([]);
  });

  it("splits trips at an observed home day", async () => {
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      busanVisit("2026-03-02"),
      homeVisit("2026-03-03"),
      busanVisit("2026-03-04"),
      busanVisit("2026-03-05"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-05");

    expect(result.map(({ startDate, endDate }) => ({ startDate, endDate }))).toEqual([
      { startDate: "2026-03-01", endDate: "2026-03-02" },
      { startDate: "2026-03-04", endDate: "2026-03-05" },
    ]);
  });

  it("splits trips at an unobserved calendar day", async () => {
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      busanVisit("2026-03-02"),
      busanVisit("2026-03-04"),
      busanVisit("2026-03-05"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-05");

    expect(result.map(({ startDate, endDate }) => ({ startDate, endDate }))).toEqual([
      { startDate: "2026-03-01", endDate: "2026-03-02" },
      { startDate: "2026-03-04", endDate: "2026-03-05" },
    ]);
  });

  it("does not merge two zero-night outings across an unknown day", async () => {
    mockState.visitRows = [busanVisit("2026-03-02"), busanVisit("2026-03-04")];

    expect(await detectTrips("user-1", "2026-03-02", "2026-03-04")).toEqual([]);
  });

  it("drops a same-day overseas visit because every trip requires a night", async () => {
    mockState.visitRows = [visit("2026-03-01T10:00:00+09:00", TOKYO, "도쿄", "일본")];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-01")).toEqual([]);
  });

  it("groups visits by KST calendar day", async () => {
    mockState.visitRows = [
      visit("2026-02-28T15:00:00Z", BUSAN, "부산", "대한민국"),
      visit("2026-03-01T14:59:00Z", BUSAN, "부산", "대한민국"),
      visit("2026-03-01T15:01:00Z", BUSAN, "부산", "대한민국"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-02");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-02" });
  });

  it("recognizes home by case-insensitive category or exact name", async () => {
    mockState.savedPlaceRows = [
      savedPlace("아파트", HOME, { category: "HOME" }),
      savedPlace("본가", DAEJEON_HOME, { excludeFromTrips: true }),
    ];
    mockState.visitRows = [busanVisit("2026-03-01"), busanVisit("2026-03-02")];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toHaveLength(1);

    mockState.savedPlaceRows = [savedPlace("home", HOME)];
    expect(await detectTrips("user-1", "2026-03-01", "2026-03-02")).toHaveLength(1);
  });

  it("returns an empty array safely when visits are absent", async () => {
    expect(await detectTrips("user-1", "2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("returns an empty array safely when home cannot be resolved", async () => {
    mockState.savedPlaceRows = [];
    mockState.visitRows = [];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("sums overlapping user tracks for each trip using one range query", async () => {
    mockState.visitRows = [
      busanVisit("2026-03-01"),
      busanVisit("2026-03-02"),
      homeVisit("2026-03-03"),
      busanVisit("2026-03-04"),
      busanVisit("2026-03-05"),
    ];
    mockState.trackRows = [
      {
        startTime: new Date("2026-03-01T23:00:00+09:00"),
        endTime: new Date("2026-03-02T01:00:00+09:00"),
        distanceMeters: 12_000,
      },
      {
        startTime: new Date("2026-03-03T23:30:00+09:00"),
        endTime: new Date("2026-03-04T00:30:00+09:00"),
        distanceMeters: 8_000,
      },
      {
        startTime: new Date("2026-03-05T10:00:00+09:00"),
        endTime: new Date("2026-03-05T11:00:00+09:00"),
        distanceMeters: 5_000,
      },
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-05");

    expect(result.map((trip) => trip.totalDistanceMeters)).toEqual([12_000, 13_000]);
    expect(mockState.trackSelectCount).toBe(1);
  });

  it("returns null distance when no track overlaps the trip", async () => {
    mockState.visitRows = [busanVisit("2026-03-01"), busanVisit("2026-03-02")];
    mockState.trackRows = [
      {
        startTime: new Date("2026-02-28T23:00:00+09:00"),
        endTime: new Date("2026-03-01T00:00:00+09:00"),
        distanceMeters: 99_000,
      },
      {
        startTime: new Date("2026-03-03T00:00:00+09:00"),
        endTime: new Date("2026-03-03T01:00:00+09:00"),
        distanceMeters: 88_000,
      },
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-02");

    expect(result[0].totalDistanceMeters).toBeNull();
  });
});

describe("persistTrips", () => {
  it("정정 완료 뒤 잠금을 얻은 stale 감지는 최신 제외 장소로 재계산한다", async () => {
    mockState.visitRows = [busanVisit("2026-03-01"), busanVisit("2026-03-02")];
    mockState.excludeBusanOnFirstTransaction = true;

    const result = await detectAndPersistTrips("user-1", "2026-03-01", "2026-03-02");

    expect(result).toMatchObject({ detected: 0, inserted: 0 });
    expect(mockState.transactionCount).toBe(2);
    expect(mockState.insertedRows).toEqual([]);
  });

  it("marks every detected trip as automatically detected", async () => {
    await persistTrips("user-1", [
      {
        name: "부산 방문",
        startDate: "2026-03-01",
        endDate: "2026-03-02",
        visitedCities: ["부산"],
        visitedCountries: ["대한민국"],
        isOverseas: false,
        totalDistanceMeters: null,
      },
    ]);

    expect(mockState.insertedRows).toEqual([
      expect.objectContaining({ userId: "user-1", autoDetected: true }),
    ]);
  });

  it("does not open the replacement transaction when candidate calculation fails", async () => {
    mockState.selectError = new Error("candidate query failed");

    await expect(regenerateTrips("user-1", "2026-03-01", "2026-03-02")).rejects.toThrow(
      "candidate query failed"
    );

    expect(mockState.transactionCount).toBe(0);
    expect(mockState.insertedRows).toEqual([]);
  });
});
