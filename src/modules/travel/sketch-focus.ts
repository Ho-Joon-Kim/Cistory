import type { RouteDay } from "./detail-model";
import type { TravelTripVisit } from "./hooks";
import type { ReferenceCity } from "./reference-cities";
import { isRoutinePlace } from "./routine-places";

/**
 * Where the trip route sketch should look. The sketch fits one projection to
 * everything it draws, so when the ways out and back are long (a flight to Hong
 * Kong, KTX to Busan) they set the scale and the destination — where the trip
 * actually happened — collapses into a corner. This picks the destination
 * cluster so the sketch can fit to it instead and draw the long legs as cues at
 * the frame edge.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface FocusLabel extends GeoPoint {
  text: string;
  kind?: "anchor" | "station";
}

/** Below this ratio of whole-route extent to destination extent the sketch fits everything. */
export const FOCUS_MIN_RATIO = 5;
/** The destination frame is never fitted tighter than this (km, bbox diagonal). */
export const FOCUS_MIN_EXTENT_KM = 6;
/** Away visits farther than this from the time-weighted centre are on the way, not the destination. */
const CORE_RADIUS_KM = 50;
/** …but the core always reaches this far, so a one-place stay keeps its town. */
const CORE_MIN_RADIUS_KM = 15;
const KM_PER_DEG = 111.32;

interface Box {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function boxOf(points: GeoPoint[]): Box {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/** Bounding-box diagonal in km (longitudes shrunk by cos(lat), as the sketch projects). */
export function extentKm(points: GeoPoint[]): number {
  if (points.length === 0) return 0;
  const b = boxOf(points);
  const k = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  return Math.hypot((b.maxLon - b.minLon) * k, b.maxLat - b.minLat) * KM_PER_DEG;
}

function kmBetween(a: GeoPoint, b: GeoPoint): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * k, a.lat - b.lat) * KM_PER_DEG;
}

function inBox(p: GeoPoint, b: Box): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;
}

/** Duration-weighted quantile of one coordinate. */
function weightedQuantile(values: { v: number; w: number }[], q: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= total * q) return x.v;
  }
  return sorted[sorted.length - 1].v;
}

/**
 * The points the sketch should fit to, or null to fit the whole route (the
 * usual case: the destination already fills the frame).
 *
 * The destination core is the days in between (always destination by
 * definition) plus where the trip spent its time: non-routine visits near
 * their time-weighted median (within three times their time-weighted mean
 * distance from it, 15–50 km), so an hour at the airport, a
 * station café or a rest stop on the way doesn't count. Route points and labels
 * inside that core (padded) join it. Only when the whole route is at least
 * FOCUS_MIN_RATIO times larger is the sketch refocused.
 */
export function sketchFocus(
  days: RouteDay[],
  visits: TravelTripVisit[],
  labels: FocusLabel[]
): GeoPoint[] | null {
  const candidate = destinationCluster(days, visits, labels);
  if (!candidate || candidate.ratio < FOCUS_MIN_RATIO) return null;
  return candidate.points;
}

/**
 * The destination cluster and how many times larger the whole route is
 * (whole-route extent / destination extent, the destination floored at
 * FOCUS_MIN_EXTENT_KM). Null when there is nothing to tell apart.
 */
export function destinationCluster(
  days: RouteDay[],
  visits: TravelTripVisit[],
  labels: FocusLabel[]
): { points: GeoPoint[]; ratio: number; extentKm: number } | null {
  const routePoints: GeoPoint[] = days.flatMap((d) => d.points);
  const all: GeoPoint[] = [...routePoints, ...labels];
  if (all.length < 2) return null;

  const middle: GeoPoint[] = days.filter((d) => d.role === "middle").flatMap((d) => d.points);
  const away = visits
    .filter((v) => !isRoutinePlace(v.savedPlaceName, v.savedPlaceCategory))
    .map((v) => ({ lat: v.centerLat, lon: v.centerLon, w: Math.max(v.durationSeconds, 1) }));
  const core: GeoPoint[] = [...middle];
  if (away.length > 0) {
    const center = {
      lat: weightedQuantile(
        away.map((a) => ({ v: a.lat, w: a.w })),
        0.5
      ),
      lon: weightedQuantile(
        away.map((a) => ({ v: a.lon, w: a.w })),
        0.5
      ),
    };
    // Within reach of the centre, and no farther than the trip's typical
    // spread warrants: a city break ignores the airport run, a road trip
    // keeps its stops.
    const near = away.filter((a) => kmBetween(a, center) <= CORE_RADIUS_KM);
    const weight = near.reduce((sum, a) => sum + a.w, 0);
    const spread = near.reduce((sum, a) => sum + a.w * kmBetween(a, center), 0) / weight;
    const radius = Math.min(CORE_RADIUS_KM, Math.max(CORE_MIN_RADIUS_KM, spread * 3));
    core.push(...near.filter((a) => kmBetween(a, center) <= radius));
  }
  if (core.length === 0) return null;

  // Pad the core by a quarter of its span (at least ~3 km) so the destination's
  // own comings and goings, on the out and back days too, are kept whole.
  const b = boxOf(core);
  const k = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  const padLat = Math.max((b.maxLat - b.minLat) / 4, 3 / KM_PER_DEG);
  const padLon = Math.max((b.maxLon - b.minLon) / 4, 3 / (KM_PER_DEG * k));
  const frame: Box = {
    minLat: b.minLat - padLat,
    maxLat: b.maxLat + padLat,
    minLon: b.minLon - padLon,
    maxLon: b.maxLon + padLon,
  };
  const destination = [...core, ...all.filter((p) => inBox(p, frame))];

  const extent = extentKm(destination);
  const ratio = extentKm(all) / Math.max(extent, FOCUS_MIN_EXTENT_KM);

  // Too tight a cluster (one long stay) would zoom to a building: widen to the floor.
  if (extent < FOCUS_MIN_EXTENT_KM) {
    const c = boxOf(destination);
    const lat = (c.minLat + c.maxLat) / 2;
    const lon = (c.minLon + c.maxLon) / 2;
    const half = FOCUS_MIN_EXTENT_KM / 2 / Math.SQRT2 / KM_PER_DEG;
    const kc = Math.cos((lat * Math.PI) / 180);
    destination.push(
      { lat: lat - half, lon: lon - half / kc },
      { lat: lat + half, lon: lon + half / kc }
    );
  }
  return { points: destination.map((p) => ({ lat: p.lat, lon: p.lon })), ratio, extentKm: extent };
}

/**
 * The place a clipped leg comes from or goes to: a named saved place within
 * 3 km of the far end, else the nearest reference city within 40 km.
 */
export function legEndName(
  end: GeoPoint,
  labels: FocusLabel[],
  references: readonly ReferenceCity[]
): string | null {
  const nearest = <T extends GeoPoint>(items: readonly T[], max: number) =>
    items
      .map((item) => ({ item, d: kmBetween(end, item) }))
      .filter((x) => x.d <= max)
      .sort((x, y) => x.d - y.d)[0]?.item;
  const label = nearest(
    labels.filter((l) => l.kind !== "station"),
    3
  );
  if (label) return label.text;
  return nearest(references, 40)?.name ?? null;
}

/** "인천" → "인천으로", "서울" → "서울로", "집" → "집으로". */
export function toward(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${name}(으)로`;
  const final = (last - 0xac00) % 28;
  return `${name}${final === 0 || final === 8 ? "로" : "으로"}`;
}
