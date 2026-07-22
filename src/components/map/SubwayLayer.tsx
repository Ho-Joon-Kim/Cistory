"use client";

import { useEffect, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/mapbox";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { type Bbox, bboxContains, expandBbox } from "./subwayViewport";

interface SubwayData {
  lines: GeoJSON.FeatureCollection;
  stations: GeoJSON.FeatureCollection;
}

interface SubwayLayerProps {
  visible?: boolean;
  theme?: "light" | "dark";
  minZoomLines?: number;
  minZoomStations?: number;
  minZoomLabels?: number;
  /** Optional: only keep the given line ids in the overlay (for Phase 2 highlights). */
  highlightLineIds?: string[] | null;
}

/**
 * Keep only features belonging to the highlighted lines. A line feature carries
 * its own id; a station carries the ids of every line serving it (`lineIds`),
 * so both collections filter against the same set of line ids.
 */
function filterFeatures(
  fc: GeoJSON.FeatureCollection,
  highlightLineIds: string[] | null | undefined,
  key: "id" | "lineIds" = "id"
): GeoJSON.FeatureCollection {
  if (!highlightLineIds || highlightLineIds.length === 0) return fc;
  const set = new Set(highlightLineIds);
  return {
    type: "FeatureCollection",
    features: fc.features.filter((f) => {
      const value = f.properties?.[key];
      if (typeof value === "string") return set.has(value);
      if (Array.isArray(value)) return value.some((v) => typeof v === "string" && set.has(v));
      return false;
    }),
  };
}

/**
 * Renders OpenStreetMap-sourced subway lines + stations over the parent Mapbox
 * map. Requires a `<Map id="...">` ancestor that `useMap()` can resolve.
 *
 * Data is fetched on viewport change (debounced 400ms) from `/api/map/subway`.
 * The endpoint is cached 24h publicly so most pans hit the browser HTTP cache.
 */
export function SubwayLayer({
  visible = true,
  theme = "light",
  minZoomLines = 9,
  minZoomStations = 12,
  minZoomLabels = 14,
  highlightLineIds,
}: SubwayLayerProps) {
  const { current: map } = useMap();
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [data, setData] = useState<SubwayData | null>(null);
  const loadedBboxRef = useRef<Bbox | null>(null);

  // Track viewport bbox from the parent map.
  useEffect(() => {
    if (!map || !visible) return;
    const mapInstance = map.getMap();
    const update = () => {
      const b = mapInstance.getBounds();
      if (!b) return;
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    update();
    mapInstance.on("moveend", update);
    return () => {
      mapInstance.off("moveend", update);
    };
  }, [map, visible]);

  const debouncedBbox = useDebouncedValue(bbox, 400);

  // Fetch a buffered area and keep it until the viewport leaves that buffer.
  // This avoids visible GeoJSON replacement during small zoom and pan changes.
  useEffect(() => {
    if (!visible || !debouncedBbox) return;
    if (loadedBboxRef.current && bboxContains(loadedBboxRef.current, debouncedBbox)) return;

    const requestBbox = expandBbox(debouncedBbox);
    const [w, s, e, n] = requestBbox;
    const controller = new AbortController();
    fetch(`/api/map/subway?bbox=${w},${s},${e},${n}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`subway fetch ${res.status}`);
        return res.json() as Promise<SubwayData>;
      })
      .then((nextData) => {
        loadedBboxRef.current = requestBbox;
        setData(nextData);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("SubwayLayer fetch failed:", err);
        }
      });
    return () => controller.abort();
  }, [visible, debouncedBbox]);

  if (!visible || !data) return null;

  const lines = filterFeatures(data.lines, highlightLineIds);
  const stations = filterFeatures(data.stations, highlightLineIds, "lineIds");
  const isDark = theme === "dark";

  return (
    <>
      <Source id="subway-lines" type="geojson" data={lines}>
        <Layer
          id="subway-lines-layer"
          type="line"
          minzoom={minZoomLines}
          paint={{
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.1, 12, 1.9, 16, 3.2],
            "line-opacity": isDark ? 0.42 : 0.68,
          }}
          layout={{ "line-join": "round", "line-cap": "round" }}
        />
      </Source>
      <Source id="subway-stations" type="geojson" data={stations}>
        <Layer
          id="subway-stations-layer"
          type="circle"
          minzoom={minZoomStations}
          paint={{
            // Transfer stations read as slightly larger dots.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              ["case", ["boolean", ["get", "isTransfer"], false], 2.6, 2],
              14,
              ["case", ["boolean", ["get", "isTransfer"], false], 5.2, 4],
              17,
              ["case", ["boolean", ["get", "isTransfer"], false], 9, 7],
            ],
            // Paint each station with its primary line's colour; fall back to
            // the old neutral dot when no line matched its OSM line_refs.
            "circle-color": ["coalesce", ["get", "color"], isDark ? "#d8dde5" : "#ffffff"],
            // Light halo so a coloured dot stays legible on top of its own line.
            "circle-stroke-color": isDark ? "#0d1117" : "#ffffff",
            "circle-stroke-width": ["case", ["boolean", ["get", "isTransfer"], false], 2, 1.5],
          }}
        />
        <Layer
          id="subway-stations-labels"
          type="symbol"
          minzoom={minZoomLabels}
          layout={{
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 13, 11.5, 16, 15],
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-letter-spacing": 0.02,
            "text-optional": true,
            "text-allow-overlap": false,
          }}
          paint={{
            "text-color": isDark ? "#f8fafc" : "#111827",
            "text-halo-color": isDark ? "#111318" : "#ffffff",
            "text-halo-width": 2,
            "text-halo-blur": 0.4,
          }}
        />
      </Source>
    </>
  );
}
