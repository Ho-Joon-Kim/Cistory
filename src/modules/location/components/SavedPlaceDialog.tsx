"use client";

import { Loader2, MapPin, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { LayerProps, MarkerDragEvent } from "react-map-gl/mapbox";
// Conditionally import map components — only render when token available
import { Layer, default as MapGL, Marker, Source } from "react-map-gl/mapbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { SavedPlaceData } from "../hooks";
import { createGeoCircle } from "../utils";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
// streets-v12: 지하철 노선, 건물, POI 라벨 등 디테일한 정보 포함
const LIGHT_STYLE = "mapbox://styles/mapbox/streets-v12";
const DARK_STYLE = "mapbox://styles/mapbox/navigation-night-v1";

const RADIUS_FILL_LAYER: LayerProps = {
  id: "dialog-radius-fill",
  type: "fill" as const,
  paint: {
    "fill-color": "hsl(45, 100%, 42%)",
    "fill-opacity": 0.15,
  },
};

const RADIUS_OUTLINE_LAYER: LayerProps = {
  id: "dialog-radius-outline",
  type: "line" as const,
  paint: {
    "line-color": "hsl(45, 100%, 42%)",
    "line-width": 2,
    "line-opacity": 0.6,
    "line-dasharray": [3, 2],
  },
};

interface SearchResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
  category?: string;
}

interface SavedPlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place?: SavedPlaceData | null;
  defaultValues?: {
    name?: string;
    lat?: number;
    lon?: number;
    address?: string;
    category?: string;
  };
  onSave: (data: {
    name: string;
    lat: number;
    lon: number;
    radiusM: number;
    category?: string;
    address?: string;
  }) => Promise<boolean>;
  isSaving: boolean;
}

// --- Reducer ---

interface DialogState {
  name: string;
  lat: string;
  lon: string;
  radiusM: number;
  category: string;
  address: string;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  showResults: boolean;
  mapKey: number;
}

type DialogAction =
  | { type: "INIT_FROM_PLACE"; place: SavedPlaceData }
  | { type: "INIT_FROM_DEFAULTS"; defaults: NonNullable<SavedPlaceDialogProps["defaultValues"]> }
  | { type: "RESET" }
  | {
      type: "SET_FIELD";
      field: keyof Pick<
        DialogState,
        "name" | "lat" | "lon" | "category" | "address" | "searchQuery"
      >;
      value: string;
    }
  | { type: "SET_RADIUS"; value: number }
  | { type: "SELECT_RESULT"; result: SearchResult }
  | { type: "SET_COORDS"; lat: string; lon: string }
  | { type: "SET_SEARCH_RESULTS"; results: SearchResult[] }
  | { type: "SET_SEARCHING"; value: boolean }
  | { type: "HIDE_RESULTS" };

const initialState: DialogState = {
  name: "",
  lat: "",
  lon: "",
  radiusM: 100,
  category: "",
  address: "",
  searchQuery: "",
  searchResults: [],
  isSearching: false,
  showResults: false,
  mapKey: 0,
};

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "INIT_FROM_PLACE":
      return {
        ...initialState,
        name: action.place.name,
        lat: action.place.lat.toString(),
        lon: action.place.lon.toString(),
        radiusM: action.place.radiusM,
        category: action.place.category ?? "",
        address: action.place.address ?? "",
        mapKey: state.mapKey + 1,
      };
    case "INIT_FROM_DEFAULTS":
      return {
        ...initialState,
        name: action.defaults.name ?? "",
        lat: action.defaults.lat?.toString() ?? "",
        lon: action.defaults.lon?.toString() ?? "",
        category: action.defaults.category ?? "",
        address: action.defaults.address ?? "",
        mapKey: state.mapKey + 1,
      };
    case "RESET":
      return { ...initialState, mapKey: state.mapKey + 1 };
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_RADIUS":
      return { ...state, radiusM: action.value };
    case "SELECT_RESULT": {
      const r = action.result;
      return {
        ...state,
        name: state.name || r.name,
        lat: r.lat.toString(),
        lon: r.lon.toString(),
        address: r.address,
        category: r.category ?? state.category,
        searchQuery: r.name,
        showResults: false,
        mapKey: state.mapKey + 1,
      };
    }
    case "SET_COORDS":
      return { ...state, lat: action.lat, lon: action.lon };
    case "SET_SEARCH_RESULTS":
      return { ...state, searchResults: action.results, showResults: action.results.length > 0 };
    case "SET_SEARCHING":
      return { ...state, isSearching: action.value };
    case "HIDE_RESULTS":
      return { ...state, showResults: false };
    default:
      return state;
  }
}

// --- Mini Map ---

function DialogMiniMap({
  lat,
  lon,
  radiusM,
  onMove,
}: {
  lat: number;
  lon: number;
  radiusM: number;
  onMove: (lat: number, lon: number) => void;
}) {
  const { resolvedTheme } = useTheme();
  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  const circleGeoJson = useMemo(() => createGeoCircle(lon, lat, radiusM), [lon, lat, radiusM]);

  const handleDragEnd = useCallback(
    (e: MarkerDragEvent) => {
      onMove(e.lngLat.lat, e.lngLat.lng);
    },
    [onMove]
  );

  const handleMapClick = useCallback(
    (e: { lngLat: { lat: number; lng: number } }) => {
      onMove(e.lngLat.lat, e.lngLat.lng);
    },
    [onMove]
  );

  return (
    <MapGL
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        longitude: lon,
        latitude: lat,
        zoom: 16,
      }}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
      fadeDuration={0}
      onClick={handleMapClick}
      cursor="crosshair"
    >
      <Source id="dialog-radius" type="geojson" data={circleGeoJson}>
        <Layer {...RADIUS_FILL_LAYER} />
        <Layer {...RADIUS_OUTLINE_LAYER} />
      </Source>
      <Marker longitude={lon} latitude={lat} anchor="bottom" draggable onDragEnd={handleDragEnd}>
        <div className="dialog-map-pin">
          <MapPin className="h-6 w-6" />
        </div>
      </Marker>
    </MapGL>
  );
}

// --- Main Dialog ---

export function SavedPlaceDialog({
  open,
  onOpenChange,
  place,
  defaultValues,
  onSave,
  isSaving,
}: SavedPlaceDialogProps) {
  const [state, dispatch] = useReducer(dialogReducer, initialState);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!open) return;
    if (place) {
      dispatch({ type: "INIT_FROM_PLACE", place });
    } else if (defaultValues) {
      dispatch({ type: "INIT_FROM_DEFAULTS", defaults: defaultValues });
    } else {
      dispatch({ type: "RESET" });
    }
  }, [open, place, defaultValues]);

  const searchAddress = useCallback(async (query: string) => {
    if (query.length < 2) {
      dispatch({ type: "SET_SEARCH_RESULTS", results: [] });
      return;
    }

    dispatch({ type: "SET_SEARCHING", value: true });
    try {
      const res = await fetch(`/api/saved-places/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      dispatch({ type: "SET_SEARCH_RESULTS", results: data.results ?? [] });
    } catch {
      dispatch({ type: "SET_SEARCH_RESULTS", results: [] });
    } finally {
      dispatch({ type: "SET_SEARCHING", value: false });
    }
  }, []);

  const handleSearchInput = (value: string) => {
    dispatch({ type: "SET_FIELD", field: "searchQuery", value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAddress(value), 300);
  };

  const handleMapMove = useCallback((newLat: number, newLon: number) => {
    dispatch({ type: "SET_COORDS", lat: newLat.toFixed(6), lon: newLon.toFixed(6) });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = parseFloat(state.lat);
    const parsedLon = parseFloat(state.lon);
    if (!state.name.trim() || Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) return;

    const success = await onSave({
      name: state.name.trim(),
      lat: parsedLat,
      lon: parsedLon,
      radiusM: state.radiusM,
      category: state.category.trim() || undefined,
      address: state.address.trim() || undefined,
    });
    if (success) {
      onOpenChange(false);
    }
  };

  const isEditing = !!place;
  const parsedLat = parseFloat(state.lat);
  const parsedLon = parseFloat(state.lon);
  const hasValidCoords = !Number.isNaN(parsedLat) && !Number.isNaN(parsedLon);
  const hasMapbox = !!MAPBOX_TOKEN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle>{isEditing ? "장소 수정" : "새 장소 추가"}</DialogTitle>
            <DialogDescription>
              {isEditing ? "저장된 장소의 정보를 수정합니다" : "자주 방문하는 장소를 저장합니다"}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col sm:flex-row">
            {/* Left: Form fields */}
            <div className="flex-1 p-6 pt-4 space-y-3 overflow-y-auto max-h-[60vh] sm:max-h-none">
              {/* Address Search */}
              <div className="space-y-1.5">
                <Label>주소 검색</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={state.searchQuery}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    onFocus={() =>
                      state.searchResults.length > 0 &&
                      dispatch({ type: "SET_SEARCH_RESULTS", results: state.searchResults })
                    }
                    placeholder="장소명 또는 주소를 검색하세요"
                    className="pl-9"
                  />
                  {state.isSearching && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {state.showResults && state.searchResults.length > 0 && (
                  <div className="border rounded-lg bg-popover shadow-md max-h-36 overflow-y-auto">
                    {state.searchResults.map((r, i) => (
                      <button
                        key={`${r.lat}-${r.lon}-${i}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0"
                        onClick={() => dispatch({ type: "SELECT_RESULT", result: r })}
                      >
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.address}</p>
                      </button>
                    ))}
                  </div>
                )}
                {state.showResults &&
                  state.searchResults.length === 0 &&
                  state.searchQuery.length >= 2 &&
                  !state.isSearching && (
                    <p className="text-xs text-muted-foreground px-1">검색 결과가 없습니다</p>
                  )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="place-name">이름</Label>
                <Input
                  id="place-name"
                  value={state.name}
                  onChange={(e) =>
                    dispatch({ type: "SET_FIELD", field: "name", value: e.target.value })
                  }
                  placeholder="예: 집, 회사"
                  maxLength={100}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="place-lat">위도</Label>
                  <Input
                    id="place-lat"
                    type="number"
                    step="any"
                    value={state.lat}
                    onChange={(e) =>
                      dispatch({ type: "SET_FIELD", field: "lat", value: e.target.value })
                    }
                    placeholder="37.5665"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="place-lon">경도</Label>
                  <Input
                    id="place-lon"
                    type="number"
                    step="any"
                    value={state.lon}
                    onChange={(e) =>
                      dispatch({ type: "SET_FIELD", field: "lon", value: e.target.value })
                    }
                    placeholder="126.978"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>인식 반경: {state.radiusM}m</Label>
                <Slider
                  value={[state.radiusM]}
                  onValueChange={(v) => dispatch({ type: "SET_RADIUS", value: v[0] })}
                  min={50}
                  max={500}
                  step={10}
                />
                <p className="text-xs text-muted-foreground">
                  이 반경 이내의 체류 지점은 자동으로 이 장소로 인식됩니다
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-category">카테고리</Label>
                <Input
                  id="place-category"
                  value={state.category}
                  onChange={(e) =>
                    dispatch({ type: "SET_FIELD", field: "category", value: e.target.value })
                  }
                  placeholder="예: 주거, 업무, 카페"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-address">주소</Label>
                <Input
                  id="place-address"
                  value={state.address}
                  onChange={(e) =>
                    dispatch({ type: "SET_FIELD", field: "address", value: e.target.value })
                  }
                  placeholder="예: 서울특별시 강남구..."
                />
              </div>
            </div>

            {/* Right: Minimap */}
            <div className="sm:w-[360px] shrink-0 border-t sm:border-t-0 sm:border-l border-border">
              <div className="h-[200px] sm:h-full min-h-[200px] sm:min-h-[440px] relative bg-muted">
                {hasMapbox && hasValidCoords ? (
                  <DialogMiniMap
                    key={state.mapKey}
                    lat={parsedLat}
                    lon={parsedLon}
                    radiusM={state.radiusM}
                    onMove={handleMapMove}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                    <MapPin className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground text-center">
                      {!hasMapbox
                        ? "Mapbox 토큰이 설정되지 않았습니다"
                        : "주소를 검색하거나 좌표를 입력하면\n지도가 표시됩니다"}
                    </p>
                  </div>
                )}
                {hasMapbox && hasValidCoords && (
                  <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">
                      클릭 또는 핀 드래그로 위치 조정
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 pt-4 border-t">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button
                type="submit"
                disabled={isSaving || !state.name.trim() || !state.lat || !state.lon}
              >
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEditing ? "수정" : "저장"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
