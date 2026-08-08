process.env.TZ = "Asia/Seoul";

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  subwayLines,
  subwayStations,
  subwaySystems,
  subwayTripMatches,
  transportationSegments,
} from "@/db";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { getSubwayInsights } from "./usage";

/**
 * Executes `getSubwayInsights` against a real Postgres and pins the two
 * defects that shipped past `usage.test.ts`'s 9 tests, per that file's own
 * header: swapped `l1`/`l2` aliases reversing every reported transfer
 * direction, and a dropped `user_id` filter leaking another user's rows into
 * the result. Neither is reachable without the query actually running —
 * `usage.test.ts` renders the SQL text and pins it structurally, but text
 * matching a correct-looking template can't tell "l1.ref AS from_ref" from
 * "l2.ref AS from_ref" apart in terms of what a real join produces.
 *
 * Run via `yarn test:integration` — needs Docker. `yarn test` never touches
 * this file.
 */
describe("getSubwayInsights transferPairs against real Postgres", () => {
  const ctx = useTransactionalDb();

  /** One subway system + two named lines + three named stations. */
  async function seedSystemWithTwoLines() {
    const db = ctx.db();
    const systemId = randomUUID();
    await db.insert(subwaySystems).values({
      id: systemId,
      cityKey: `test-city-${systemId.slice(0, 8)}`,
      cityName: "Test City",
      countryCode: "KR",
    });

    const [lineOne] = await db
      .insert(subwayLines)
      .values({ systemId, osmRelationId: randomInt31(), ref: "1", name: "Line One" })
      .returning({ id: subwayLines.id });
    const [lineTwo] = await db
      .insert(subwayLines)
      .values({ systemId, osmRelationId: randomInt31(), ref: "2", name: "Line Two" })
      .returning({ id: subwayLines.id });

    const stationNames = ["Start Station", "Transfer Station", "End Station"] as const;
    const stationIds: Record<(typeof stationNames)[number], string> = {} as never;
    for (const name of stationNames) {
      const [station] = await db
        .insert(subwayStations)
        .values({ systemId, osmNodeId: randomInt31(), name })
        .returning({ id: subwayStations.id });
      stationIds[name] = station.id;
    }

    return { lineOneId: lineOne.id, lineTwoId: lineTwo.id, stationIds };
  }

  /**
   * A two-leg session for `userId`: leg 1 rides `fromLineId` from
   * "Start Station" to "Transfer Station", leg 2 rides `toLineId` onward to
   * "End Station" — the exact adjacency shape `pairsRes` reports on.
   */
  async function seedTwoLegSession(params: {
    userId: string;
    fromLineId: string;
    toLineId: string;
    stationIds: Record<string, string>;
    startAt: Date;
  }) {
    const db = ctx.db();
    const { userId, fromLineId, toLineId, stationIds, startAt } = params;
    const sessionId = randomUUID();
    const leg1End = new Date(startAt.getTime() + 10 * 60_000);
    const leg2Start = new Date(startAt.getTime() + 12 * 60_000);
    const leg2End = new Date(startAt.getTime() + 20 * 60_000);

    const scores = {
      coverageRatio: 1,
      speedProfileScore: 1,
      gapScore: 1,
      stationScore: 1,
      totalConfidence: 1,
    };

    for (const [legOrder, leg] of [
      {
        lineId: fromLineId,
        start: startAt,
        end: leg1End,
        startStationId: stationIds["Start Station"],
        endStationId: stationIds["Transfer Station"],
      },
      {
        lineId: toLineId,
        start: leg2Start,
        end: leg2End,
        startStationId: stationIds["Transfer Station"],
        endStationId: stationIds["End Station"],
      },
    ].entries()) {
      const [segment] = await db
        .insert(transportationSegments)
        .values({
          userId,
          date: "2026-08-08",
          mode: "train",
          confidence: "high",
          startTime: leg.start,
          endTime: leg.end,
          distanceMeters: 1000,
          durationSeconds: (leg.end.getTime() - leg.start.getTime()) / 1000,
          calculatedAt: new Date(),
        })
        .returning({ id: transportationSegments.id });

      await db.insert(subwayTripMatches).values({
        userId,
        transportationSegmentId: segment.id,
        lineId: leg.lineId,
        sessionId,
        legOrder: legOrder + 1,
        subStartTime: leg.start,
        subEndTime: leg.end,
        startStationId: leg.startStationId,
        endStationId: leg.endStationId,
        ...scores,
      });
    }

    return sessionId;
  }

  it("reports the transfer pair in the direction the legs actually ran — the l1/l2 swap this file exists to catch", async () => {
    const db = ctx.db();
    const { lineOneId, lineTwoId, stationIds } = await seedSystemWithTwoLines();
    const userId = await insertTestUser(db);
    const startAt = new Date("2026-08-08T01:00:00.000Z");
    await seedTwoLegSession({
      userId,
      fromLineId: lineOneId,
      toLineId: lineTwoId,
      stationIds,
      startAt,
    });

    const result = await getSubwayInsights(
      userId,
      new Date("2026-08-08T00:00:00.000Z"),
      new Date("2026-08-09T00:00:00.000Z"),
      db
    );

    expect(result.transferPairs).toHaveLength(1);
    const [pair] = result.transferPairs;
    // Direction matters: leg 1 rode Line One, leg 2 rode Line Two. A swapped
    // l1/l2 in the SELECT list reports this backwards without changing row
    // count or the station name, which is exactly why usage.test.ts's
    // structural checks never caught it.
    expect(pair.fromLineRef).toBe("1");
    expect(pair.fromLineName).toBe("Line One");
    expect(pair.toLineRef).toBe("2");
    expect(pair.toLineName).toBe("Line Two");
    expect(pair.stationName).toBe("Transfer Station");
    expect(pair.count).toBe(1);
  });

  it("never reports another user's transfer pair — the dropped user_id filter this file exists to catch", async () => {
    const db = ctx.db();
    const { lineOneId, lineTwoId, stationIds } = await seedSystemWithTwoLines();
    // A second, entirely independent system/lines/stations for user B, so a
    // leaked row is unmistakable: it carries names user A's fixtures never
    // produce.
    const otherSystemId = randomUUID();
    await db.insert(subwaySystems).values({
      id: otherSystemId,
      cityKey: `other-city-${otherSystemId.slice(0, 8)}`,
      cityName: "Other City",
      countryCode: "KR",
    });
    const [otherLineOne] = await db
      .insert(subwayLines)
      .values({
        systemId: otherSystemId,
        osmRelationId: randomInt31(),
        ref: "9",
        name: "Other Line One",
      })
      .returning({ id: subwayLines.id });
    const [otherLineTwo] = await db
      .insert(subwayLines)
      .values({
        systemId: otherSystemId,
        osmRelationId: randomInt31(),
        ref: "8",
        name: "Other Line Two",
      })
      .returning({ id: subwayLines.id });
    const otherStationIds: Record<string, string> = {};
    for (const name of ["Start Station", "Transfer Station", "End Station"]) {
      const [station] = await db
        .insert(subwayStations)
        .values({ systemId: otherSystemId, osmNodeId: randomInt31(), name: `Other ${name}` })
        .returning({ id: subwayStations.id });
      otherStationIds[name] = station.id;
    }

    const userA = await insertTestUser(db);
    const userB = await insertTestUser(db);
    const startAt = new Date("2026-08-08T01:00:00.000Z");

    await seedTwoLegSession({
      userId: userA,
      fromLineId: lineOneId,
      toLineId: lineTwoId,
      stationIds,
      startAt,
    });
    await seedTwoLegSession({
      userId: userB,
      fromLineId: otherLineOne.id,
      toLineId: otherLineTwo.id,
      stationIds: {
        "Start Station": otherStationIds["Start Station"],
        "Transfer Station": otherStationIds["Transfer Station"],
        "End Station": otherStationIds["End Station"],
      },
      startAt,
    });

    const resultForA = await getSubwayInsights(
      userA,
      new Date("2026-08-08T00:00:00.000Z"),
      new Date("2026-08-09T00:00:00.000Z"),
      db
    );

    expect(resultForA.transferPairs).toHaveLength(1);
    expect(resultForA.transferPairs[0].stationName).toBe("Transfer Station");
    expect(resultForA.transferPairs.some((p) => p.stationName === "Other Transfer Station")).toBe(
      false
    );
    expect(resultForA.totalSessions).toBe(1);
    expect(resultForA.totalLegs).toBe(2);
  });
});

/** OSM ids are bigint-backed but small test values are fine as int32. */
function randomInt31(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}
