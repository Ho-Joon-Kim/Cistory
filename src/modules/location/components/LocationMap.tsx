"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Map, { Source, Layer, Marker, Popup } from "react-map-gl/mapbox";
import type { MapRef, LayerProps } from "react-map-gl/mapbox";
import { useTheme } from "next-themes";
import {
  useLocations,
  useStayPoints,
  useSavedPlaces,
  type SavedPlaceData,
  type StayPointData,
} from "../hooks";
import { segmentLocations, createGeoCircle, findSegmentIndexByStayPoint } from "../utils";
import { SegmentedRouteAnimator } from "./SegmentedRouteAnimator";
import { TimelineSegmentBar } from "./TimelineSegmentBar";
import { MapSkeleton } from "./MapSkeleton";
import { MapPin, Clock, Navigation, Bookmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

const SEOUL_CENTER = { longitude: 126.978, latitude: 37.5665 };
const DEFAULT_ZOOM = 11;

interface LocationMapProps {
  date: string;
  className?: string;
  initialCenter?: { latitude: number; longitude: number } | null;
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

function StayPointMarkers({
  stayPoints,
  selectedSegmentIndex,
  segments,
  onSavePlace,
  onStayPointSelect,
}: {
  stayPoints: StayPointData[];
  selectedSegmentIndex: number | null;
  segments: ReturnType<typeof segmentLocations>;
  onSavePlace?: (sp: StayPointData) => void;
  onStayPointSelect?: (sp: StayPointData) => void;
}) {
  const [selectedPoint, setSelectedPoint] = useState<StayPointData | null>(null);

  return (
    <>
      {stayPoints.map((sp) => {
        const segIdx = findSegmentIndexByStayPoint(segments, sp);
        const isSelected = selectedSegmentIndex !== null && segIdx === selectedSegmentIndex;

        return (
          <Marker
            key={`stay-${sp.lat}-${sp.lon}-${sp.startTime}`}
            longitude={sp.lon}
            latitude={sp.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelectedPoint(sp);
              onStayPointSelect?.(sp);
            }}
          >
            <div
              className={`stay-point-marker animate-bounce-in ${sp.savedPlaceId ? "stay-point-marker-saved" : ""} ${isSelected ? "stay-point-marker-selected" : ""}`}
              title={sp.placeName ?? undefined}
            >
              <Navigation className="h-3.5 w-3.5 text-white" />
            </div>
          </Marker>
        );
      })}

      {selectedPoint && (
        <Popup
          longitude={selectedPoint.lon}
          latitude={selectedPoint.lat}
          anchor="bottom"
          offset={16}
          closeOnClick={true}
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
            {!selectedPoint.savedPlaceId && onSavePlace && (
              <button
                type="button"
                className="stay-point-save-btn"
                onClick={() => {
                  onSavePlace(selectedPoint);
                  setSelectedPoint(null);
                }}
              >
                <Bookmark className="h-3 w-3" />
                이 장소 저장
              </button>
            )}
          </div>
        </Popup>
      )}
    </>
  );
}

const SAVED_PLACE_FILL_LAYER: LayerProps = {
  id: "saved-places-fill",
  type: "fill" as const,
  paint: {
    "fill-color": "hsl(45, 100%, 42%)",
    "fill-opacity": 0.1,
  },
};

const SAVED_PLACE_OUTLINE_LAYER: LayerProps = {
  id: "saved-places-outline",
  type: "line" as const,
  paint: {
    "line-color": "hsl(45, 100%, 42%)",
    "line-width": 1.5,
    "line-opacity": 0.5,
    "line-dasharray": [3, 2],
  },
};

function SavedPlacesOverlay({ places }: { places: SavedPlaceData[] }) {
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    return {
      type: "FeatureCollection",
      features: places.map((p) => createGeoCircle(p.lon, p.lat, p.radiusM)),
    };
  }, [places]);

  if (places.length === 0) return null;

  return (
    <>
      <Source id="saved-places-circles" type="geojson" data={geojson}>
        <Layer {...SAVED_PLACE_FILL_LAYER} />
        <Layer {...SAVED_PLACE_OUTLINE_LAYER} />
      </Source>
      {places.map((p) => (
        <Marker
          key={`saved-label-${p.id}`}
          longitude={p.lon}
          latitude={p.lat}
          anchor="center"
        >
          <div className="saved-place-label">{p.name}</div>
        </Marker>
      ))}
    </>
  );
}

export function LocationMap({ date, className, initialCenter }: LocationMapProps) {
  const { resolvedTheme } = useTheme();
  const { locations, isLoading: isLocationsLoading } = useLocations(date);
  const { stayPoints, isLoading: isStayPointsLoading } = useStayPoints(date);
  const { places: savedPlaces, createPlace } = useSavedPlaces();
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapRef = useRef<MapRef>(null);

  // Bidirectional state
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState<number | null>(null);

  const segments = useMemo(
    () => segmentLocations(locations, stayPoints),
    [locations, stayPoints],
  );

  // Auto-select the last staying segment on today's date
  const autoSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (date !== today) return;
    if (segments.length === 0) return;
    // Only auto-select once per date
    if (autoSelectedRef.current === date) return;

    // Find last staying segment
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].type === "staying") {
        setSelectedSegmentIndex(i);
        autoSelectedRef.current = date;
        break;
      }
    }
  }, [date, segments]);

  const handleSavePlace = useCallback(
    async (sp: StayPointData) => {
      const success = await createPlace({
        name: sp.placeName || "새 장소",
        lat: sp.lat,
        lon: sp.lon,
        address: sp.address || undefined,
        category: sp.category || undefined,
      });
      if (success) {
        toast.success("장소가 저장되었습니다");
      } else {
        toast.error("장소 저장에 실패했습니다");
      }
    },
    [createPlace],
  );

  // Bar → Map: segment click handler
  const handleSegmentClick = useCallback(
    (index: number) => {
      const map = mapRef.current;
      // Toggle: clicking same segment deselects
      if (selectedSegmentIndex === index) {
        setSelectedSegmentIndex(null);
        return;
      }

      setSelectedSegmentIndex(index);

      if (!map) return;

      const seg = segments[index];
      if (seg.type === "staying") {
        map.flyTo({
          center: [seg.stayPoint.lon, seg.stayPoint.lat],
          zoom: 16,
          duration: 1000,
        });
      } else if (seg.type === "moving" && seg.coords.length > 0) {
        const lngs = seg.coords.map((c) => c[0]);
        const lats = seg.coords.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 60, duration: 1000 },
        );
      }
    },
    [selectedSegmentIndex, segments],
  );

  // Map → Bar: stay point marker click
  const handleMapStayPointSelect = useCallback(
    (sp: StayPointData) => {
      const idx = findSegmentIndexByStayPoint(segments, sp);
      if (idx !== -1) {
        setSelectedSegmentIndex(idx);
      }
    },
    [segments],
  );

  // Map click: deselect
  const handleMapClick = useCallback(() => {
    setSelectedSegmentIndex(null);
  }, []);

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;
  const center = initialCenter ?? SEOUL_CENTER;

  // Wait for theme to resolve before mounting the map
  if (!MAPBOX_TOKEN || !resolvedTheme) {
    return (
      <div className={`bg-muted flex items-center justify-center ${className ?? ""}`}>
        {!MAPBOX_TOKEN && (
          <p className="text-sm text-muted-foreground">Mapbox 토큰이 설정되지 않았습니다</p>
        )}
        {MAPBOX_TOKEN && !resolvedTheme && <MapSkeleton />}
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col ${className ?? ""}`}>
      <div className="relative flex-1">
        <Map
          ref={mapRef}
          id="location-map"
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            ...center,
            zoom: DEFAULT_ZOOM,
          }}
          mapStyle={mapStyle}
          fadeDuration={0}
          style={{ width: "100%", height: "100%" }}
          onLoad={() => setMapLoaded(true)}
          onClick={handleMapClick}
          reuseMaps
        >
          {mapLoaded && (
            <SegmentedRouteAnimator
              locations={locations}
              stayPoints={stayPoints}
              date={date}
              selectedSegmentIndex={selectedSegmentIndex}
              hoveredSegmentIndex={hoveredSegmentIndex}
            />
          )}
          {mapLoaded && stayPoints.length > 0 && (
            <StayPointMarkers
              stayPoints={stayPoints}
              selectedSegmentIndex={selectedSegmentIndex}
              segments={segments}
              onSavePlace={handleSavePlace}
              onStayPointSelect={handleMapStayPointSelect}
            />
          )}
          {mapLoaded && savedPlaces.length > 0 && (
            <SavedPlacesOverlay places={savedPlaces} />
          )}
        </Map>

        {/* Loading indicator */}
        {(isLocationsLoading || isStayPointsLoading) && (
          <div className="absolute top-3 left-3 z-10 pointer-events-none">
            <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-3 py-2 shadow-sm flex flex-col gap-1.5">
              {isLocationsLoading && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">경로 불러오는 중...</span>
                </div>
              )}
              {isStayPointsLoading && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">체류지점 분석 중...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLocationsLoading && locations.length === 0 && mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">위치 데이터가 없습니다</span>
            </div>
          </div>
        )}
      </div>

      {/* Timeline Segment Bar */}
      {segments.length > 0 && (
        <TimelineSegmentBar
          segments={segments}
          selectedIndex={selectedSegmentIndex}
          hoveredIndex={hoveredSegmentIndex}
          onSegmentClick={handleSegmentClick}
          onSegmentHover={setHoveredSegmentIndex}
        />
      )}
    </div>
  );
}
