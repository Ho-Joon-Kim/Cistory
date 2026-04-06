"use client";

import { useState, useMemo, useCallback } from "react";
import Map, { Source, Layer, Popup } from "react-map-gl/mapbox";
import type { LayerProps, MapMouseEvent } from "react-map-gl/mapbox";
import { useTheme } from "next-themes";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

// Korea center
const KOREA_CENTER = { lat: 36.5, lon: 127.5 };
const KOREA_ZOOM = 6.5;

interface ScratchMapRegion {
  name: string;
  visits: number;
  firstVisit: string;
  lastVisit: string;
  lat: number;
  lon: number;
}

interface ScratchMapProps {
  regions: ScratchMapRegion[];
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}

const CIRCLE_LAYER: LayerProps = {
  id: "scratch-map-circles",
  type: "circle",
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "logVisits"],
      0, 6,
      2, 10,
      4, 16,
      6, 22,
      8, 30,
    ],
    "circle-color": [
      "interpolate",
      ["linear"],
      ["get", "logVisits"],
      0, "#bbf7d0",
      2, "#86efac",
      4, "#4ade80",
      6, "#22c55e",
      8, "#15803d",
    ],
    "circle-opacity": 0.75,
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#166534",
    "circle-stroke-opacity": 0.5,
  },
};

const LABEL_LAYER: LayerProps = {
  id: "scratch-map-labels",
  type: "symbol",
  layout: {
    "text-field": ["get", "name"],
    "text-size": 11,
    "text-offset": [0, 0],
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-ignore-placement": false,
  },
  paint: {
    "text-color": "#14532d",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1.5,
  },
};

export function ScratchMap({ regions }: ScratchMapProps) {
  const { resolvedTheme } = useTheme();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popup, setPopup] = useState<ScratchMapRegion | null>(null);

  const geojson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: regions.map((r) => ({
        type: "Feature" as const,
        properties: {
          name: r.name,
          visits: r.visits,
          logVisits: Math.log2(r.visits + 1),
          firstVisit: r.firstVisit,
          lastVisit: r.lastVisit,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [r.lon, r.lat],
        },
      })),
    }),
    [regions]
  );

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;

      const props = feature.properties;
      if (!props) return;

      const matched = regions.find((r) => r.name === props.name);
      if (matched) setPopup(matched);
    },
    [regions]
  );

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  if (!MAPBOX_TOKEN) {
    return (
      <div className="bg-muted flex items-center justify-center rounded-lg h-full">
        <p className="text-sm text-muted-foreground">Mapbox 토큰이 설정되지 않았습니다</p>
      </div>
    );
  }

  if (regions.length === 0) {
    return (
      <div className="bg-muted flex items-center justify-center rounded-lg h-full">
        <p className="text-sm text-muted-foreground">방문 지역 데이터가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden h-full">
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          latitude: KOREA_CENTER.lat,
          longitude: KOREA_CENTER.lon,
          zoom: KOREA_ZOOM,
        }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        onLoad={() => setMapLoaded(true)}
        onClick={handleClick}
        interactiveLayerIds={["scratch-map-circles"]}
        reuseMaps
      >
        {mapLoaded && (
          <Source id="scratch-map-source" type="geojson" data={geojson}>
            <Layer {...CIRCLE_LAYER} />
            <Layer {...LABEL_LAYER} />
          </Source>
        )}

        {popup && (
          <Popup
            longitude={popup.lon}
            latitude={popup.lat}
            anchor="bottom"
            offset={16}
            closeOnClick={false}
            onClose={() => setPopup(null)}
          >
            <div className="p-1 min-w-[140px]">
              <p className="font-medium text-sm">{popup.name}</p>
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  방문 횟수: <span className="font-medium text-foreground">{popup.visits.toLocaleString()}회</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  첫 방문: {formatDate(popup.firstVisit)}
                </p>
                <p className="text-xs text-muted-foreground">
                  마지막 방문: {formatDate(popup.lastVisit)}
                </p>
              </div>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
