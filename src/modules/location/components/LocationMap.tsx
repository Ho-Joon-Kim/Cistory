"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import Map, { Source, Layer, Marker, Popup, useMap } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import type { Position } from "geojson";
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

  return (
    <>
      {animatedCoords.length >= 2 && (
        <Source id="route" type="geojson" data={geojson}>
          <Layer {...lineLayer} />
        </Source>
      )}
      {animatedCoords.map((coord, i) => {
        const isLast = showMarker && i === allCoords.length - 1;
        return (
          <Marker
            key={`${coord[0]}-${coord[1]}-${i}`}
            longitude={coord[0]}
            latitude={coord[1]}
            anchor="center"
          >
            <div className={`location-marker-container ${isLast ? "animate-bounce-in" : ""}`}>
              {isLast && <div className="location-marker-pulse" />}
              <div className="location-marker-dot" />
            </div>
          </Marker>
        );
      })}
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
