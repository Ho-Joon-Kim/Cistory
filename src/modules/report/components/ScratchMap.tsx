"use client";

import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Layer, default as MapGL, Popup, Source } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

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

export function ScratchMap({ regions }: ScratchMapProps) {
  const { resolvedTheme } = useTheme();
  const [popup, setPopup] = useState<ScratchMapRegion | null>(null);

  const geojson = useMemo(() => {
    const maxVisits = Math.max(...regions.map((r) => r.visits), 1);
    return {
      type: "FeatureCollection" as const,
      features: regions.map((r) => ({
        type: "Feature" as const,
        properties: {
          name: r.name,
          visits: r.visits,
          firstVisit: r.firstVisit,
          lastVisit: r.lastVisit,
          // Normalized 0-1 for color interpolation
          intensity: Math.min(Math.log2(r.visits + 1) / Math.log2(maxVisits + 1), 1),
          // Radius based on visit count
          radius: Math.max(6, Math.min(30, 6 + Math.log2(r.visits + 1) * 3)),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [r.lon, r.lat],
        },
      })),
    };
  }, [regions]);

  if (!MAPBOX_TOKEN || !resolvedTheme) return null;

  const mapStyle =
    resolvedTheme === "dark"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/light-v11";

  return (
    <MapGL
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        latitude: 36.5,
        longitude: 127.5,
        zoom: 6.5,
      }}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={["scratch-circles"]}
      onClick={(e) => {
        const feature = e.features?.[0];
        if (feature?.properties) {
          const region = regions.find((r) => r.name === feature.properties?.name);
          if (region) setPopup(region);
        }
      }}
      reuseMaps
    >
      <Source id="scratch-regions" type="geojson" data={geojson}>
        <Layer
          id="scratch-circles"
          type="circle"
          paint={{
            "circle-radius": ["get", "radius"],
            "circle-color": [
              "interpolate",
              ["linear"],
              ["get", "intensity"],
              0,
              "#bbf7d0",
              0.5,
              "#4ade80",
              1,
              "#15803d",
            ],
            "circle-opacity": 0.7,
            "circle-stroke-width": 1,
            "circle-stroke-color": resolvedTheme === "dark" ? "#1a1a1a" : "#ffffff",
          }}
        />
        <Layer
          id="scratch-labels"
          type="symbol"
          layout={{
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.5],
            "text-allow-overlap": false,
          }}
          paint={{
            "text-color": resolvedTheme === "dark" ? "#d1d5db" : "#374151",
            "text-halo-color": resolvedTheme === "dark" ? "#1a1a1a" : "#ffffff",
            "text-halo-width": 1,
          }}
        />
      </Source>
      {popup && (
        <Popup
          latitude={popup.lat}
          longitude={popup.lon}
          onClose={() => setPopup(null)}
          closeButton={true}
          closeOnClick={false}
          anchor="bottom"
          className="scratch-popup"
        >
          <div className="p-2">
            <p className="font-medium text-sm">{popup.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              방문 {popup.visits.toLocaleString()}회
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(popup.firstVisit).toLocaleDateString("ko-KR")} ~{" "}
              {new Date(popup.lastVisit).toLocaleDateString("ko-KR")}
            </p>
          </div>
        </Popup>
      )}
    </MapGL>
  );
}
