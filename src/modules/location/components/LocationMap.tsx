"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import Map, { Source, Layer, Marker, Popup, useMap } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import type { Position } from "geojson";
import type { GeoJSONSource } from "mapbox-gl";
import { useTheme } from "next-themes";
import { useLocations, useStayPoints, type LocationData, type StayPointData } from "../hooks";
import { MapSkeleton } from "./MapSkeleton";
import { MapPin, Clock, Navigation } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

const SEOUL_CENTER = { longitude: 126.978, latitude: 37.5665 };
const DEFAULT_ZOOM = 11;

const ANIMATION_DURATION = 1500;

// Static initial GeoJSON (referentially stable to prevent unnecessary source updates)
const EMPTY_LINE_GEOJSON: GeoJSON.Feature = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};
const EMPTY_POINTS_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Mapbox GL layer styles (WebGL-rendered, not DOM)
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

const POINT_LAYER: LayerProps = {
  id: "route-points",
  type: "circle" as const,
  paint: {
    "circle-radius": 4,
    "circle-color": "hsl(153, 60%, 38%)",
    "circle-opacity": 0.9,
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-opacity": 0.8,
  },
};

interface LocationMapProps {
  date: string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Helper to build a LineString GeoJSON from coordinates */
function makeLineGeoJSON(coords: Position[]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

/** Helper to build a FeatureCollection of Points from coordinates */
function makePointsGeoJSON(coords: Position[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: coords.map((c) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: c },
    })),
  };
}

function RouteAnimator({
  locations,
  date,
}: {
  locations: LocationData[];
  date: string;
}) {
  const { current: map } = useMap();
  // Only one piece of React state: the last point (single DOM Marker for pulse animation)
  const [lastPoint, setLastPoint] = useState<Position | null>(null);
  const animationRef = useRef<number>(0);
  const prevDateRef = useRef(date);

  const allCoords = useMemo<Position[]>(
    () => locations.map((l) => [l.lon, l.lat]),
    [locations],
  );

  /** Imperatively update Mapbox GL sources (bypasses React render cycle) */
  const updateSources = useCallback(
    (coords: Position[]) => {
      if (!map) return;
      const lineSource = map.getSource("route") as GeoJSONSource | undefined;
      const pointSource = map.getSource("route-points") as GeoJSONSource | undefined;
      if (lineSource) lineSource.setData(makeLineGeoJSON(coords));
      if (pointSource) pointSource.setData(makePointsGeoJSON(coords));
    },
    [map],
  );

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

  // Animate route drawing — updates Mapbox sources directly (no React re-renders)
  useEffect(() => {
    if (!map) return;

    // Reset on date change
    if (prevDateRef.current !== date) {
      cancelAnimationFrame(animationRef.current);
      updateSources([]);
      setLastPoint(null);
      prevDateRef.current = date;
    }

    if (allCoords.length === 0) {
      updateSources([]);
      setLastPoint(null);
      return;
    }

    if (allCoords.length === 1) {
      updateSources(allCoords);
      setLastPoint(allCoords[0]);
      return;
    }

    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const eased = easeOutCubic(progress);

      const count = Math.max(2, Math.round(eased * allCoords.length));
      // Direct Mapbox GL source update — no React state, no re-renders
      updateSources(allCoords.slice(0, count));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        updateSources(allCoords);
        setLastPoint(allCoords[allCoords.length - 1]);
      }
    }

    setLastPoint(null);
    animationRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationRef.current);
  }, [map, allCoords, date, updateSources]);

  return (
    <>
      {/* Line layer — WebGL rendered */}
      <Source id="route" type="geojson" data={EMPTY_LINE_GEOJSON}>
        <Layer {...LINE_LAYER} />
      </Source>
      {/* Point layer — WebGL rendered (replaces 500 individual DOM Markers) */}
      <Source id="route-points" type="geojson" data={EMPTY_POINTS_GEOJSON}>
        <Layer {...POINT_LAYER} />
      </Source>
      {/* Single DOM Marker for current position pulse animation */}
      {lastPoint && (
        <Marker longitude={lastPoint[0]} latitude={lastPoint[1]} anchor="center">
          <div className="location-marker-container animate-bounce-in">
            <div className="location-marker-pulse" />
            <div className="location-marker-dot" />
          </div>
        </Marker>
      )}
    </>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function StayPointMarkers({ stayPoints }: { stayPoints: StayPointData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<StayPointData | null>(null);

  return (
    <>
      {stayPoints.map((sp, i) => (
        <Marker
          key={`stay-${sp.lat}-${sp.lon}-${i}`}
          longitude={sp.lon}
          latitude={sp.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setSelectedPoint(sp);
          }}
        >
          <div className="stay-point-marker animate-bounce-in" title={sp.placeName ?? undefined}>
            <Navigation className="h-3.5 w-3.5 text-white" />
          </div>
        </Marker>
      ))}

      {selectedPoint && (
        <Popup
          longitude={selectedPoint.lon}
          latitude={selectedPoint.lat}
          anchor="bottom"
          offset={16}
          closeOnClick={false}
          onClose={() => setSelectedPoint(null)}
          className="stay-point-popup"
        >
          <div className="stay-point-tooltip">
            {selectedPoint.placeName && (
              <p className="stay-point-tooltip-name">{selectedPoint.placeName}</p>
            )}
            {selectedPoint.address && selectedPoint.address !== selectedPoint.placeName && (
              <p className="stay-point-tooltip-address">{selectedPoint.address}</p>
            )}
            <div className="stay-point-tooltip-time">
              <Clock className="h-3 w-3" />
              <span>
                {formatTime(selectedPoint.startTime)} – {formatTime(selectedPoint.endTime)} ({formatDuration(selectedPoint.durationMinutes)})
              </span>
            </div>
            {selectedPoint.category && (
              <span className="stay-point-tooltip-category">{selectedPoint.category}</span>
            )}
          </div>
        </Popup>
      )}
    </>
  );
}

export function LocationMap({ date, className }: LocationMapProps) {
  const { resolvedTheme } = useTheme();
  const { locations, isLoading } = useLocations(date);
  const { stayPoints } = useStayPoints(date);
  const [mapLoaded, setMapLoaded] = useState(false);

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`bg-muted flex items-center justify-center ${className ?? ""}`}>
        <p className="text-sm text-muted-foreground">Mapbox 토큰이 설정되지 않았습니다</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <Map
        id="location-map"
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          ...SEOUL_CENTER,
          zoom: DEFAULT_ZOOM,
        }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        onLoad={() => setMapLoaded(true)}
        reuseMaps
      >
        {mapLoaded && <RouteAnimator locations={locations} date={date} />}
        {mapLoaded && stayPoints.length > 0 && (
          <StayPointMarkers stayPoints={stayPoints} />
        )}
      </Map>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
          <MapSkeleton />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && locations.length === 0 && mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">위치 데이터가 없습니다</span>
          </div>
        </div>
      )}
    </div>
  );
}
