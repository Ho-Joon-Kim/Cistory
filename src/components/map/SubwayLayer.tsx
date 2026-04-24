"use client";

import { useEffect, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/mapbox";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

interface SubwayData {
  lines: GeoJSON.FeatureCollection;
  stations: GeoJSON.FeatureCollection;
}

type Bbox = [number, number, number, number];

interface SubwayLayerProps {
  visible?: boolean;
  minZoomLines?: number;
  minZoomStations?: number;
  minZoomLabels?: number;
  /** Optional: only keep the given line ids in the overlay (for Phase 2 highlights). */
  highlightLineIds?: string[] | null;
}

function filterFeatures(
  fc: GeoJSON.FeatureCollection,
  highlightLineIds: string[] | null | undefined
): GeoJSON.FeatureCollection {
  if (!highlightLineIds || highlightLineIds.length === 0) return fc;
  const set = new Set(highlightLineIds);
  return {
    type: "FeatureCollection",
    features: fc.features.filter((f) => {
      const id = f.properties?.id;
      return typeof id === "string" && set.has(id);
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
  minZoomLines = 9,
  minZoomStations = 12,
  minZoomLabels = 14,
  highlightLineIds,
}: SubwayLayerProps) {
  const { current: map } = useMap();
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [data, setData] = useState<SubwayData | null>(null);

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

  // Fetch subway data for the current bbox.
  useEffect(() => {
    if (!visible || !debouncedBbox) return;
    const [w, s, e, n] = debouncedBbox;
    const controller = new AbortController();
    fetch(`/api/map/subway?bbox=${w},${s},${e},${n}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`subway fetch ${res.status}`);
        return res.json() as Promise<SubwayData>;
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("SubwayLayer fetch failed:", err);
        }
      });
    return () => controller.abort();
  }, [visible, debouncedBbox]);

  if (!visible || !data) return null;

  const lines = filterFeatures(data.lines, highlightLineIds);
  const stations = filterFeatures(data.stations, highlightLineIds);

  return (
    <>
      <Source id="subway-lines" type="geojson" data={lines}>
        <Layer
          id="subway-lines-layer"
          type="line"
          minzoom={minZoomLines}
          paint={{
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 12, 2.4, 16, 4],
            "line-opacity": 0.85,
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
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 4, 17, 7],
            "circle-color": "#ffffff",
            "circle-stroke-color": "#222",
            "circle-stroke-width": 1.3,
          }}
        />
        <Layer
          id="subway-stations-labels"
          type="symbol"
          minzoom={minZoomLabels}
          layout={{
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 16, 13],
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
            "text-allow-overlap": false,
          }}
          paint={{
            "text-color": "#222",
            "text-halo-color": "#fff",
            "text-halo-width": 1.4,
          }}
        />
      </Source>
    </>
  );
}
