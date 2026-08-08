process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  type MapMatchingAdapter,
  type MatchPoint,
  ValhallaUnreachableError,
} from "@/lib/adapters/map-matching/valhalla";
import { logger } from "@/lib/logger";
import {
  buildRowForSegment,
  currentTileVersion,
  MIN_POINTS_TO_MATCH,
  matchRoutesForDay,
  summarizeRouteMatches,
} from "./matcher";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return { ...actual, getDb: mocks.getDb };
});

const NOW = new Date("2026-08-07T03:00:00.000Z");
const TILE_VERSION = "2026-08-07-testfingerprint";

function segment(mode: string) {
  return {
    id: `segment-${mode}`,
    userId: "user-1",
    mode,
    startTime: new Date("2026-08-07T00:00:00.000Z"),
    endTime: new Date("2026-08-07T00:10:00.000Z"),
  };
}

function point(timestamp = new Date("2026-08-07T00:00:00.000Z")): MatchPoint {
  return { lat: 37.5, lon: 127, timestamp };
}

function adapter(): MapMatchingAdapter {
  return {
    match: vi.fn().mockResolvedValue({
      status: "matched",
      shape: [[37.5, 127, NOW.getTime()]],
      roadNames: ["테스트로"],
      roadClasses: ["residential"],
      confidence: 0.9,
    }),
  };
}

function createQueryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are promise-like.
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  builder.from.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  return builder;
}

function databaseCapturingPointJoin() {
  const dialect = new PgDialect();
  let pointJoinSql: { sql: string; params: unknown[] } | null = null;
  const segmentBuilder = createQueryBuilder([segment("cycling")]);
  const pointsBuilder = createQueryBuilder([]);
  pointsBuilder.leftJoin.mockImplementation((_table, condition: SQL) => {
    const query = dialect.sqlToQuery(condition);
    pointJoinSql = { sql: query.sql, params: query.params as unknown[] };
    return pointsBuilder;
  });

  const tx = {
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  };
  const db = {
    select: vi.fn().mockReturnValueOnce(segmentBuilder).mockReturnValueOnce(pointsBuilder),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)
    ),
  };

  return { db, getPointJoinSql: () => pointJoinSql };
}

describe("buildRowForSegment", () => {
  it("writes subway as not_applicable without loading points or calling the adapter", async () => {
    const loadPoints = vi.fn<() => Promise<MatchPoint[]>>();
    const matcher = adapter();

    const row = await buildRowForSegment(segment("subway"), loadPoints, matcher, TILE_VERSION, NOW);

    expect(row).toMatchObject({
      matchStatus: "not_applicable",
      shape: null,
      costing: null,
    });
    expect(loadPoints).not.toHaveBeenCalled();
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("skips stationary segments without loading points or calling the adapter", async () => {
    const loadPoints = vi.fn<() => Promise<MatchPoint[]>>();
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("stationary"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(row).toBeNull();
    expect(loadPoints).not.toHaveBeenCalled();
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("matches cycling with bicycle costing and persists the costing", async () => {
    const points = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];
    const loadPoints = vi.fn().mockResolvedValue(points);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(matcher.match).toHaveBeenCalledWith(points, "bicycle");
    expect(row).toMatchObject({ matchStatus: "matched", costing: "bicycle" });
  });

  it("calls the adapter once a segment reaches the MIN_POINTS_TO_MATCH threshold", async () => {
    // Regression guard for MIN_POINTS_TO_MATCH itself: measured with the matcher's own point
    // predicate (see the constant's comment above buildRowForSegment), exactly-two-point
    // segments match 430/498 (~86%) of the time, so raising the cut above 2 would silently
    // discard hundreds of segments that match successfully today. If this ever fails because
    // MIN_POINTS_TO_MATCH moved, that trade-off needs to be made consciously, not by accident.
    expect(MIN_POINTS_TO_MATCH).toBe(2);
    const points = Array.from({ length: MIN_POINTS_TO_MATCH }, (_, i) =>
      point(new Date(NOW.getTime() + i * 1000))
    );
    const loadPoints = vi.fn().mockResolvedValue(points);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(matcher.match).toHaveBeenCalledWith(points, "bicycle");
    expect(row).toMatchObject({ matchStatus: "matched", costing: "bicycle" });
  });

  it("writes too_short without calling the adapter when the segment has no points", async () => {
    const loadPoints = vi.fn().mockResolvedValue([]);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(row).toMatchObject({ matchStatus: "too_short", costing: "bicycle" });
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("writes too_short without calling the adapter when the segment has exactly one point", async () => {
    const loadPoints = vi.fn().mockResolvedValue([point()]);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(row).toMatchObject({ matchStatus: "too_short", costing: "bicycle" });
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("turns an adapter exception into a failed row for that segment", async () => {
    const matcher: MapMatchingAdapter = {
      match: vi.fn().mockRejectedValue(new Error("Valhalla unavailable")),
    };
    // Two points — at/above MIN_POINTS_TO_MATCH — so the adapter is actually reached and this
    // test exercises the exception path rather than the too_short short-circuit above it.
    const points = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];

    await expect(
      buildRowForSegment(
        segment("driving"),
        vi.fn().mockResolvedValue(points),
        matcher,
        TILE_VERSION,
        NOW
      )
    ).resolves.toMatchObject({ matchStatus: "failed", costing: "auto" });
    expect(matcher.match).toHaveBeenCalled();
  });

  it("lets point-loader database failures abort the operation", async () => {
    await expect(
      buildRowForSegment(
        segment("driving"),
        vi.fn().mockRejectedValue(new Error("database unavailable")),
        adapter(),
        TILE_VERSION,
        NOW
      )
    ).rejects.toThrow("database unavailable");
  });

  it("lets a ValhallaUnreachableError from the adapter propagate instead of writing failed", async () => {
    const points = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];
    const matcher: MapMatchingAdapter = {
      match: vi.fn().mockRejectedValue(new ValhallaUnreachableError(new Error("ECONNREFUSED"))),
    };

    await expect(
      buildRowForSegment(
        segment("driving"),
        vi.fn().mockResolvedValue(points),
        matcher,
        TILE_VERSION,
        NOW
      )
    ).rejects.toThrow(ValhallaUnreachableError);
  });
});

describe("summarizeRouteMatches", () => {
  it("counts statuses and derives skipped segments from rows written", () => {
    expect(
      summarizeRouteMatches(
        [
          { matchStatus: "matched" },
          { matchStatus: "matched" },
          { matchStatus: "low_confidence" },
          { matchStatus: "no_road_match" },
          { matchStatus: "too_short" },
          { matchStatus: "failed" },
          { matchStatus: "not_applicable" },
        ],
        9
      )
    ).toEqual({
      segmentsConsidered: 9,
      matched: 2,
      lowConfidence: 1,
      noRoadMatch: 1,
      tooShort: 1,
      failed: 1,
      notApplicable: 1,
      skipped: 2,
      aborted: false,
    });
  });
});

describe("currentTileVersion", () => {
  it("uses the KST build date even when UTC is still on the previous day", () => {
    expect(currentTileVersion(new Date("2026-08-06T15:30:00.000Z"))).toMatch(
      /^2026-08-07-[a-f0-9]{12}$/
    );
  });
});

describe("matchRoutesForDay", () => {
  it("loads only non-anomalous, accurate points for route matching", async () => {
    const { db, getPointJoinSql } = databaseCapturingPointJoin();
    mocks.getDb.mockReturnValue(db);

    await matchRoutesForDay("user-1", "2026-08-07", { adapter: adapter(), now: NOW });

    const pointJoin = getPointJoinSql();
    expect(pointJoin).not.toBeNull();
    expect(pointJoin?.sql).toContain('"location_points"."accuracy" is null');
    expect(pointJoin?.sql).toContain('"location_points"."accuracy" <=');
    expect(pointJoin?.sql).toContain('"location_points"."anomaly" is null');
    expect(pointJoin?.sql).toContain('"location_points"."anomaly" =');
    expect(pointJoin?.params).toContain(200);
    expect(pointJoin?.params).toContain(false);
  });

  it("logs only once and returns zero results when VALHALLA_URL is unset", async () => {
    vi.stubEnv("VALHALLA_URL", "");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const first = await matchRoutesForDay("user-1", "2026-08-07");
    const second = await matchRoutesForDay("user-1", "2026-08-08");

    expect(first).toEqual({
      segmentsConsidered: 0,
      matched: 0,
      lowConfidence: 0,
      noRoadMatch: 0,
      tooShort: 0,
      failed: 0,
      notApplicable: 0,
      skipped: 0,
      aborted: false,
    });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("writes nothing and reports aborted when Valhalla is unreachable, even after an earlier segment in the same day already matched", async () => {
    const first = segment("driving");
    const second = { ...segment("driving"), id: "segment-driving-2" };
    const segmentBuilder = createQueryBuilder([first, second]);

    const firstPoints = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];
    const secondPoints = [
      point(new Date("2026-08-07T00:02:00.000Z")),
      point(new Date("2026-08-07T00:03:00.000Z")),
    ];
    const pointRows = [
      ...firstPoints.map((p) => ({ segmentId: first.id, ...p })),
      ...secondPoints.map((p) => ({ segmentId: second.id, ...p })),
    ];
    const pointsBuilder = createQueryBuilder(pointRows);

    const tx = {
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    const transaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    const db = {
      select: vi.fn().mockReturnValueOnce(segmentBuilder).mockReturnValueOnce(pointsBuilder),
      transaction,
    };
    mocks.getDb.mockReturnValue(db);

    // First segment matches normally; the second hits an unreachable engine. The abort must
    // still discard the first segment's already-built row — nothing gets written for the day.
    let calls = 0;
    const matcher: MapMatchingAdapter = {
      match: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: "matched",
            shape: [[37.5, 127, NOW.getTime()]],
            roadNames: [],
            roadClasses: [],
            confidence: 0.9,
          };
        }
        throw new ValhallaUnreachableError(new Error("ECONNREFUSED"));
      }),
    };

    const summary = await matchRoutesForDay("user-1", "2026-08-07", { adapter: matcher, now: NOW });

    expect(summary.aborted).toBe(true);
    expect(summary.segmentsConsidered).toBe(2);
    expect(summary.matched).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("distinguishes nothing-to-do from Valhalla-unreachable in the returned summary", async () => {
    // Nothing to do: a day with zero road-mode segments.
    const emptyDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(createQueryBuilder([]))
        .mockReturnValueOnce(createQueryBuilder([])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
        })
      ),
    };
    mocks.getDb.mockReturnValue(emptyDb);
    const nothingToDo = await matchRoutesForDay("user-1", "2026-08-07", {
      adapter: adapter(),
      now: NOW,
    });
    expect(nothingToDo).toMatchObject({ segmentsConsidered: 0, aborted: false });

    // Gave up: Valhalla unreachable on the one segment that day has. Needs real points on the
    // segment (unlike databaseCapturingPointJoin's empty points builder) or the segment resolves
    // too_short without ever calling the adapter, and the unreachable path never exercises.
    const onlySegment = segment("driving");
    const withPoints = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];
    const unreachableDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(createQueryBuilder([onlySegment]))
        .mockReturnValueOnce(
          createQueryBuilder(withPoints.map((p) => ({ segmentId: onlySegment.id, ...p })))
        ),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
        })
      ),
    };
    mocks.getDb.mockReturnValue(unreachableDb);
    const matcher: MapMatchingAdapter = {
      match: vi.fn().mockRejectedValue(new ValhallaUnreachableError(new Error("ECONNREFUSED"))),
    };
    const gaveUp = await matchRoutesForDay("user-1", "2026-08-07", { adapter: matcher, now: NOW });
    expect(gaveUp).toMatchObject({ segmentsConsidered: 1, aborted: true });
    expect(unreachableDb.transaction).not.toHaveBeenCalled();

    // The two must not be the same shape — that's the entire point of the flag.
    expect(nothingToDo.aborted).not.toBe(gaveUp.aborted);
  });
});
