import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { trips } from "@/db/schema";
import { getKstDateWindow } from "@/lib/date-key";
import { classify } from "@/modules/spending/classify";
import { aggregateSpending, decodeTripCursor, encodeTripCursor, TravelService } from "./service";

function createQueuedDb(results: unknown[][]) {
  const whereCalls: unknown[] = [];
  const selectedFields: Array<Record<string, unknown> | undefined> = [];
  let queryIndex = 0;

  const select = (fields?: Record<string, unknown>) => {
    const index = queryIndex++;
    selectedFields.push(fields);
    const builder = {
      from: () => builder,
      leftJoin: () => builder,
      where: (condition: unknown) => {
        whereCalls.push(condition);
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are promise-like.
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(results[index] ?? []).then(resolve, reject),
    };
    return builder;
  };

  return { db: { select } as never, selectedFields, whereCalls };
}

describe("travel date windows and cursors", () => {
  it("converts inclusive KST dates to a closed-open UTC wall-time range", () => {
    const range = getKstDateWindow("2026-07-15", "2026-07-18");

    expect(range.start.toISOString()).toBe("2026-07-14T15:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-18T15:00:00.000Z");
    expect(range.dayCount).toBe(4);
  });

  it("round-trips an opaque stable pagination cursor", () => {
    const value = { endDate: "2026-07-18", startDate: "2026-07-15", id: "trip-1" };
    const cursor = encodeTripCursor(value);

    expect(cursor).not.toContain("2026-07-18");
    expect(decodeTripCursor(cursor)).toEqual(value);
    expect(decodeTripCursor("not-a-cursor")).toBeNull();
  });
});

describe("aggregateSpending", () => {
  it("uses the shared spending rules that exclude self-transfers and ignored accounts", () => {
    const base = {
      type: "withdrawal",
      amount: 10_000,
      merchant: "홍길동",
      accountName: "생활비",
      spendingOverride: null,
    };

    expect(classify({ ...base, isSelfTransfer: true }, new Map(), null)).toBe("ignore");
    expect(classify({ ...base, isSelfTransfer: false }, new Map(), "홍길동")).toBe("ignore");
    expect(
      classify({ ...base, isSelfTransfer: false }, new Map([["생활비", "ignore"]]), null)
    ).toBe("ignore");
  });

  it("handles null categories and includes only rows already classified as spending", () => {
    const result = aggregateSpending(
      [
        {
          id: "tx-1",
          amount: 30_000,
          merchant: "식당",
          accountName: "토스",
          category: "food",
          transactedAt: new Date("2026-07-15T03:00:00Z"),
        },
        {
          id: "tx-2",
          amount: 20_000,
          merchant: "시장",
          accountName: "토스",
          category: null,
          transactedAt: new Date("2026-07-16T03:00:00Z"),
        },
      ],
      4
    );

    expect(result.total).toBe(50_000);
    expect(result.dailyAverage).toBe(12_500);
    expect(result.categories).toEqual([
      { category: "food", total: 30_000, count: 1 },
      { category: "uncategorized", total: 20_000, count: 1 },
    ]);
  });
});

describe("TravelService.getTripDetail", () => {
  it("returns an owner-scoped detail and hides health when absent", async () => {
    const trip = {
      id: "trip-1",
      userId: "user-1",
      name: "제주",
      startDate: "2026-07-15",
      endDate: "2026-07-18",
      totalDistanceMeters: 500_000,
      visitedCities: '["제주특별자치도"]',
      visitedCountries: '["대한민국"]',
      isOverseas: false,
      autoDetected: true,
      notes: null,
      createdAt: new Date("2026-07-19T00:00:00Z"),
      updatedAt: new Date("2026-07-19T00:00:00Z"),
    };
    const { db, whereCalls } = createQueuedDb([
      [trip],
      [{ tossMyName: "홍길동" }],
      [
        {
          id: "visit-1",
          centerLat: 33.4,
          centerLon: 126.5,
          startTime: new Date("2026-07-15T03:00:00Z"),
          endTime: new Date("2026-07-15T04:00:00Z"),
          durationSeconds: 3600,
          placeName: "협재",
          address: null,
          category: null,
          city: "제주특별자치도",
          countryName: "대한민국",
        },
      ],
      [
        { mode: "flying", distanceMeters: 473_000, durationSeconds: 4000 },
        { mode: "driving", distanceMeters: 27_000, durationSeconds: 3000 },
      ],
      [
        {
          id: "tx-1",
          amount: 40_000,
          merchant: "식당",
          accountName: "토스",
          category: null,
          transactedAt: new Date("2026-07-15T03:00:00Z"),
        },
      ],
      [
        { date: "2026-07-14", totalSeconds: 3600 },
        { date: "2026-07-15", totalSeconds: 600 },
      ],
      [
        { id: "commit-before", committedAt: new Date("2026-07-14T03:00:00Z") },
        { id: "commit-trip", committedAt: new Date("2026-07-15T03:00:00Z") },
      ],
      [],
    ]);

    const detail = await new TravelService(db).getTripDetail("user-1", "trip-1");

    expect(detail?.trip.visitedCities).toEqual(["제주특별자치도"]);
    expect(detail?.visits).toHaveLength(1);
    expect(detail?.spending.total).toBe(40_000);
    expect(detail?.transport.totalDistanceMeters).toBe(500_000);
    expect(detail?.routine).toEqual({
      codingSeconds: 600,
      commitCount: 1,
      comparison: {
        codingSeconds: 3600,
        commitCount: 1,
        codingPercentChange: -83,
        commitPercentChange: 0,
      },
    });
    expect(detail?.health).toEqual([]);
    expect(whereCalls).toHaveLength(8);
  });

  it("returns null before subordinate queries when the trip is missing or belongs to another user", async () => {
    const { db, whereCalls } = createQueuedDb([[]]);

    await expect(new TravelService(db).getTripDetail("user-1", "other-trip")).resolves.toBeNull();
    expect(whereCalls).toHaveLength(1);
  });
});

describe("TravelService.listTrips", () => {
  it("returns a recent page with additive card metrics and a stable next cursor", async () => {
    const base = {
      userId: "user-1",
      name: "여행",
      totalDistanceMeters: null,
      visitedCities: null,
      visitedCountries: null,
      isOverseas: false,
      autoDetected: true,
      notes: null,
      createdAt: new Date("2026-07-20T00:00:00Z"),
      updatedAt: new Date("2026-07-20T00:00:00Z"),
      visitCount: 3,
      totalSpending: 100_000,
    };
    const { db, selectedFields } = createQueuedDb([
      [{ tossMyName: null }],
      [
        { ...base, id: "trip-3", startDate: "2026-07-15", endDate: "2026-07-18" },
        { ...base, id: "trip-2", startDate: "2026-06-10", endDate: "2026-06-12" },
        { ...base, id: "trip-1", startDate: "2026-05-01", endDate: "2026-05-02" },
      ],
    ]);

    const result = await new TravelService(db).listTrips("user-1", { limit: 2, cursor: null });

    expect(result.trips.map((trip) => trip.id)).toEqual(["trip-3", "trip-2"]);
    expect(result.trips[0]).toMatchObject({ totalSpending: 100_000, visitCount: 3 });
    const listFields = selectedFields[1] as { totalSpending: SQL.Aliased<number> };
    const spendingSql = drizzle
      .mock()
      .select({ totalSpending: listFields.totalSpending })
      .from(trips)
      .toSQL().sql;
    expect(spendingSql).toContain('"account_roles"."user_id" = "transactions"."user_id"');
    expect(spendingSql).toContain('"account_roles"."account_name" = "transactions"."account_name"');
    expect(spendingSql).toContain('WHERE "transactions"."user_id" =');
    expect(decodeTripCursor(result.nextCursor ?? "")).toEqual({
      endDate: "2026-06-12",
      startDate: "2026-06-10",
      id: "trip-2",
    });
  });
});
