process.env.TZ = "Asia/Seoul";

import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locationPoints } from "@/db";
import { timestampParam } from "@/db/sql";
import { getKstDateWindow } from "@/lib/date-key";

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

function createBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are promise-like.
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  builder.from.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function createDb(ownerRows: unknown[], routeRows: unknown[] = [], segmentRows: unknown[] = []) {
  const execute = vi.fn().mockResolvedValue({ rows: routeRows });
  const ownerBuilder = createBuilder(ownerRows);
  const segmentBuilder = createBuilder(segmentRows);
  const select = vi.fn().mockReturnValueOnce(ownerBuilder).mockReturnValueOnce(segmentBuilder);
  return { db: { select, execute }, execute, segmentBuilder };
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
    const timestamps = Array.from(
      { length: MAX_ROUTE_POINTS },
      (_, index) => new Date(Date.UTC(2026, 6, 14, 15, index))
    );
    const rows = timestamps.map((timestamp, index) => ({
      lat: String(33 + index / 10_000),
      lon: "126",
      accuracy: "10",
      timestamp: timestamp.toISOString().replace("T", " ").replace(".000Z", ""),
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
    expect(body.points[0]).toMatchObject({
      lat: 33,
      lon: 126,
      accuracy: 10,
      timestamp: timestamps[0].toISOString(),
    });
    expect(body.points.at(-1)).toMatchObject({
      lat: 33 + (MAX_ROUTE_POINTS - 1) / 10_000,
      lon: 126,
      accuracy: 10,
      timestamp: timestamps.at(-1)?.toISOString(),
    });
  });

  it("binds raw SQL window bounds through the location timestamp driver", async () => {
    const trip = { id: "trip-1", startDate: "2026-07-15", endDate: "2026-07-18" };
    const { db, execute } = createDb([trip]);
    mocks.getDb.mockReturnValue(db);

    await GET(request(), context());

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    const window = getKstDateWindow(trip.startDate, trip.endDate);
    const expectedStart = timestampParam(locationPoints.timestamp, window.start);
    const expectedEnd = timestampParam(locationPoints.timestamp, window.end);

    expect(query.params).toContain(expectedStart);
    expect(query.params).toContain(expectedEnd);
    expect(query.params).not.toContain(window.start);
    expect(query.params).not.toContain(window.end);
  });

  it("queries trip-window segment matches and merges snapped geometry with raw gaps", async () => {
    const rawRows = [
      { lat: "99", lon: "127", accuracy: "10", timestamp: "2026-07-15 00:05:00" },
      { lat: "37.15", lon: "127", accuracy: "10", timestamp: "2026-07-15 00:15:00" },
    ];
    const segmentRows = [
      {
        startTime: new Date("2026-07-15T00:00:00Z"),
        shape: [
          [37, 127, Date.parse("2026-07-15T00:00:00Z")],
          [37.1, 127, Date.parse("2026-07-15T00:10:00Z")],
        ],
      },
    ];
    const { db, segmentBuilder } = createDb(
      [{ id: "trip-1", startDate: "2026-07-15", endDate: "2026-07-18" }],
      rawRows,
      segmentRows
    );
    mocks.getDb.mockReturnValue(db);

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(segmentBuilder.leftJoin).toHaveBeenCalledTimes(1);
    expect(body.points.map((point: { lat: number }) => point.lat)).toEqual([37, 37.1, 37.15]);
    expect(body.points.map((point: { timestamp: string }) => point.timestamp)).toEqual([
      "2026-07-15T00:00:00.000Z",
      "2026-07-15T00:10:00.000Z",
      "2026-07-15T00:15:00.000Z",
    ]);
    expect(body.rawSampledCount).toBe(2);
  });

  it("keeps the assembled response bounded when stored shapes exceed the route cap", async () => {
    const shape = Array.from({ length: MAX_ROUTE_POINTS + 100 }, (_, index) => [
      37 + index / 1000,
      127,
      Date.parse("2026-07-15T00:00:00Z") + index * 1000,
    ]);
    const { db } = createDb(
      [{ id: "trip-1", startDate: "2026-07-15", endDate: "2026-07-18" }],
      [],
      [
        {
          startTime: new Date("2026-07-15T00:00:00Z"),
          shape,
        },
      ]
    );
    mocks.getDb.mockReturnValue(db);

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.points.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(body.count).toBe(body.points.length);
    expect(body.points[0].timestamp).toBe("2026-07-15T00:00:00.000Z");
    expect(body.points.at(-1).timestamp).toBe("2026-07-15T00:18:19.000Z");
  });
});
