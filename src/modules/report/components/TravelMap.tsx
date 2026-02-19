"use client";

import { useState } from "react";
import Map, { Source, Layer, Marker, Popup } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import { useTheme } from "next-themes";
import { Plane } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

// 서울 기본 좌표
const SEOUL = { lat: 37.5665, lon: 126.978 };

interface TravelMapProps {
  trips: { country: string; startDate: string; endDate: string; places: string[] }[];
  topPlaces: { lat: number; lon: number; placeName: string; isOverseas: boolean }[];
  className?: string;
}

const LINE_LAYER: LayerProps = {
  id: "travel-lines",
  type: "line",
  paint: {
    "line-color": "#8b5cf6",
    "line-width": 2,
    "line-opacity": 0.6,
    "line-dasharray": [2, 2],
  },
  layout: {
    "line-cap": "round" as const,
  },
};

/**
 * Generate a curved great circle arc between two points
 */
function generateArc(
  from: [number, number],
  to: [number, number],
  steps = 50
): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = from[0] + (to[0] - from[0]) * t;
    const lat = from[1] + (to[1] - from[1]) * t;
    // Add curve by adjusting latitude
    const curve = Math.sin(t * Math.PI) * Math.abs(to[0] - from[0]) * 0.15;
    coords.push([lng, lat + curve]);
  }
  return coords;
}

interface TripMarker {
  country: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  places: string[];
}

export function TravelMap({ trips, topPlaces, className }: TravelMapProps) {
  const { resolvedTheme } = useTheme();
  const [selectedTrip, setSelectedTrip] = useState<TripMarker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  if (!MAPBOX_TOKEN || trips.length === 0) {
    return (
      <div className={`bg-muted flex items-center justify-center rounded-lg ${className ?? ""}`}>
        <p className="text-sm text-muted-foreground">
          {!MAPBOX_TOKEN ? "Mapbox 토큰이 설정되지 않았습니다" : "해외여행 데이터가 없습니다"}
        </p>
      </div>
    );
  }

  // Get overseas place coordinates for each trip
  const tripMarkers: TripMarker[] = trips.map((trip) => {
    const overseasPlace = topPlaces.find((p) => p.isOverseas);
    return {
      country: trip.country,
      lat: overseasPlace?.lat ?? 35.0,
      lon: overseasPlace?.lon ?? 135.0,
      startDate: trip.startDate,
      endDate: trip.endDate,
      places: trip.places,
    };
  });

  // Generate arc lines from Seoul to each destination
  const arcs: GeoJSON.Feature[] = tripMarkers.map((marker) => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: generateArc([SEOUL.lon, SEOUL.lat], [marker.lon, marker.lat]),
    },
  }));

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: arcs,
  };

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  return (
    <div className={`relative rounded-lg overflow-hidden ${className ?? ""}`}>
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ latitude: 35, longitude: 130, zoom: 3 }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        onLoad={() => setMapLoaded(true)}
        reuseMaps
      >
        {mapLoaded && (
          <>
            <Source id="travel-arcs" type="geojson" data={geojson}>
              <Layer {...LINE_LAYER} />
            </Source>

            {/* Seoul marker */}
            <Marker longitude={SEOUL.lon} latitude={SEOUL.lat} anchor="center">
              <div className="w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow" />
            </Marker>

            {/* Trip destination markers */}
            {tripMarkers.map((marker) => (
              <Marker
                key={`trip-${marker.country}-${marker.startDate}`}
                longitude={marker.lon}
                latitude={marker.lat}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setSelectedTrip(marker);
                }}
              >
                <div className="flex items-center justify-center w-7 h-7 bg-violet-500 rounded-full border-2 border-white shadow cursor-pointer">
                  <Plane className="h-3.5 w-3.5 text-white" />
                </div>
              </Marker>
            ))}

            {selectedTrip && (
              <Popup
                longitude={selectedTrip.lon}
                latitude={selectedTrip.lat}
                anchor="bottom"
                offset={16}
                closeOnClick={false}
                onClose={() => setSelectedTrip(null)}
              >
                <div className="p-1">
                  <p className="font-medium text-sm">{selectedTrip.country}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTrip.startDate} ~ {selectedTrip.endDate}
                  </p>
                  {selectedTrip.places.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selectedTrip.places.map((place) => (
                        <span
                          key={place}
                          className="text-[10px] bg-violet-100 dark:bg-violet-900 px-1.5 py-0.5 rounded"
                        >
                          {place}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            )}
          </>
        )}
      </Map>
    </div>
  );
}
