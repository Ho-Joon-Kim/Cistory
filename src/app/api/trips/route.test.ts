import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
  listTrips: vi.fn(),
  getListSummary: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("@/modules/travel/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/travel/service")>();
  return {
    ...actual,
    TravelService: class {
      listTrips = mocks.listTrips;
      getListSummary = mocks.getListSummary;
    },
  };
});
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { createMockDb } from "@/db/testing/mock-db";
import { GET, POST } from "./route";

function request(query = "") {
  return new NextRequest(`http://localhost/api/trips${query}`);
}

function createYearDb(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are promise-like.
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  return { select: vi.fn(() => builder) };
}

describe("GET /api/trips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
    mocks.listTrips.mockResolvedValue({ trips: [], nextCursor: null });
  });

  it("preserves the legacy year response and ascending query path", async () => {
    mocks.getDb.mockReturnValue(
      createYearDb([
        {
          id: "trip-1",
          startDate: "2026-01-01",
          visitedCities: '["부산"]',
          visitedCountries: '["대한민국"]',
        },
      ])
    );

    const response = await GET(request("?year=2026"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trips[0].visitedCities).toEqual(["부산"]);
    expect(body.trips[0].visitedCountries).toEqual(["대한민국"]);
    expect(mocks.listTrips).not.toHaveBeenCalled();
  });

  it("lists recent trips with the default limit when year is absent", async () => {
    mocks.getDb.mockReturnValue({});
    mocks.listTrips.mockResolvedValue({ trips: [{ id: "trip-1" }], nextCursor: "next" });

    const response = await GET(request());
    const body = await response.json();

    expect(mocks.listTrips).toHaveBeenCalledWith("user-1", { limit: 20, cursor: null });
    expect(body).toEqual({ trips: [{ id: "trip-1" }], nextCursor: "next" });
  });

  it("adds the current-year summary only when summary=1 is requested", async () => {
    mocks.getDb.mockReturnValue({});
    mocks.listTrips.mockResolvedValue({ trips: [{ id: "trip-1" }], nextCursor: null });
    mocks.getListSummary.mockResolvedValue({
      year: 2026,
      trips: [{ id: "trip-1" }],
      spendingSince: "2026-03-03",
    });

    const response = await GET(request("?summary=1"));
    const body = await response.json();

    expect(mocks.getListSummary).toHaveBeenCalledWith("user-1", expect.any(Number));
    expect(body.summary).toEqual({
      year: 2026,
      trips: [{ id: "trip-1" }],
      spendingSince: "2026-03-03",
    });
    expect(body.trips).toEqual([{ id: "trip-1" }]);

    await GET(request());
    expect(mocks.getListSummary).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed cursor", async () => {
    mocks.getDb.mockReturnValue({});

    const response = await GET(request("?cursor=broken"));

    expect(response.status).toBe(400);
    expect(mocks.listTrips).not.toHaveBeenCalled();
  });

  it("returns 401 before querying", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: new Response("unauthorized", { status: 401 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe("POST /api/trips", () => {
  beforeEach(() => {
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  function post(body: unknown) {
    return POST(
      new NextRequest("http://localhost/api/trips", { method: "POST", body: JSON.stringify(body) })
    );
  }

  it("creates a manual trip under the write lock and returns 201", async () => {
    // advisory lock, insert
    const fake = createMockDb([[], [{ id: "trip-new", name: "제주" }]]);
    mocks.getDb.mockReturnValue(fake.db);

    const response = await post({ name: "제주", startDate: "2026-11-01", endDate: "2026-11-03" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ trip: { id: "trip-new", name: "제주" } });
    expect(fake.calls[0].op).toBe("execute");
    expect(fake.writes("values")[0]).toMatchObject({
      userId: "user-1",
      name: "제주",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      notes: null,
      isOverseas: false,
      autoDetected: false,
    });
  });

  it("requires name, startDate and endDate", async () => {
    mocks.getDb.mockReturnValue(createMockDb().db);
    expect((await post({ name: "제주" })).status).toBe(400);
  });
});
