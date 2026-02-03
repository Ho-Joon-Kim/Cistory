"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import Map, { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import type { Position } from "geojson";
import { useTheme } from "next-themes";
import { useLocations, type LocationData } from "../hooks";
import { MapSkeleton } from "./MapSkeleton";
import { MapPin } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

const SEOUL_CENTER = { longitude: 126.978, latitude: 37.5665 };
const DEFAULT_ZOOM = 11;

const ANIMATION_DURATION = 1500;

interface LocationMapProps {
  date: string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function RouteAnimator({
  locations,
  date,
}: {
  locations: LocationData[];
  date: string;
}) {
  const { current: map } = useMap();
  const [animatedCoords, setAnimatedCoords] = useState<Position[]>([]);
  const [showMarker, setShowMarker] = useState(false);
  const animationRef = useRef<number>(0);
  const prevDateRef = useRef(date);

  const allCoords = useMemo<Position[]>(
    () => locations.map((l) => [l.lon, l.lat]),
    [locations]
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
        { padding: 50, duration: 1000 }
      );
    }
  }, [map, allCoords]);

  // Animate route drawing
  useEffect(() => {
    // Reset on date change
    if (prevDateRef.current !== date) {
      cancelAnimationFrame(animationRef.current);
      setAnimatedCoords([]);
      setShowMarker(false);
      prevDateRef.current = date;
    }

    if (allCoords.length === 0) {
      setAnimatedCoords([]);
      setShowMarker(false);
      return;
    }

    if (allCoords.length === 1) {
      setAnimatedCoords(allCoords);
      setShowMarker(true);
      return;
    }

    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const eased = easeOutCubic(progress);

      const count = Math.max(2, Math.round(eased * allCoords.length));
      setAnimatedCoords(allCoords.slice(0, count));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setAnimatedCoords(allCoords);
        setShowMarker(true);
      }
    }

    setShowMarker(false);
    animationRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationRef.current);
  }, [allCoords, date]);

  const geojson = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: animatedCoords,
      },
    }),
    [animatedCoords]
  );

  const lineLayer: LayerProps = useMemo(
    () => ({
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
    }),
    []
  );

  const lastPoint =
    showMarker && allCoords.length > 0
      ? allCoords[allCoords.length - 1]
      : null;

  return (
    <>
      {animatedCoords.length >= 2 && (
        <Source id="route" type="geojson" data={geojson}>
          <Layer {...lineLayer} />
        </Source>
      )}
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

export function LocationMap({ date, className }: LocationMapProps) {
  const { resolvedTheme } = useTheme();
  const { locations, isLoading } = useLocations(date);
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
