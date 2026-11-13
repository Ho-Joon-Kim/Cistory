import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASK } from "../serialize";
import { savedPlacesTool, tripDetailTool, tripsTool } from "./places-trips";
import { callTool, TEST_USER_ID } from "./test-context";

const mocks = vi.hoisted(() => ({
  listSavedPlaces: vi.fn(),
  listTrips: vi.fn(),
  getTripDetail: vi.fn(),
  loadTransferEvidence: vi.fn(),
}));
vi.mock("@/modules/location/saved-places", () => ({ listSavedPlaces: mocks.listSavedPlaces }));
vi.mock("@/modules/travel/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/travel/service")>();
  return {
    ...actual,
    TravelService: class {
      listTrips = mocks.listTrips;
      getTripDetail = mocks.getTripDetail;
    },
  };
});
vi.mock("./data", () => ({ loadTransferEvidence: mocks.loadTransferEvidence }));

const TRIP_ID = "55555555-5555-4555-8555-555555555555";
const trip = {
  id: TRIP_ID,
  userId: TEST_USER_ID,
  name: "부산 여행",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  totalDistanceMeters: 1000,
  visitedCities: ["부산"],
  visitedCountries: ["대한민국"],
  isOverseas: false,
  autoDetected: true,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  mocks.loadTransferEvidence.mockResolvedValue(
    new Map([
      [
        "tx-card",
        { rawTitle: "9,000원 결제", rawText: "체크카드 | 돼지국밥", isSelfTransfer: false },
      ],
      [
        "tx-gift",
        { rawTitle: "김철수님이 30,000원을 보냈어요", rawText: "", isSelfTransfer: false },
      ],
    ])
  );
});

describe("saved_places", () => {
  it("lists places with the display address and no owner id", async () => {
    mocks.listSavedPlaces.mockResolvedValue([
      {
        id: "p1",
        userId: TEST_USER_ID,
        name: "집",
        lat: 37,
        lon: 127,
        radiusM: 100,
        category: "home",
        address: "Romanized",
        displayAddress: "서울 강남구",
        excludeFromTrips: true,
        tripExclusionRadiusM: null,
        createdAt: new Date(),
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    const out = await callTool(savedPlacesTool, {});
    const [place] = out.structured.places as Record<string, unknown>[];
    expect(place).toMatchObject({
      name: "집",
      address: "서울 강남구",
      updatedAt: "2026-11-01T09:00:00+09:00",
    });
    expect(place).not.toHaveProperty("userId");
  });
});

describe("trips", () => {
  it("caps the page at 50 and rejects a bad cursor", async () => {
    expect(tripsTool.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    await expect(callTool(tripsTool, { cursor: "x" })).rejects.toThrow(/cursor/);
    mocks.listTrips.mockResolvedValue({
      trips: [{ ...trip, totalSpending: 5, visitCount: 2, anchorPlaceName: null }],
      nextCursor: null,
    });
    const out = await callTool(tripsTool, {});
    expect(mocks.listTrips).toHaveBeenCalledWith(TEST_USER_ID, { limit: 20, cursor: null });
    expect((out.structured.trips as Record<string, unknown>[])[0]).not.toHaveProperty("userId");
  });
});

describe("trip_detail", () => {
  it("masks transfer counterparties and accounts, and drops rhythm health metrics", async () => {
    mocks.getTripDetail.mockResolvedValue({
      trip,
      visits: [],
      spending: {
        total: 39000,
        dailyAverage: 13000,
        categories: [],
        transactions: [
          {
            id: "tx-card",
            amount: 9000,
            merchant: "돼지국밥",
            accountName: "체크카드",
            category: "food",
            transactedAt: new Date(),
          },
          {
            id: "tx-gift",
            amount: 30000,
            merchant: "김철수",
            accountName: "토스",
            category: null,
            transactedAt: new Date(),
          },
        ],
      },
      transport: { totalDistanceMeters: 0, modes: [] },
      routine: { codingSeconds: 0, commitCount: 0, comparison: null },
      health: [
        {
          day: "2026-10-01",
          metric: "steps",
          valueAvg: 1,
          valueMin: 1,
          valueMax: 1,
          valueSum: 1,
          count: 1,
        },
        {
          day: "2026-10-01",
          metric: "ecg",
          valueAvg: 70,
          valueMin: 1,
          valueMax: 1,
          valueSum: 1,
          count: 1,
        },
      ],
      spendingSince: "2025-01-01",
    });
    const out = await callTool(tripDetailTool, { tripId: TRIP_ID });
    const spending = out.structured.spending as { transactions: Record<string, unknown>[] };
    expect(spending.transactions[0].merchant).toBe("돼지국밥");
    expect(spending.transactions[1].merchant).toBe(MASK);
    expect(spending.transactions.every((t) => t.accountName === MASK)).toBe(true);
    expect((out.structured.health as { metric: string }[]).map((h) => h.metric)).toEqual(["steps"]);
    expect(JSON.stringify(out.structured)).not.toContain("김철수");
  });

  it("reports a missing trip in Korean", async () => {
    mocks.getTripDetail.mockResolvedValue(null);
    await expect(callTool(tripDetailTool, { tripId: TRIP_ID })).rejects.toThrow(
      "여행을 찾을 수 없습니다."
    );
  });
});
