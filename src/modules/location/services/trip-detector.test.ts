// TZ is pinned so these tests exercise the exact production condition
// (containers run with TZ=Asia/Seoul, UTC+9). Must be set before any Date use:
// detectTrips groups visits into KST calendar days via toLocalDateString.
process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";

// trip-detector exports no DB-free pure functions, so getDb() is replaced with
// an in-memory fake: the savedPlaces query resolves to the fixture home and the
// visits query resolves to the fixture rows. Everything downstream of the two
// queries (KST day grouping, away/gap logic, overseas detection, naming) runs
// as real production code.
const mockState = vi.hoisted(() => ({
  home: null as { lat: number; lon: number } | null,
  visitRows: [] as unknown[],
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => {
        let rows: unknown[] = [];
        const builder: Record<string, unknown> = {
          from: (table: unknown) => {
            rows =
              table === actual.savedPlaces
                ? mockState.home
                  ? [mockState.home]
                  : []
                : mockState.visitRows;
            return builder;
          },
          // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are awaitable thenables; the fake must be too
          then: (resolve: (value: unknown[]) => void) => resolve(rows),
        };
        for (const method of ["where", "limit", "orderBy", "groupBy"]) {
          builder[method] = () => builder;
        }
        return builder;
      },
    }),
  };
});

import { detectTrips } from "./trip-detector";

// Home: Seoul City Hall. Away threshold is 50km from home.
const HOME = { lat: 37.5665, lon: 126.978 };
// ~325km from home, inside KOREA_BOUNDS → domestic away day.
const BUSAN = { lat: 35.1796, lon: 129.0756 };
// Outside KOREA_BOUNDS (lon 139.65 > 132) → overseas.
const TOKYO = { lat: 35.6762, lon: 139.6503 };
// ~400m from home → under the 50km threshold, marks the day as not-away.
const NEAR_HOME = { lat: 37.57, lon: 126.98 };

interface Coord {
  lat: number;
  lon: number;
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

const busanVisit = (iso: string) => visit(iso, BUSAN, "부산", "대한민국");

beforeEach(() => {
  mockState.home = HOME;
  mockState.visitRows = [];
});

describe("detectTrips", () => {
  it("groups consecutive away days into a single domestic trip", async () => {
    mockState.visitRows = [
      busanVisit("2026-03-01T10:00:00+09:00"),
      busanVisit("2026-03-02T11:00:00+09:00"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toEqual([
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
  });

  it("drops a single-day domestic outing (domestic trips need 2+ days)", async () => {
    mockState.visitRows = [busanVisit("2026-03-01T10:00:00+09:00")];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("keeps a single-day overseas trip and flags it isOverseas", async () => {
    mockState.visitRows = [visit("2026-03-01T10:00:00+09:00", TOKYO, "도쿄", "일본")];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toHaveLength(1);
    expect(result[0].isOverseas).toBe(true);
    expect(result[0].name).toBe("도쿄 여행");
    expect(result[0].startDate).toBe("2026-03-01");
    expect(result[0].endDate).toBe("2026-03-01");
  });

  it("names an overseas trip by country when no city is known", async () => {
    mockState.visitRows = [visit("2026-03-01T10:00:00+09:00", TOKYO, null, "일본")];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("일본 여행");
  });

  it("bridges a 1-day gap between away days into one trip", async () => {
    // Away on 03-01 and 03-03, nothing recorded on 03-02 (MAX_GAP_DAYS = 1).
    mockState.visitRows = [
      busanVisit("2026-03-01T10:00:00+09:00"),
      busanVisit("2026-03-03T10:00:00+09:00"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toHaveLength(1);
    expect(result[0].startDate).toBe("2026-03-01");
    expect(result[0].endDate).toBe("2026-03-03");
  });

  it("splits away days separated by more than the allowed gap into two trips", async () => {
    // 03-02 → 03-05 is a 3-day jump (> MAX_GAP_DAYS + 1) → two groups.
    mockState.visitRows = [
      busanVisit("2026-03-01T10:00:00+09:00"),
      busanVisit("2026-03-02T10:00:00+09:00"),
      busanVisit("2026-03-05T10:00:00+09:00"),
      busanVisit("2026-03-06T10:00:00+09:00"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toHaveLength(2);
    expect(result[0].startDate).toBe("2026-03-01");
    expect(result[0].endDate).toBe("2026-03-02");
    expect(result[1].startDate).toBe("2026-03-05");
    expect(result[1].endDate).toBe("2026-03-06");
  });

  it("excludes a day that has any visit near home, even if other visits are far", async () => {
    // 03-01 mixes a Busan visit with a near-home visit → not an away day;
    // the trip starts on 03-02.
    mockState.visitRows = [
      busanVisit("2026-03-01T10:00:00+09:00"),
      visit("2026-03-01T20:00:00+09:00", NEAR_HOME, "서울", "대한민국"),
      busanVisit("2026-03-02T10:00:00+09:00"),
      busanVisit("2026-03-03T10:00:00+09:00"),
    ];

    const result = await detectTrips("user-1", "2026-03-01", "2026-03-31");

    expect(result).toHaveLength(1);
    expect(result[0].startDate).toBe("2026-03-02");
    expect(result[0].endDate).toBe("2026-03-03");
  });

  it("assigns visits around midnight to KST calendar days, not UTC days", async () => {
    // 2026-02-28T15:00Z = 03-01 00:00 KST (exact midnight) → day 03-01
    // 2026-03-01T14:59Z = 03-01 23:59 KST → day 03-01
    // 2026-03-01T15:01Z = 03-02 00:01 KST → day 03-02
    // UTC-day grouping would instead yield 02-28..03-01.
    mockState.visitRows = [
      busanVisit("2026-02-28T15:00:00Z"),
      busanVisit("2026-03-01T14:59:00Z"),
      busanVisit("2026-03-01T15:01:00Z"),
    ];

    const result = await detectTrips("user-1", "2026-02-01", "2026-03-31");

    expect(result).toHaveLength(1);
    expect(result[0].startDate).toBe("2026-03-01");
    expect(result[0].endDate).toBe("2026-03-02");
  });

  it("returns no trips when every visit is near home", async () => {
    mockState.visitRows = [
      visit("2026-03-01T10:00:00+09:00", NEAR_HOME, "서울", "대한민국"),
      visit("2026-03-02T10:00:00+09:00", NEAR_HOME, "서울", "대한민국"),
    ];

    expect(await detectTrips("user-1", "2026-03-01", "2026-03-31")).toEqual([]);
  });
});
