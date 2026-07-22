import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import {
  getSampledRowNumbers,
  MAX_ROUTE_POINTS,
  simplifyRoutePoints,
} from "@/modules/travel/route-points";
import { GET } from "./route";

function context(id = "trip-1") {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new NextRequest("http://localhost/api/trips/trip-1/route-points");
}

function createDb(ownerRows: unknown[], routeRows: unknown[] = []) {
  const execute = vi.fn().mockResolvedValue({ rows: routeRows });
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are promise-like.
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(ownerRows).then(resolve),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return { db: { select: vi.fn(() => builder), execute }, execute };
}

describe("route point sampling", () => {
  it("keeps the database result at or below the cap for 84,831 raw rows", () => {
    const rows = getSampledRowNumbers(84_831, MAX_ROUTE_POINTS);

    expect(rows.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(rows[0]).toBe(1);
    expect(rows.at(-1)).toBe(84_831);
  });

  it("keeps both endpoints during minimum-distance simplification", () => {
    const rows = [
      { lat: 37.5, lon: 127, accuracy: 10, timestamp: new Date("2026-07-14T15:00:00Z") },
      { lat: 37.50001, lon: 127, accuracy: 10, timestamp: new Date("2026-07-14T16:00:00Z") },
      { lat: 37.50002, lon: 127, accuracy: 10, timestamp: new Date("2026-07-15T15:00:00Z") },
    ];

    expect(simplifyRoutePoints(rows, 100)).toEqual([rows[0], rows[2]]);
  });
});

describe("GET /api/trips/:id/route-points", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  it("returns the auth response without touching the database", async () => {
    const authError = new Response("unauthorized", { status: 401 });
    mocks.getAuthenticatedUser.mockResolvedValue({ user: null, error: authError });

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-user or missing trip without querying GPS", async () => {
    const { db, execute } = createDb([]);
    mocks.getDb.mockReturnValue(db);

    const response = await GET(request(), context("other-user-trip"));

    expect(response.status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns only the already DB-capped rows in chronological order", async () => {
    const rows = Array.from({ length: MAX_ROUTE_POINTS }, (_, index) => ({
      lat: 33 + index / 10_000,
      lon: 126,
      accuracy: 10,
      timestamp: new Date(Date.UTC(2026, 6, 14, 15, index)),
    }));
    const { db, execute } = createDb(
      [{ id: "trip-1", startDate: "2026-07-15", endDate: "2026-07-18" }],
      rows
    );
    mocks.getDb.mockReturnValue(db);

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(body.rawSampledCount).toBe(MAX_ROUTE_POINTS);
    expect(body.points.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(body.points[0].timestamp).toBe(rows[0].timestamp.toISOString());
    expect(body.points.at(-1).timestamp).toBe(rows.at(-1)?.timestamp.toISOString());
  });
});
