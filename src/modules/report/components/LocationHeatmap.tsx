"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import Map, { Source, Layer } from "react-map-gl/mapbox";
import type { LayerProps, MapRef } from "react-map-gl/mapbox";
import { useTheme } from "next-themes";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

interface LocationHeatmapProps {
  points: { lat: number; lon: number; weight: number }[];
  className?: string;
}

const HEATMAP_LAYER: LayerProps = {
  id: "report-heatmap",
  type: "heatmap",
  paint: {
    "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 50, 1],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0, "rgba(33,102,172,0)",
      0.2, "rgb(103,169,207)",
      0.4, "rgb(209,229,240)",
      0.6, "rgb(253,219,199)",
      0.8, "rgb(239,138,98)",
      1, "rgb(178,24,43)",
    ],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 5, 15, 30],
    "heatmap-opacity": 0.8,
  },
};

export function LocationHeatmap({ points, className }: LocationHeatmapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  if (!MAPBOX_TOKEN || points.length === 0) {
    return (
      <div className={`bg-muted flex items-center justify-center rounded-lg ${className ?? ""}`}>
        <p className="text-sm text-muted-foreground">
          {!MAPBOX_TOKEN ? "Mapbox 토큰이 설정되지 않았습니다" : "위치 데이터가 없습니다"}
        </p>
      </div>
    );
  }

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { weight: p.weight },
      geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
    })),
  };

  // Calculate bounding box for fitBounds
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];

  // Fallback center for initial render (fitBounds overrides after load)
  const avgLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  const avgLon = lons.reduce((s, v) => s + v, 0) / lons.length;

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  const handleLoad = useCallback(() => {
    setMapLoaded(true);
    const map = mapRef.current;
    if (!map) return;

    // Check if all points are at the same location (or very close)
    const lonSpan = Math.max(...lons) - Math.min(...lons);
    const latSpan = Math.max(...lats) - Math.min(...lats);

    if (lonSpan < 0.001 && latSpan < 0.001) {
      // Single cluster — just center with a reasonable zoom
      map.flyTo({ center: [avgLon, avgLat], zoom: 13, duration: 0 });
    } else {
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    }
  }, [lons, lats, bounds, avgLon, avgLat]);

  return (
    <div className={`relative rounded-lg overflow-hidden ${className ?? ""}`}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ latitude: avgLat, longitude: avgLon, zoom: 10 }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleLoad}
        reuseMaps
      >
        {mapLoaded && (
          <Source id="heatmap-source" type="geojson" data={geojson}>
            <Layer {...HEATMAP_LAYER} />
          </Source>
        )}
      </Map>
    </div>
  );
}
