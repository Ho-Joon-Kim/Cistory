"use client";

import { MapPin } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useRef } from "react";
import type { LayerProps, MapRef } from "react-map-gl/mapbox";
import { Layer, default as MapGL, Marker, Source } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { TravelRoutePoint, TravelTripVisit } from "../hooks";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

const ROUTE_LAYER: LayerProps = {
  id: "trip-route-line",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#2563eb",
    "line-width": 4,
    "line-opacity": 0.8,
  },
};

type Bounds = [[number, number], [number, number]];

export interface TripMapViewport {
  center: { latitude: number; longitude: number };
  zoom: number;
  bounds: Bounds | null;
}

function isCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function calculateTripMapViewport(
  points: TravelRoutePoint[],
  visits: TravelTripVisit[]
): TripMapViewport | null {
  const coordinates = [
    ...points.map((point) => ({ lat: point.lat, lon: point.lon })),
    ...visits.map((visit) => ({ lat: visit.centerLat, lon: visit.centerLon })),
  ].filter((coordinate) => isCoordinate(coordinate.lat, coordinate.lon));
  if (coordinates.length === 0) return null;

  const lats = coordinates.map((coordinate) => coordinate.lat);
  const lons = coordinates.map((coordinate) => coordinate.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const center = { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2 };

  if (minLat === maxLat && minLon === maxLon) {
    return { center, zoom: 13, bounds: null };
  }
  return {
    center,
    zoom: 9,
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
  };
}

export function createRouteGeoJson(
  points: TravelRoutePoint[]
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const coordinates = [...points]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .filter((point) => isCoordinate(point.lat, point.lon))
    .map((point) => [point.lon, point.lat]);
  return {
    type: "FeatureCollection",
    features:
      coordinates.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          ]
        : [],
  };
}

interface TripRouteMapProps {
  points: TravelRoutePoint[];
  visits: TravelTripVisit[];
  accessToken?: string;
}

export function TripRouteMap({ points, visits, accessToken = MAPBOX_TOKEN }: TripRouteMapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const viewport = useMemo(() => calculateTripMapViewport(points, visits), [points, visits]);
  const route = useMemo(() => createRouteGeoJson(points), [points]);

  if (!accessToken) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border bg-muted sm:h-[420px]">
        <p className="px-4 text-center text-sm text-muted-foreground">
          Mapbox 토큰이 설정되지 않았습니다
        </p>
      </div>
    );
  }

  if (!viewport) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border bg-muted sm:h-[420px]">
        <p className="px-4 text-center text-sm text-muted-foreground">
          표시할 경로 또는 방문지가 없습니다
        </p>
      </div>
    );
  }

  return (
    <section
      className="h-[320px] overflow-hidden rounded-xl border sm:h-[420px]"
      aria-label="여행 경로 지도"
    >
      <MapGL
        ref={mapRef}
        mapboxAccessToken={accessToken}
        initialViewState={{
          latitude: viewport.center.latitude,
          longitude: viewport.center.longitude,
          zoom: viewport.zoom,
        }}
        mapStyle={resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE}
        style={{ width: "100%", height: "100%" }}
        onLoad={() => {
          if (!viewport.bounds) return;
          mapRef.current?.getMap().fitBounds(viewport.bounds, {
            padding: 48,
            duration: 0,
            maxZoom: 14,
          });
        }}
        reuseMaps
      >
        {route.features.length > 0 ? (
          <Source id="trip-route" type="geojson" data={route}>
            <Layer {...ROUTE_LAYER} />
          </Source>
        ) : null}
        {visits
          .filter((visit) => isCoordinate(visit.centerLat, visit.centerLon))
          .map((visit) => {
            const label = visit.placeName?.trim() || visit.address?.trim() || "알 수 없는 장소";
            return (
              <Marker
                key={visit.id}
                latitude={visit.centerLat}
                longitude={visit.centerLon}
                anchor="bottom"
              >
                <button
                  type="button"
                  aria-label={`${label} 방문지`}
                  title={label}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-md"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                </button>
              </Marker>
            );
          })}
      </MapGL>
    </section>
  );
}
