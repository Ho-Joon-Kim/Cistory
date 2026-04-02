"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import type { Position } from "geojson";
import type { GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import type { LocationData, StayPointData } from "../hooks";
import { segmentLocations } from "../utils";

const ANIMATION_DURATION = 1500;

const EMPTY_FC_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const EMPTY_POINT_GEOJSON: GeoJSON.Feature = {
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates: [0, 0] },
};

/** Invisible hit-test layer — wider than visible line for easier hovering */
const LINE_HIT_LAYER: LayerProps = {
  id: "route-line-hit",
  type: "line" as const,
  paint: {
    "line-color": "transparent",
    "line-width": 20,
    "line-opacity": 0,
  },
};

const LINE_LAYER: LayerProps = {
  id: "route-line",
  type: "line" as const,
  paint: {
    "line-color": "hsl(153, 60%, 38%)",
    "line-width": 3,
    "line-opacity": 0.8,
  },
  layout: {
    "line-cap": "round" as const,
    "line-join": "round" as const,
  },
};

/** Speed-colored route layer — uses data-driven line color based on speed property */
const SPEED_LINE_LAYER: LayerProps = {
  id: "route-line-speed",
  type: "line" as const,
  paint: {
    "line-color": [
      "interpolate",
      ["linear"],
      ["get", "speed"],
      0, "#3b82f6",     // blue: stationary/walking
      7, "#22c55e",     // green: walking/running
      20, "#eab308",    // yellow: cycling
      50, "#f97316",    // orange: driving
      100, "#ef4444",   // red: high speed
    ],
    "line-width": 3,
    "line-opacity": 0.85,
  },
  layout: {
    "line-cap": "round" as const,
    "line-join": "round" as const,
  },
};

const NEAREST_POINT_LAYER: LayerProps = {
  id: "route-nearest-point",
  type: "circle" as const,
  paint: {
    "circle-radius": 5,
    "circle-color": "hsl(153, 60%, 38%)",
    "circle-opacity": 0,
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-opacity": 0,
  },
};

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Build a FeatureCollection with per-segment LineString features */
function makeSegmentedGeoJSON(
  lines: Position[][],
  segmentIndices: number[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((coords, i) => ({
      type: "Feature" as const,
      properties: { segmentIndex: segmentIndices[i] },
      geometry: { type: "LineString" as const, coordinates: coords },
    })),
  };
}

/**
 * Build a FeatureCollection of 2-point LineStrings, each with a speed property (km/h).
 * Used for data-driven speed-colored routes.
 */
function makeSpeedGeoJSON(
  locations: LocationData[],
  lines: Position[][],
  segmentIndices: number[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  // Map locations by coordinate string for quick lookup
  const locMap = new Map<string, LocationData>();
  for (const loc of locations) {
    locMap.set(`${loc.lon},${loc.lat}`, loc);
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = 0; i < line.length - 1; i++) {
      const from = line[i];
      const to = line[i + 1];
      const loc = locMap.get(`${to[0]},${to[1]}`);
      // velocity from OwnTracks is in km/h (or null)
      const speed = loc?.velocity != null ? Math.abs(loc.velocity) : 0;

      features.push({
        type: "Feature",
        properties: { segmentIndex: segmentIndices[li], speed },
        geometry: {
          type: "LineString",
          coordinates: [from, to],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

interface SegmentedRouteAnimatorProps {
  locations: LocationData[];
  stayPoints: StayPointData[];
  date: string;
  selectedSegmentIndex?: number | null;
  hoveredSegmentIndex?: number | null;
  speedColorMode?: boolean;
}

export function SegmentedRouteAnimator({
  locations,
  stayPoints,
  date,
  selectedSegmentIndex = null,
  hoveredSegmentIndex = null,
  speedColorMode = false,
}: SegmentedRouteAnimatorProps) {
  const { current: map } = useMap();
  const [markerState, setMarkerState] = useState<{
    lastPoint: Position | null;
    transitionPoints: Position[];
  }>({ lastPoint: null, transitionPoints: [] });
  const animationRef = useRef<number>(0);
  const prevDateRef = useRef(date);
  const animationCompletedRef = useRef(false);

  const allCoords = useMemo<Position[]>(
    () => locations.map((l) => [l.lon, l.lat]),
    [locations],
  );

  const segments = useMemo(
    () => segmentLocations(locations, stayPoints),
    [locations, stayPoints],
  );

  // Extract moving segment line arrays, per-segment indices, and all moving coords
  const { movingLines, movingSegmentIndices, movingCoordsFlat, transitions } = useMemo(() => {
    const lines: Position[][] = [];
    const indices: number[] = [];
    const flat: Position[] = [];
    const trans: Position[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === "moving") {
        lines.push(seg.coords);
        indices.push(i);
        for (const c of seg.coords) {
          flat.push(c);
        }
        if (i > 0 && seg.coords.length > 0) {
          trans.push(seg.coords[0]);
        }
        if (i < segments.length - 1 && seg.coords.length > 0) {
          trans.push(seg.coords[seg.coords.length - 1]);
        }
      }
    }

    return { movingLines: lines, movingSegmentIndices: indices, movingCoordsFlat: flat, transitions: trans };
  }, [segments]);

  const updateLine = useCallback(
    (lines: Position[][], segIndices: number[]) => {
      if (!map) return;
      const geojson = makeSegmentedGeoJSON(lines, segIndices);
      const src = map.getSource("route") as GeoJSONSource | undefined;
      if (src) src.setData(geojson);
      const hitSrc = map.getSource("route-hit") as GeoJSONSource | undefined;
      if (hitSrc) hitSrc.setData(geojson);
      // Update speed source
      const speedSrc = map.getSource("route-speed") as GeoJSONSource | undefined;
      if (speedSrc) {
        speedSrc.setData(makeSpeedGeoJSON(locations, lines, segIndices));
      }
    },
    [map, locations],
  );

  // Update paint properties when selection/hover changes (after animation completes)
  useEffect(() => {
    if (!map || !animationCompletedRef.current) return;
    const gl = map.getMap();
    if (!gl.getLayer("route-line")) return;

    // Line opacity: selected segment full, others dimmed
    if (selectedSegmentIndex != null) {
      gl.setPaintProperty("route-line", "line-opacity", [
        "match",
        ["get", "segmentIndex"],
        selectedSegmentIndex,
        1.0,
        0.15,
      ]);
    } else {
      gl.setPaintProperty("route-line", "line-opacity", 0.8);
    }

    // Line width: hovered segment thicker
    if (hoveredSegmentIndex != null) {
      gl.setPaintProperty("route-line", "line-width", [
        "match",
        ["get", "segmentIndex"],
        hoveredSegmentIndex,
        5,
        3,
      ]);
    } else {
      gl.setPaintProperty("route-line", "line-width", 3);
    }
  }, [map, selectedSegmentIndex, hoveredSegmentIndex]);

  // Toggle visibility between normal and speed-colored route layers
  useEffect(() => {
    if (!map) return;
    const gl = map.getMap();
    if (gl.getLayer("route-line")) {
      gl.setLayoutProperty("route-line", "visibility", speedColorMode ? "none" : "visible");
    }
    if (gl.getLayer("route-line-speed")) {
      gl.setLayoutProperty("route-line-speed", "visibility", speedColorMode ? "visible" : "none");
    }
  }, [map, speedColorMode]);

  // Show nearest point on route hover, hide on leave
  useEffect(() => {
    if (!map) return;
    const gl = map.getMap();

    const updateNearestPoint = (e: MapMouseEvent) => {
      const src = gl.getSource("route-nearest-point") as GeoJSONSource | undefined;
      if (!src || movingCoordsFlat.length === 0) return;

      const point = e.lngLat;
      let minDist = Number.POSITIVE_INFINITY;
      let nearest: Position | null = null;

      for (const c of movingCoordsFlat) {
        const dx = c[0] - point.lng;
        const dy = c[1] - point.lat;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          nearest = c;
        }
      }

      if (nearest) {
        src.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: nearest },
        });
        gl.setPaintProperty("route-nearest-point", "circle-opacity", 0.9);
        gl.setPaintProperty("route-nearest-point", "circle-stroke-opacity", 0.8);
      }
      gl.getCanvas().style.cursor = "pointer";
    };

    const hideNearestPoint = () => {
      if (!gl.getLayer("route-nearest-point")) return;
      gl.setPaintProperty("route-nearest-point", "circle-opacity", 0);
      gl.setPaintProperty("route-nearest-point", "circle-stroke-opacity", 0);
      gl.getCanvas().style.cursor = "";
    };

    gl.on("mousemove", "route-line-hit", updateNearestPoint);
    gl.on("mouseleave", "route-line-hit", hideNearestPoint);

    return () => {
      gl.off("mousemove", "route-line-hit", updateNearestPoint);
      gl.off("mouseleave", "route-line-hit", hideNearestPoint);
    };
  }, [map, movingCoordsFlat]);

  // Fit bounds when locations change
  useEffect(() => {
    if (!map || allCoords.length === 0) return;

    if (allCoords.length === 1) {
      map.flyTo({
        center: [allCoords[0][0], allCoords[0][1]],
        zoom: 15,
        duration: 1000,
      });
    } else {
      const lngs = allCoords.map((c) => c[0]);
      const lats = allCoords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 50, duration: 1000 },
      );
    }
  }, [map, allCoords]);

  // Animate route drawing — only moving segments
  useEffect(() => {
    if (!map) return;

    animationCompletedRef.current = false;

    // Reset on date change
    if (prevDateRef.current !== date) {
      cancelAnimationFrame(animationRef.current);
      updateLine([], []);
      setMarkerState({ lastPoint: null, transitionPoints: [] });
      prevDateRef.current = date;
    }

    if (movingCoordsFlat.length === 0) {
      updateLine([], []);
      setMarkerState({ lastPoint: null, transitionPoints: transitions });
      animationCompletedRef.current = true;
      return;
    }

    if (movingCoordsFlat.length === 1) {
      updateLine(movingLines, movingSegmentIndices);
      setMarkerState({ lastPoint: movingCoordsFlat[0], transitionPoints: transitions });
      animationCompletedRef.current = true;
      return;
    }

    const totalCoords = movingCoordsFlat.length;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const eased = easeOutCubic(progress);
      const count = Math.max(2, Math.round(eased * totalCoords));

      // Build partial lines: distribute count across movingLines
      let remaining = count;
      const partialLines: Position[][] = [];
      const partialIndices: number[] = [];
      for (let li = 0; li < movingLines.length; li++) {
        const line = movingLines[li];
        if (remaining <= 0) break;
        if (remaining >= line.length) {
          partialLines.push(line);
          partialIndices.push(movingSegmentIndices[li]);
          remaining -= line.length;
        } else {
          partialLines.push(line.slice(0, remaining));
          partialIndices.push(movingSegmentIndices[li]);
          remaining = 0;
        }
      }
      updateLine(partialLines, partialIndices);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        updateLine(movingLines, movingSegmentIndices);
        setMarkerState({ lastPoint: allCoords[allCoords.length - 1], transitionPoints: transitions });
        animationCompletedRef.current = true;
      }
    }

    setMarkerState({ lastPoint: null, transitionPoints: [] });
    animationRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationRef.current);
  }, [map, movingLines, movingSegmentIndices, movingCoordsFlat, allCoords, transitions, date, updateLine]);

  const hasData = allCoords.length > 0;

  return (
    <>
      {hasData && (
        <>
          <Source id="route" type="geojson" data={EMPTY_FC_GEOJSON}>
            <Layer {...LINE_LAYER} />
          </Source>
          {/* Speed-colored route layer */}
          <Source id="route-speed" type="geojson" data={EMPTY_FC_GEOJSON}>
            <Layer {...SPEED_LINE_LAYER} />
          </Source>
          {/* Invisible wider hit-test layer for hover detection */}
          <Source id="route-hit" type="geojson" data={EMPTY_FC_GEOJSON}>
            <Layer {...LINE_HIT_LAYER} />
          </Source>
          <Source id="route-nearest-point" type="geojson" data={EMPTY_POINT_GEOJSON}>
            <Layer {...NEAREST_POINT_LAYER} />
          </Source>
        </>
      )}
      {/* Transition markers (moving↔staying boundaries) */}
      {markerState.transitionPoints.map((p, i) => (
        <Marker
          key={`transition-${p[0]}-${p[1]}-${i}`}
          longitude={p[0]}
          latitude={p[1]}
          anchor="center"
        >
          <div className="transition-marker animate-bounce-in" />
        </Marker>
      ))}
      {markerState.lastPoint && (
        <Marker longitude={markerState.lastPoint[0]} latitude={markerState.lastPoint[1]} anchor="center">
          <div className="location-marker-container animate-bounce-in">
            <div className="location-marker-pulse" />
            <div className="location-marker-dot" />
          </div>
        </Marker>
      )}
    </>
  );
}
