import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripRouteSketch } from "./components/TripRouteSketch";
import { type MapLabel, type RouteDay, routeByDay } from "./detail-model";
import type { TravelRoutePoint, TravelTripVisit } from "./hooks";
import { REFERENCE_CITIES } from "./reference-cities";
import {
  destinationCluster,
  extentKm,
  FOCUS_MIN_RATIO,
  legEndName,
  sketchFocus,
  toward,
} from "./sketch-focus";

/** A point at a KST wall time ("2026-03-26 08:00"). */
function pt(kst: string, lat: number, lon: number): TravelRoutePoint {
  const utc = new Date(`${kst.replace(" ", "T")}:00+09:00`).toISOString();
  return { lat, lon, accuracy: null, timestamp: utc };
}

function visit(
  id: string,
  kst: string,
  hours: number,
  lat: number,
  lon: number,
  savedPlaceName: string | null = null
): TravelTripVisit {
  const start = new Date(`${kst.replace(" ", "T")}:00+09:00`);
  return {
    id,
    centerLat: lat,
    centerLon: lon,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + hours * 3_600_000).toISOString(),
    durationSeconds: hours * 3600,
    placeName: id,
    address: null,
    category: null,
    city: null,
    countryName: null,
    savedPlaceName,
    savedPlaceCategory: null,
  };
}

/** A small loop of points around a centre over a day (local movement). */
function wander(day: string, lat: number, lon: number, km: number): TravelRoutePoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const r = km / 111.32;
    const hh = String(9 + i).padStart(2, "0");
    return pt(`${day} ${hh}:00`, lat + Math.sin(a) * r, lon + Math.cos(a) * r);
  });
}

// Hong Kong, 2026-03-26..30: fly Incheon → HK, three days around Kowloon and
// the Island, fly back to Incheon and ride home to Seoul — the trip that
// collapsed into a corner dot in production.
const HK_POINTS: TravelRoutePoint[] = [
  pt("2026-03-26 05:00", 37.4811, 126.4204),
  pt("2026-03-26 07:30", 37.4602, 126.4407),
  pt("2026-03-26 12:40", 22.308, 113.9185),
  pt("2026-03-26 13:30", 22.3167, 114.17),
  pt("2026-03-26 15:00", 22.2855, 114.1543),
  ...wander("2026-03-27", 22.29, 114.16, 2),
  ...wander("2026-03-28", 22.295, 114.17, 2.5),
  ...wander("2026-03-29", 22.3, 114.175, 0.6),
  pt("2026-03-30 08:00", 22.2982, 114.1741),
  pt("2026-03-30 10:00", 22.308, 113.9185),
  pt("2026-03-30 16:30", 37.4602, 126.4407),
  pt("2026-03-30 18:00", 37.533, 126.9036),
];
const HK_VISITS: TravelTripVisit[] = [
  visit("인천공항", "2026-03-26 05:30", 2, 37.4602, 126.4407),
  visit("호텔", "2026-03-26 16:00", 60, 22.2982, 114.1741),
  visit("침사추이", "2026-03-27 12:00", 3, 22.2975, 114.1722),
  visit("센트럴", "2026-03-28 12:00", 4, 22.2819, 114.1586),
  visit("홍콩공항", "2026-03-30 09:30", 1.5, 22.308, 113.9185),
];
const HK_LABELS: MapLabel[] = [
  { key: "gimpo", lat: 37.5618, lon: 126.8026, text: "김포공항역", kind: "station" },
];

// Gangwon road trip from Seoul: the driving around the province is the
// trip, so the whole route already fills the frame and nothing refocuses.
const GANGWON_POINTS: TravelRoutePoint[] = [
  pt("2026-08-27 09:00", 37.51, 127.03),
  pt("2026-08-27 12:00", 37.75, 128.88),
  pt("2026-08-27 18:00", 37.8, 128.9),
  ...wander("2026-08-28", 37.6, 128.6, 30),
  pt("2026-08-29 10:00", 37.38, 128.66),
  pt("2026-08-29 16:00", 37.51, 127.03),
];
const GANGWON_VISITS: TravelTripVisit[] = [
  visit("집", "2026-08-26 22:00", 10, 37.51, 127.03, "집"),
  visit("강릉 숙소", "2026-08-27 19:00", 14, 37.8, 128.9),
  visit("평창", "2026-08-28 12:00", 6, 37.37, 128.39),
  visit("정선", "2026-08-29 10:00", 3, 37.38, 128.66),
];
const GANGWON_LABELS: MapLabel[] = [
  { key: "home", lat: 37.51, lon: 127.03, text: "집", kind: "anchor" },
];

const hkDays = (): RouteDay[] => routeByDay(HK_POINTS, "2026-03-26", "2026-03-30");
const gangwonDays = (): RouteDay[] => routeByDay(GANGWON_POINTS, "2026-08-27", "2026-08-29");

function render(
  days: RouteDay[],
  labels: MapLabel[],
  focus?: { lat: number; lon: number }[] | null
) {
  return renderToStaticMarkup(
    createElement(TripRouteSketch, {
      days,
      labels,
      references: REFERENCE_CITIES,
      highlight: null,
      ariaLabel: "경로",
      ...(focus === undefined ? {} : { focus }),
    })
  );
}

describe("sketchFocus", () => {
  it("fits an overseas trip to the destination, not the flights", () => {
    const focus = sketchFocus(hkDays(), HK_VISITS, HK_LABELS);
    expect(focus).not.toBeNull();
    // Everything in the frame is Hong Kong; Incheon, Seoul and Gimpo are not.
    expect(focus?.every((p) => p.lat < 23 && p.lon < 115)).toBe(true);
    expect(extentKm(focus ?? [])).toBeLessThan(60);
  });

  it("leaves a trip whose route already fills the frame alone", () => {
    const cluster = destinationCluster(gangwonDays(), GANGWON_VISITS, GANGWON_LABELS);
    expect(cluster?.ratio).toBeLessThan(FOCUS_MIN_RATIO);
    expect(sketchFocus(gangwonDays(), GANGWON_VISITS, GANGWON_LABELS)).toBeNull();
  });

  it("refocuses a domestic long haul and ignores a stop on the way", () => {
    // Seoul → Daegu by KTX for one night: a café near home before leaving and
    // a few minutes at Seoul station are on the way, not the destination.
    const points = [
      pt("2026-09-05 10:00", 37.51, 127.03),
      pt("2026-09-05 11:30", 37.555, 126.97),
      pt("2026-09-05 13:40", 35.879, 128.628),
      ...wander("2026-09-05", 35.885, 128.61, 1.5).slice(6),
      pt("2026-09-06 09:00", 35.889, 128.61),
      pt("2026-09-06 11:30", 37.555, 126.97),
      pt("2026-09-06 12:30", 37.51, 127.03),
    ];
    const visits = [
      visit("튀김이오", "2026-09-05 08:30", 2.8, 37.49, 127.04),
      visit("서울역", "2026-09-05 11:30", 0.1, 37.555, 126.97),
      visit("치킨집", "2026-09-05 17:20", 8.8, 35.89, 128.61),
      visit("시래기", "2026-09-06 02:20", 6.7, 35.88, 128.6),
    ];
    const days = routeByDay(points, "2026-09-05", "2026-09-06");
    const focus = sketchFocus(days, visits, []);
    expect(focus).not.toBeNull();
    expect(focus?.every((p) => p.lat < 36.2)).toBe(true);
  });

  it("names a clipped leg's far end from a saved place, else a reference city", () => {
    const home: MapLabel = { key: "h", lat: 37.51, lon: 127.03, text: "집", kind: "anchor" };
    expect(legEndName({ lat: 37.511, lon: 127.031 }, [home], REFERENCE_CITIES)).toBe("집");
    expect(legEndName({ lat: 37.4811, lon: 126.4204 }, HK_LABELS, REFERENCE_CITIES)).toBe("인천");
    expect(legEndName({ lat: 10, lon: 100 }, [], REFERENCE_CITIES)).toBeNull();
    expect(toward("인천")).toBe("인천으로");
    expect(toward("서울")).toBe("서울로");
    expect(toward("본가")).toBe("본가로");
  });
});

describe("TripRouteSketch focus", () => {
  it("renders an unfocused trip exactly as before", () => {
    const days = gangwonDays();
    const focus = sketchFocus(days, GANGWON_VISITS, GANGWON_LABELS);
    const before = render(days, GANGWON_LABELS);
    expect(render(days, GANGWON_LABELS, focus)).toBe(before);
    expect(before).not.toContain("data-cue");
  });

  it("frames the destination with edge arrows naming where the legs go", () => {
    const days = hkDays();
    const focus = sketchFocus(days, HK_VISITS, HK_LABELS);
    const html = render(days, HK_LABELS, focus);
    expect(html).toContain('data-cue="out"');
    expect(html).toContain('data-cue="back"');
    expect(html).toContain("인천에서");
    expect(html).toContain("서울로");
    // The departure station sits far off the Hong Kong frame: no label for it.
    expect(html).not.toContain("김포공항역");
    // Unfocused, the same trip draws Gimpo and no cues (the old collapsed sketch).
    const old = render(days, HK_LABELS);
    expect(old).not.toContain("data-cue");
  });
});
