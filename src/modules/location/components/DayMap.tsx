"use client";

import type { FeatureCollection, Point } from "geojson";
import { Pause, Play, X } from "lucide-react";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { useTheme } from "next-themes";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerProps, MapRef } from "react-map-gl/mapbox";
import { Layer, default as MapGL, Marker, ScaleControl, Source } from "react-map-gl/mapbox";
import { useEvidence } from "@/components/ds";
import { SubwayLayer } from "@/components/map/SubwayLayer";
import { formatTime } from "@/lib/format";
import { MAPBOX_PRIVACY_OPTIONS } from "@/lib/mapbox-options";
import { cn } from "@/lib/utils";
import { cameraDuration } from "../camera";
import type { LocationData, StayPointData } from "../hooks";
import { useRouteReplay } from "../hooks/useRouteReplay";
import { markerA11yRef } from "./marker-a11y";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
const MAP_LOCALE = { "Map.Title": "지도" };
/** The ring button below names itself; the Mapbox wrapper stays out of the a11y tree. */
const unlabelledMarker = markerA11yRef(null);

/** "09:05" from minutes in the day (the clamped day end reads "24:00"). */
function clockOf(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const SEOUL = { longitude: 126.978, latitude: 37.5665 };

export interface MapStay {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Minutes in the day, for label priority. */
  start: number;
  end: number;
}

export interface MapRide {
  id: string;
  startIso: string;
  endIso: string;
  /** `전기자전거 · 집 → 회사` (replay label). */
  label: string;
}

interface Palette {
  place: string;
  brand: string;
  sunken: string;
  surface: string;
  ink: string;
  ink3: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    place: v("--place", "#B4521A"),
    brand: v("--brand", "#0E6B47"),
    sunken: v("--sunken", "#F3F4F2"),
    surface: v("--surface", "#FFFFFF"),
    ink: v("--ink", "#141714"),
    ink3: v("--ink3", "#5E6661"),
  };
}

/**
 * Calms the Mapbox base style to the page: the land takes the sunken token;
 * POI, road and transit labels go; place names switch to Korean and fade a
 * step. Subway lines and stations come back quietly through the muted
 * SubwayLayer.
 */
function calmStyle(map: MapboxMap, palette: Palette) {
  const style = map.getStyle();
  for (const layer of style?.layers ?? []) {
    // Our own overlays (routes, replay, muted subway) are styled where they're declared.
    if (/^(day-|subway-)/.test(layer.id)) continue;
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", palette.sunken);
      } else if (layer.type === "symbol") {
        if (
          /poi|road|path|shield|airport|natural-point|water-point|ferry|transit|building|golf/.test(
            layer.id
          )
        ) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        } else {
          // Place names in Korean where the tiles carry them.
          map.setLayoutProperty(layer.id, "text-field", [
            "coalesce",
            ["get", "name_ko"],
            ["get", "name"],
          ]);
          if (!/settlement-major|country|state/.test(layer.id)) {
            map.setPaintProperty(layer.id, "text-opacity", 0.7);
          }
        }
      } else if (layer.type === "fill" && /landuse|park|national-park|landcover/.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-opacity", 0.35);
      } else if (layer.type === "fill" && /building/.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-opacity", 0.4);
      }
    } catch {
      // A layer without the property — leave it as the style ships it.
    }
  }
}

function rideCoords(locations: LocationData[], ride: MapRide): [number, number][] {
  const t0 = new Date(ride.startIso).getTime();
  const t1 = new Date(ride.endIso).getTime();
  const coords: [number, number][] = [];
  let before: LocationData | null = null;
  let after: LocationData | null = null;
  for (const l of locations) {
    const t = new Date(l.timestamp).getTime();
    if (t < t0) before = l;
    else if (t <= t1) coords.push([l.lon, l.lat]);
    else if (!after) {
      after = l;
      break;
    }
  }
  if (before) coords.unshift([before.lon, before.lat]);
  if (after) coords.push([after.lon, after.lat]);
  return coords;
}

const ROUTE_HIT_LAYER: LayerProps = {
  id: "day-routes-hit",
  type: "line",
  paint: { "line-color": "#000", "line-opacity": 0, "line-width": 18 },
};

/**
 * The day's hero map: real Mapbox tiles calmed to the page palette, the day's
 * rides as place-colored routes and its places as ring markers. Selection is
 * shared with the list and the strip (`selectedMapId` in, `onSelect` out). The
 * route replay hides behind one icon and plays in a slim overlay player.
 */
export function DayMap({
  date,
  locations,
  stayPoints,
  stays,
  rides,
  selectedMapId,
  onSelect,
  initialCenter,
  topLeft,
  className,
  padding = 56,
}: {
  date: string;
  locations: LocationData[];
  stayPoints: StayPointData[];
  stays: MapStay[];
  rides: MapRide[];
  selectedMapId: string | null;
  onSelect: (id: string | null) => void;
  initialCenter?: { latitude: number; longitude: number } | null;
  topLeft?: ReactNode;
  className?: string;
  padding?: number;
}) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [palette, setPalette] = useState<Palette | null>(null);
  const { stateOf, isActive } = useEvidence();

  // The palette is read from the CSS tokens, and those only change once the theme
  // class lands on <html> — which next-themes applies in ITS effect, after this
  // component's effects have run. Reading on `resolvedTheme` alone therefore kept
  // the previous theme's colors after a runtime toggle (light routes and halos on
  // the dark basemap), so re-read whenever <html>'s theme attributes change.
  useEffect(() => {
    if (!resolvedTheme) return;
    const sync = () =>
      setPalette((prev) => {
        const next = readPalette();
        return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    sync();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  // Calm every style the map loads (the theme swaps light ↔ dark styles).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    // `palette` re-runs this once the new theme's tokens are readable.
    const apply = () => calmStyle(map, palette ?? readPalette());
    if (map.isStyleLoaded()) apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [loaded, palette]);

  const routes = useMemo(
    () =>
      rides
        .map((r) => ({ ride: r, coords: rideCoords(locations, r) }))
        .filter((r) => r.coords.length > 1),
    [rides, locations]
  );

  const stateOfId = useCallback(
    (id: string): "on" | "dim" | "n" => {
      const ev = stateOf(id);
      if (ev === "on" || selectedMapId === id) return "on";
      if (ev === "dim" || (selectedMapId && !isActive)) return "dim";
      return "n";
    },
    [stateOf, selectedMapId, isActive]
  );

  const routeData = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: routes.map(({ ride, coords }) => {
        const state = stateOfId(ride.id);
        return {
          type: "Feature",
          properties: { id: ride.id, state, z: state === "on" ? 2 : state === "n" ? 1 : 0 },
          geometry: { type: "LineString", coordinates: coords },
        };
      }),
    }),
    [routes, stateOfId]
  );

  // One marker per distinct place (the same 집 twice is one ring).
  const markers = useMemo(() => {
    const byName = new Map<
      string,
      { stay: MapStay; ids: string[]; minutes: number; times: string[] }
    >();
    for (const s of stays) {
      const span = `${clockOf(s.start)}~${clockOf(s.end)}`;
      const cur = byName.get(s.name);
      if (cur) {
        cur.ids.push(s.id);
        cur.minutes += s.end - s.start;
        cur.times.push(span);
      } else byName.set(s.name, { stay: s, ids: [s.id], minutes: s.end - s.start, times: [span] });
    }
    const list = [...byName.values()];
    // Label the longest stays first and skip a label whose ring sits too close
    // to one already labelled (in degrees relative to the day's extent).
    const lats = stays.map((s) => s.lat);
    const lons = stays.map((s) => s.lon);
    const kx = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180));
    const span = Math.max(
      (Math.max(...lons) - Math.min(...lons)) * kx,
      Math.max(...lats) - Math.min(...lats),
      0.004
    );
    const placed: MapStay[] = [];
    const labelled = new Set<string>();
    for (const m of [...list].sort((a, b) => b.minutes - a.minutes)) {
      if (placed.length >= 6 || m.minutes < 20) break;
      const clash = placed.some(
        (p) => Math.hypot((p.lon - m.stay.lon) * kx, p.lat - m.stay.lat) < span * 0.12
      );
      if (clash) continue;
      placed.push(m.stay);
      labelled.add(m.stay.id);
    }
    return list.map((m) => ({ ...m, label: labelled.has(m.stay.id) }));
  }, [stays]);

  // An invisible copy of the markers in the symbol layer stack: Mapbox places
  // it first, so basemap place names (서울특별시) step aside instead of
  // printing under the DOM markers and their labels.
  const markerShadow = useMemo<FeatureCollection<Point, { text: string }>>(
    () => ({
      type: "FeatureCollection",
      features: markers.map((m) => ({
        type: "Feature",
        properties: { text: m.label ? `●  ${m.stay.name}` : "●" },
        geometry: { type: "Point", coordinates: [m.stay.lon, m.stay.lat] },
      })),
    }),
    [markers]
  );

  // Keep the canvas the size of its frame: a viewport resize or rotation that
  // changes the container without a window resize event (grid reflow) would
  // otherwise leave a blank band and a clipped route.
  const frameRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !loaded || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        mapRef.current?.getMap().resize();
        // Without a selection the whole day stays framed at the new size.
        if (!selectionRef.current) fitDayRef.current?.(0);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [loaded]);

  const fitDay = useCallback(
    (duration: number) => {
      const map = mapRef.current;
      if (!map) return false;
      const pts: [number, number][] = [
        ...routes.flatMap((r) => r.coords),
        ...stays.map((s) => [s.lon, s.lat] as [number, number]),
      ];
      if (pts.length === 0) return false;
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding, maxZoom: 15.5, duration }
      );
      return true;
    },
    [routes, stays, padding]
  );

  const fitDayRef = useRef(fitDay);
  fitDayRef.current = fitDay;
  const selectionRef = useRef(selectedMapId);
  selectionRef.current = selectedMapId;

  // Fit the day once its data arrives (and again on a new date).
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRef.current || !loaded) return;
    const key = `${date}:${routes.length}:${stays.length}`;
    if (fittedFor.current === key) return;
    if (fitDay(0)) fittedFor.current = key;
  }, [date, loaded, routes.length, stays.length, fitDay]);

  // Zoom to a selection (a place close enough to read among its neighbours, a
  // ride fitted whole); clearing the selection returns to the whole day.
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || selectedMapId === lastSelection.current) return;
    const had = lastSelection.current;
    lastSelection.current = selectedMapId;
    if (!selectedMapId) {
      if (had) fitDay(cameraDuration(600));
      return;
    }
    const stay = stays.find((s) => s.id === selectedMapId);
    if (stay) {
      map.easeTo({
        center: [stay.lon, stay.lat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: cameraDuration(600),
      });
      return;
    }
    const route = routes.find((r) => r.ride.id === selectedMapId);
    if (route) {
      const lons = route.coords.map((c) => c[0]);
      const lats = route.coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding, maxZoom: 15.5, duration: cameraDuration(700) }
      );
    }
  }, [selectedMapId, loaded, stays, routes, padding, fitDay]);

  // ── replay ──
  const replay = useRouteReplay({ locations, stayPoints });
  const [replayOn, setReplayOn] = useState(false);

  useEffect(() => {
    if (!replayOn) return;
    return replay.subscribe((frame) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const t = new Date(frame.timestamp).getTime();
      const trail: [number, number][] = [];
      for (const r of routes) {
        const r0 = new Date(r.ride.startIso).getTime();
        if (r0 > t) continue;
        const r1 = new Date(r.ride.endIso).getTime();
        if (r1 <= t) {
          trail.push(...r.coords);
          continue;
        }
        const partial = rideCoords(
          locations.filter((l) => new Date(l.timestamp).getTime() <= t),
          r.ride
        );
        trail.push(...partial, [frame.coord.lon, frame.coord.lat]);
      }
      (map.getSource("day-replay-trail") as GeoJSONSource | undefined)?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: trail.length > 1 ? trail : [] },
      });
      (map.getSource("day-replay-dot") as GeoJSONSource | undefined)?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [frame.coord.lon, frame.coord.lat] },
      });
    });
  }, [replayOn, replay.subscribe, routes, locations]);

  // A new day ends any replay of the previous one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on date only
  useEffect(() => {
    replay.stop();
    setReplayOn(false);
  }, [date]);

  // Picking a place or ride from the list/strip ends a running replay: the
  // camera follows the selection, so a moving dot elsewhere would mislead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to a new selection only
  useEffect(() => {
    if (!selectedMapId || !replayOn) return;
    replay.stop();
    setReplayOn(false);
  }, [selectedMapId]);

  const replayLabel = useMemo(() => {
    if (!replay.currentTimestamp) return "";
    const t = new Date(replay.currentTimestamp).getTime();
    const ride = rides.find(
      (r) => new Date(r.startIso).getTime() <= t && t <= new Date(r.endIso).getTime()
    );
    return ride?.label ?? "";
  }, [replay.currentTimestamp, rides]);

  const openReplay = () => {
    setReplayOn(true);
    onSelect(null);
    replay.play();
  };
  const closeReplay = () => {
    replay.stop();
    setReplayOn(false);
  };

  const routePaint = useMemo(() => {
    if (!palette) return {};
    return {
      "line-color": ["match", ["get", "state"], "on", palette.brand, palette.place],
      "line-width": ["match", ["get", "state"], "on", 5, "dim", 3, 3.5],
      "line-opacity": replayOn ? 0.25 : ["match", ["get", "state"], "dim", 0.3, 1],
    } as NonNullable<Extract<LayerProps, { type: "line" }>["paint"]>;
  }, [palette, replayOn]);

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;
  const center = initialCenter ?? SEOUL;

  if (!MAPBOX_TOKEN || !resolvedTheme) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-sunken",
          className
        )}
      >
        {topLeft ? <div className="absolute top-2.5 left-2.5 z-[5]">{topLeft}</div> : null}
        {!MAPBOX_TOKEN ? (
          <p className="text-sm text-ink-3">Mapbox 토큰이 설정되지 않았습니다</p>
        ) : null}
      </div>
    );
  }

  const noData = loaded && locations.length === 0 && stays.length === 0;

  return (
    <section
      ref={frameRef}
      className={cn("relative overflow-hidden bg-sunken", className)}
      aria-label="이동 지도"
    >
      <MapGL
        ref={mapRef}
        id="day-map"
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ ...center, zoom: 12 }}
        mapStyle={mapStyle}
        fadeDuration={0}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
        language="ko"
        // The canvas's accessible name (Mapbox defaults to English "Map").
        locale={MAP_LOCALE}
        {...MAPBOX_PRIVACY_OPTIONS}
        onLoad={(e) => {
          // Calm (and localize) the first style before it paints its English labels.
          calmStyle(e.target, readPalette());
          setLoaded(true);
        }}
        interactiveLayerIds={loaded && routes.length > 0 ? ["day-routes-hit"] : undefined}
        onClick={(e) => {
          const feature = e.features?.[0] as { properties?: Record<string, unknown> } | undefined;
          const id = feature?.properties?.id;
          onSelect(typeof id === "string" ? id : null);
        }}
        cursor="grab"
        reuseMaps
      >
        {loaded && palette ? (
          <SubwayLayer
            minZoomStations={12}
            minZoomLabels={13}
            muted={{
              line: palette.ink3,
              station: palette.ink3,
              label: palette.ink3,
              halo: palette.sunken,
            }}
          />
        ) : null}
        {loaded ? (
          <Source id="day-routes-src" type="geojson" data={routeData}>
            <Layer
              id="day-routes"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "z"] }}
              paint={routePaint}
            />
            <Layer {...ROUTE_HIT_LAYER} />
          </Source>
        ) : null}
        {loaded && replayOn && palette ? (
          <>
            <Source
              id="day-replay-trail"
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: [] },
              }}
            >
              <Layer
                id="day-replay-trail-line"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{ "line-color": palette.brand, "line-width": 5 }}
              />
            </Source>
            <Source
              id="day-replay-dot"
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [0, 0] },
              }}
            >
              <Layer
                id="day-replay-dot-circle"
                type="circle"
                paint={{
                  "circle-radius": 7,
                  "circle-color": palette.brand,
                  "circle-stroke-width": 3,
                  "circle-stroke-color": palette.surface,
                }}
              />
            </Source>
          </>
        ) : null}
        {loaded ? (
          <Source id="day-marker-shadow" type="geojson" data={markerShadow}>
            <Layer
              id="day-marker-shadow"
              type="symbol"
              layout={{
                "text-field": ["get", "text"],
                "text-font": ["Arial Unicode MS Regular"],
                "text-size": 13,
                "text-anchor": "left",
                "text-offset": [-0.6, 0],
                "text-padding": 6,
                "text-allow-overlap": true,
                "text-ignore-placement": false,
              }}
              paint={{ "text-opacity": 0 }}
            />
          </Source>
        ) : null}
        <ScaleControl
          position="bottom-right"
          unit="metric"
          maxWidth={80}
          style={{
            background: "color-mix(in oklab, var(--surface) 80%, transparent)",
            borderColor: "var(--ink3)",
            color: "var(--ink2)",
            fontSize: 10,
          }}
        />
        {loaded
          ? markers.map((m) => {
              const on = m.ids.some((id) => stateOfId(id) === "on");
              const dim = !on && m.ids.every((id) => stateOfId(id) === "dim");
              return (
                <Marker
                  ref={unlabelledMarker}
                  key={m.stay.id}
                  longitude={m.stay.lon}
                  latitude={m.stay.lat}
                  anchor="left"
                  style={{ zIndex: 1 + Number(on) * 2 }}
                >
                  <button
                    type="button"
                    aria-label={`${m.stay.name} ${m.times.join(", ")} 선택`}
                    aria-pressed={on}
                    onClick={(e) => {
                      e.stopPropagation();
                      const current = m.ids.find((id) => id === selectedMapId);
                      // A second click on a multi-visit place steps to its next visit.
                      const next = current
                        ? m.ids[(m.ids.indexOf(current) + 1) % m.ids.length]
                        : m.ids[0];
                      onSelect(current && m.ids.length === 1 ? null : next);
                    }}
                    className={cn(
                      "-ml-[7px] flex items-center gap-1.5 border-0 bg-transparent p-0 transition-opacity duration-150 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      dim && "opacity-40"
                    )}
                  >
                    <i
                      className={cn(
                        "block size-3.5 rounded-full transition-[background-color,box-shadow] duration-150",
                        on
                          ? "bg-brand shadow-[0_0_0_2.5px_var(--brand),0_0_0_7px_color-mix(in_oklab,var(--brand)_25%,transparent)]"
                          : "bg-surface shadow-[0_0_0_2.5px_var(--ink),0_1px_3px_rgb(0_0_0/0.25)]"
                      )}
                    />
                    {m.label || on ? (
                      <b
                        className={cn(
                          "rounded-md px-[7px] py-0.5 text-xs font-semibold whitespace-nowrap shadow-ring",
                          on ? "bg-brand text-brand-ink" : "bg-surface text-ink"
                        )}
                      >
                        {m.stay.name}
                      </b>
                    ) : null}
                  </button>
                </Marker>
              );
            })
          : null}
      </MapGL>

      {topLeft ? <div className="absolute top-2.5 left-2.5 z-[5]">{topLeft}</div> : null}

      {noData ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-lg bg-surface/90 px-3 py-2 text-sm text-ink-2 shadow-ring">
            이날 위치 기록이 없어요
          </span>
        </div>
      ) : null}

      {locations.length > 1 && !replayOn ? (
        <button
          type="button"
          onClick={openReplay}
          aria-label="이동 다시 보기"
          className="absolute top-3 right-3 z-[4] inline-flex size-9 items-center justify-center rounded-[10px] border-0 bg-surface text-ink shadow-ring transition-[scale,box-shadow] duration-150 before:absolute before:-inset-1 before:content-[''] hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-96"
        >
          <Play className="size-4" aria-hidden="true" />
        </button>
      ) : null}

      {replayOn ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of player controls
        <div
          role="group"
          aria-label="이동 다시 보기"
          className="ds-reveal absolute inset-x-3 bottom-12 z-[6] grid grid-cols-[36px_minmax(0,1fr)_28px] items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 shadow-ring"
        >
          <button
            type="button"
            onClick={replay.state === "playing" ? replay.pause : replay.play}
            aria-label={replay.state === "playing" ? "일시정지" : "재생"}
            className="relative inline-flex size-9 items-center justify-center rounded-full border-0 bg-brand text-brand-ink before:absolute before:-inset-1 before:content-[''] transition-[scale] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-96"
          >
            {replay.state === "playing" ? (
              <Pause className="size-3.5" fill="currentColor" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" fill="currentColor" aria-hidden="true" />
            )}
          </button>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-[15px] font-semibold text-ink tabular-nums">
                {replay.currentTimestamp ? formatTime(new Date(replay.currentTimestamp)) : "--:--"}
              </span>
              <span className="truncate text-xs text-ink-2">{replayLabel}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(replay.progress * 1000)}
              onChange={(e) => replay.seek(Number(e.target.value) / 1000)}
              aria-label="재생 위치"
              className="h-5 w-full cursor-pointer accent-[var(--brand)]"
            />
          </div>
          <button
            type="button"
            onClick={closeReplay}
            aria-label="다시 보기 닫기"
            className="relative inline-flex size-7 items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 before:absolute before:-inset-2 before:content-[''] hover:bg-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
