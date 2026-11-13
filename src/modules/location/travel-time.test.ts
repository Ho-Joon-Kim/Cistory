import { describe, expect, it } from "vitest";
import {
  deriveJourneys,
  isInHourWindow,
  type Journey,
  kstHour,
  NO_RECORDS_MESSAGE,
  quantileR7,
  summarizeByMode,
  type TrackRow,
  type VisitRow,
  visitMatchesEndpoint,
} from "./travel-time";

const HOME = { lat: 37.5, lon: 127.0 };
const GANGNAM = { lat: 37.4979, lon: 127.0276 };

const at = (iso: string) => new Date(iso);
const visit = (
  where: { lat: number; lon: number },
  start: string,
  end: string,
  savedPlaceId: string | null = null
): VisitRow => ({
  centerLat: where.lat,
  centerLon: where.lon,
  startTime: at(start),
  endTime: at(end),
  savedPlaceId,
});

let seq = 0;
function journey(mode: string, minutes: number, start = "2026-11-02T08:00:00+09:00"): Journey {
  const startTime = at(start);
  return {
    trackId: `t${seq++}`,
    startTime,
    endTime: new Date(startTime.getTime() + minutes * 60_000),
    durationSeconds: minutes * 60,
    mode,
    origin: visit(HOME, "2026-11-01T22:00:00+09:00", start),
    destination: visit(GANGNAM, start, start),
  };
}

describe("quantileR7", () => {
  it("F1: 30/35/38/40/47 → median 38, p80 41.4", () => {
    const sorted = [30, 35, 38, 40, 47];
    expect(quantileR7(sorted, 0.5)).toBe(38);
    expect(quantileR7(sorted, 0.8)).toBeCloseTo(41.4, 10);
  });

  it("handles one value and empty input", () => {
    expect(quantileR7([12], 0.8)).toBe(12);
    expect(quantileR7([], 0.5)).toBeNull();
  });
});

describe("isInHourWindow / kstHour", () => {
  it("plain window is start-inclusive, end-exclusive", () => {
    const w = { fromHour: 7, toHour: 9 };
    expect(isInHourWindow(7, w)).toBe(true);
    expect(isInHourWindow(8, w)).toBe(true);
    expect(isInHourWindow(9, w)).toBe(false);
  });

  it("22–3 wraps past midnight", () => {
    const w = { fromHour: 22, toHour: 3 };
    for (const h of [22, 23, 0, 1, 2]) expect(isInHourWindow(h, w)).toBe(true);
    for (const h of [3, 12, 21]) expect(isInHourWindow(h, w)).toBe(false);
  });

  it("reads the KST hour regardless of the instant's written offset", () => {
    expect(kstHour(at("2026-11-02T23:30:00Z"))).toBe(8);
    expect(kstHour(at("2026-11-02T23:30:00+09:00"))).toBe(23);
    expect(kstHour(at("2026-11-02T15:10:00Z"))).toBe(0);
  });
});

describe("deriveJourneys", () => {
  const track = (id: string, start: string, end: string): TrackRow => ({
    id,
    startTime: at(start),
    endTime: at(end),
    durationSeconds: (at(end).getTime() - at(start).getTime()) / 1000,
    dominantMode: "train",
  });

  it("takes the visit ending just before the start and the one starting just after the end", () => {
    const visits = [
      visit(HOME, "2026-11-01T22:00:00+09:00", "2026-11-02T07:58:00+09:00"),
      visit(GANGNAM, "2026-11-02T08:42:00+09:00", "2026-11-02T18:00:00+09:00"),
      visit({ lat: 37.6, lon: 127.1 }, "2026-11-02T19:00:00+09:00", "2026-11-02T20:00:00+09:00"),
    ];
    const { journeys, unmatched } = deriveJourneys(
      [track("a", "2026-11-02T08:00:00+09:00", "2026-11-02T08:40:00+09:00")],
      visits
    );
    expect(unmatched).toBe(0);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].origin.centerLat).toBe(HOME.lat);
    expect(journeys[0].destination.centerLat).toBe(GANGNAM.lat);
  });

  it("excludes a track with no adjacent visit on either side", () => {
    const visits = [visit(HOME, "2026-11-01T22:00:00+09:00", "2026-11-02T07:58:00+09:00")];
    const { journeys, unmatched } = deriveJourneys(
      [track("a", "2026-11-02T08:00:00+09:00", "2026-11-02T08:40:00+09:00")],
      visits
    );
    expect(journeys).toHaveLength(0);
    expect(unmatched).toBe(1);
  });

  it("rejects neighbours outside the tolerance", () => {
    const visits = [
      visit(HOME, "2026-11-01T22:00:00+09:00", "2026-11-02T07:00:00+09:00"),
      visit(GANGNAM, "2026-11-02T08:42:00+09:00", "2026-11-02T18:00:00+09:00"),
    ];
    const { unmatched } = deriveJourneys(
      [track("a", "2026-11-02T08:00:00+09:00", "2026-11-02T08:40:00+09:00")],
      visits,
      900
    );
    expect(unmatched).toBe(1);
  });
});

describe("visitMatchesEndpoint", () => {
  it("matches by radius or by pinned saved place", () => {
    const endpoint = { lat: HOME.lat, lon: HOME.lon, radiusM: 300, savedPlaceId: "p1", name: "집" };
    expect(visitMatchesEndpoint(visit({ lat: 37.501, lon: 127.0 }, "x", "x"), endpoint)).toBe(true);
    expect(visitMatchesEndpoint(visit({ lat: 37.51, lon: 127.0 }, "x", "x"), endpoint)).toBe(false);
    expect(visitMatchesEndpoint(visit({ lat: 37.51, lon: 127.0 }, "x", "x", "p1"), endpoint)).toBe(
      true
    );
  });
});

describe("summarizeByMode", () => {
  it("F1: five subway journeys give median 38 and p80 41.4", () => {
    const modes = summarizeByMode([30, 35, 38, 40, 47].map((m) => journey("train", m)));
    const train = modes.find((m) => m.mode === "train");
    expect(train).toMatchObject({
      count: 5,
      status: "ok",
      medianMinutes: 38,
      p80Minutes: 41.4,
      minMinutes: 30,
      maxMinutes: 47,
      durationsMinutes: null,
    });
  });

  it("AE4: subway 40, walking 0 → subway stats and walking '기록 없음'", () => {
    const list = Array.from({ length: 40 }, (_, i) => journey("train", 30 + (i % 10)));
    const linesByTrack = new Map(
      list.map((j, i) => [
        j.trackId,
        i < 30
          ? [{ lineId: "l2", ref: "2", name: "2호선" }]
          : [{ lineId: "l9", ref: "9", name: "9호선" }],
      ])
    );
    const modes = summarizeByMode(list, { linesByTrack });
    expect(modes[0].mode).toBe("train");
    expect(modes[0].count).toBe(40);
    expect(modes[0].status).toBe("ok");
    expect(modes[0].mainLines.map((l) => [l.ref, l.journeys])).toEqual([
      ["2", 30],
      ["9", 10],
    ]);
    const walking = modes.find((m) => m.mode === "walking");
    expect(walking).toMatchObject({
      count: 0,
      status: "no_records",
      message: NO_RECORDS_MESSAGE,
      medianMinutes: null,
      p80Minutes: null,
      durationsMinutes: null,
    });
  });

  it("under the minimum sample count lists raw durations only, newest first", () => {
    const modes = summarizeByMode([
      journey("walking", 20, "2026-11-01T08:00:00+09:00"),
      journey("walking", 25, "2026-11-03T08:00:00+09:00"),
    ]);
    const walking = modes.find((m) => m.mode === "walking");
    expect(walking).toMatchObject({
      count: 2,
      status: "few_samples",
      medianMinutes: null,
      p80Minutes: null,
      durationsMinutes: [25, 20],
    });
  });

  it("zero journeys → every base mode is '기록 없음', nothing estimated", () => {
    const modes = summarizeByMode([]);
    expect(modes.length).toBeGreaterThan(0);
    for (const m of modes) {
      expect(m.status).toBe("no_records");
      expect(m.medianMinutes).toBeNull();
    }
  });

  it("counts a line once per journey even with several legs on it", () => {
    const j = journey("train", 30);
    const modes = summarizeByMode([j], {
      linesByTrack: new Map([
        [
          j.trackId,
          [
            { lineId: "l2", ref: "2", name: "2호선" },
            { lineId: "l2", ref: "2", name: "2호선" },
          ],
        ],
      ]),
    });
    expect(modes[0].mainLines).toEqual([{ lineId: "l2", ref: "2", name: "2호선", journeys: 1 }]);
  });
});
