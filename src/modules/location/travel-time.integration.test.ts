process.env.TZ = "Asia/Seoul";

import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  locationProcessingDays,
  savedPlaces,
  subwayLines,
  subwaySystems,
  subwayTripMatches,
  tracks,
  transportationSegments,
  visits,
} from "@/db";
import { insertTestUser } from "@/db/testing/fixtures";
import { type TestDb, useTransactionalDb } from "@/db/testing/transactional-db";
import { computeTravelTimes } from "./travel-time";

/**
 * Runs `computeTravelTimes` against real Postgres (TZ=Asia/Seoul container):
 *  - `tracks.start_time` is stored as UTC wall time, so a 08:00 KST departure
 *    sits in the column as 23:00 of the previous day. The KST hour window must
 *    select it at 07–09, not at 23–24 (no 9-hour shift).
 *  - Endpoints come from the adjacent persisted visits; a track without them
 *    is excluded.
 *  - Another user's rows never leak in.
 */
describe("computeTravelTimes against real Postgres", () => {
  const ctx = useTransactionalDb();

  const HOME = { lat: 37.5, lon: 127.0 };
  const OFFICE = { lat: 37.4979, lon: 127.0276 };
  const NOW = new Date("2026-11-10T12:00:00+09:00");

  async function insertVisit(
    db: TestDb,
    userId: string,
    where: { lat: number; lon: number },
    start: Date,
    end: Date,
    savedPlaceId: string | null = null
  ) {
    await db.insert(visits).values({
      userId,
      centerLat: where.lat,
      centerLon: where.lon,
      radiusM: 40,
      startTime: start,
      endTime: end,
      durationSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
      savedPlaceId,
      calculatedAt: NOW,
    });
  }

  async function insertTrack(
    db: TestDb,
    userId: string,
    start: Date,
    minutes: number,
    mode: string
  ): Promise<string> {
    const end = new Date(start.getTime() + minutes * 60_000);
    const [row] = await db
      .insert(tracks)
      .values({
        userId,
        startTime: start,
        endTime: end,
        distanceMeters: 8_000,
        durationSeconds: minutes * 60,
        pointCount: 50,
        dominantMode: mode,
        calculatedAt: NOW,
      })
      .returning({ id: tracks.id });
    return row.id;
  }

  /** Home visit ending 2 min before departure, office visit starting 2 min after arrival. */
  async function insertCommute(
    db: TestDb,
    userId: string,
    departure: Date,
    minutes: number,
    mode: string,
    homePlaceId: string | null = null
  ): Promise<string> {
    const arrival = new Date(departure.getTime() + minutes * 60_000);
    await insertVisit(
      db,
      userId,
      HOME,
      new Date(departure.getTime() - 3 * 3_600_000),
      new Date(departure.getTime() - 2 * 60_000),
      homePlaceId
    );
    await insertVisit(
      db,
      userId,
      OFFICE,
      new Date(arrival.getTime() + 2 * 60_000),
      new Date(arrival.getTime() + 60 * 60_000)
    );
    return insertTrack(db, userId, departure, minutes, mode);
  }

  const kst = (day: string, time: string) => new Date(`${day}T${time}:00+09:00`);
  const coords = (p: { lat: number; lon: number }) => ({ kind: "coordinates" as const, ...p });

  it("applies the KST departure-hour window without a 9-hour shift", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const minutes = [30, 35, 38, 40, 47];
    const trackIds: string[] = [];
    for (const [i, m] of minutes.entries()) {
      trackIds.push(await insertCommute(db, userId, kst(`2026-11-0${i + 2}`, "08:00"), m, "train"));
    }

    // The column really holds UTC wall time: 08:00 KST → 23:00 the previous day.
    const raw = await ctx
      .client()
      .query<{ s: string }>("SELECT start_time::text AS s FROM tracks WHERE id = $1", [
        trackIds[0],
      ]);
    expect(raw.rows[0].s).toBe("2026-11-01 23:00:00");

    const base = { origin: coords(HOME), destination: coords(OFFICE), now: NOW };
    const morning = await computeTravelTimes(
      userId,
      { ...base, hours: { fromHour: 7, toHour: 9 } },
      db
    );
    expect(morning.status).toBe("ok");
    const train = morning.modes.find((m) => m.mode === "train");
    expect(train).toMatchObject({ count: 5, medianMinutes: 38, p80Minutes: 41.4 });

    const utcHour = await computeTravelTimes(
      userId,
      { ...base, hours: { fromHour: 23, toHour: 24 } },
      db
    );
    expect(utcHour.status).toBe("no_records");
    expect(utcHour.totalJourneys).toBe(0);
    expect(utcHour.message).toBe("기록 없음");
  });

  it("includes late-night departures in a window that wraps past midnight", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    await insertCommute(db, userId, kst("2026-11-03", "23:40"), 35, "driving");
    await insertCommute(db, userId, kst("2026-11-05", "01:10"), 25, "driving");
    await insertCommute(db, userId, kst("2026-11-06", "12:00"), 30, "driving");

    const result = await computeTravelTimes(
      userId,
      {
        origin: coords(HOME),
        destination: coords(OFFICE),
        hours: { fromHour: 22, toHour: 3 },
        now: NOW,
      },
      db
    );
    const driving = result.modes.find((m) => m.mode === "driving");
    expect(driving).toMatchObject({ count: 2, status: "few_samples", durationsMinutes: [25, 35] });
  });

  it("derives endpoints from adjacent visits and drops tracks without them", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const [place] = await db
      .insert(savedPlaces)
      .values({
        userId,
        name: "집",
        // Deliberately far from HOME: the visit matches through its pin.
        lat: 37.6,
        lon: 127.2,
        radiusM: 100,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning({ id: savedPlaces.id });

    const withLine = await insertCommute(
      db,
      userId,
      kst("2026-11-03", "08:10"),
      40,
      "train",
      place.id
    );
    // A track with no visit next to it on either side.
    await insertTrack(db, userId, kst("2026-11-04", "15:00"), 20, "train");
    // A track whose destination is somewhere else.
    await insertVisit(db, userId, HOME, kst("2026-11-05", "06:00"), kst("2026-11-05", "07:58"));
    await insertVisit(
      db,
      userId,
      { lat: 37.56, lon: 126.97 },
      kst("2026-11-05", "08:32"),
      kst("2026-11-05", "10:00")
    );
    await insertTrack(db, userId, kst("2026-11-05", "08:00"), 30, "train");

    // A subway line ridden on the matched track.
    const systemId = randomUUID();
    await db.insert(subwaySystems).values({
      id: systemId,
      cityKey: `test-city-${systemId.slice(0, 8)}`,
      cityName: "Test City",
      countryCode: "KR",
    });
    const [line] = await db
      .insert(subwayLines)
      .values({ systemId, osmRelationId: randomInt(1, 2_147_483_647), ref: "2", name: "2호선" })
      .returning({ id: subwayLines.id });
    const [segment] = await db
      .insert(transportationSegments)
      .values({
        userId,
        trackId: withLine,
        date: "2026-11-03",
        mode: "train",
        confidence: "high",
        startTime: kst("2026-11-03", "08:15"),
        endTime: kst("2026-11-03", "08:45"),
        distanceMeters: 7_000,
        durationSeconds: 1_800,
        calculatedAt: NOW,
      })
      .returning({ id: transportationSegments.id });
    await db.insert(subwayTripMatches).values({
      userId,
      transportationSegmentId: segment.id,
      lineId: line.id,
      subStartTime: kst("2026-11-03", "08:15"),
      subEndTime: kst("2026-11-03", "08:45"),
      coverageRatio: 0.9,
      speedProfileScore: 0.9,
      gapScore: 0.9,
      stationScore: 0.9,
      totalConfidence: 0.9,
    });

    await db.insert(locationProcessingDays).values([
      { userId, date: "2026-11-08", status: "completed", pointCount: 10 },
      { userId, date: "2026-11-09", status: "failed", pointCount: null },
    ]);

    const result = await computeTravelTimes(
      userId,
      {
        origin: { kind: "saved_place", savedPlaceId: place.id },
        destination: coords(OFFICE),
        now: NOW,
      },
      db
    );
    expect(result.scannedTracks).toBe(3);
    expect(result.tracksWithoutAdjacentVisits).toBe(1);
    expect(result.totalJourneys).toBe(1);
    expect(result.dataThrough).toBe("2026-11-08");
    expect(result.origin.name).toBe("집");
    const train = result.modes.find((m) => m.mode === "train");
    expect(train).toMatchObject({ count: 1, durationsMinutes: [40] });
    expect(train?.mainLines).toEqual([{ lineId: line.id, ref: "2", name: "2호선", journeys: 1 }]);
    expect(result.modes.find((m) => m.mode === "walking")?.message).toBe("기록 없음");
  });

  it("never reads another user's journeys or saved places", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    const other = await insertTestUser(db);
    await insertCommute(db, other, kst("2026-11-03", "08:00"), 30, "train");
    const [otherPlace] = await db
      .insert(savedPlaces)
      .values({ userId: other, name: "남", lat: 1, lon: 1, createdAt: NOW, updatedAt: NOW })
      .returning({ id: savedPlaces.id });

    const result = await computeTravelTimes(
      owner,
      { origin: coords(HOME), destination: coords(OFFICE), now: NOW },
      db
    );
    expect(result.totalJourneys).toBe(0);
    expect(result.scannedTracks).toBe(0);

    await expect(
      computeTravelTimes(
        owner,
        {
          origin: { kind: "saved_place", savedPlaceId: otherPlace.id },
          destination: coords(OFFICE),
          now: NOW,
        },
        db
      )
    ).rejects.toThrow(/저장 장소를 찾을 수 없습니다/);
  });
});
