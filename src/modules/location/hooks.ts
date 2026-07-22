"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "@/lib/hooks/usePageVisible";
import { toLocalDateString } from "@/lib/utils";

export interface LocationData {
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  velocity: number | null; // km/h
  battery: number | null;
  timestamp: string;
}

interface LocationsResponse {
  locations: LocationData[];
  count: number;
}

const POLL_INTERVAL_MS = 60_000;

function isToday(date: string): boolean {
  return date === toLocalDateString(new Date());
}

export interface StayPointData {
  lat: number;
  lon: number;
  placeName: string | null;
  address: string | null;
  category: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  savedPlaceId?: string;
  icon?: string;
  color?: string;
}

interface StayPointsResponse {
  stayPoints: StayPointData[];
}

export function useStayPoints(date: string) {
  const [stayPoints, setStayPoints] = useState<StayPointData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, StayPointData[]>>(new Map());
  const visible = usePageVisible();

  const fetchStayPoints = useCallback(
    async (targetDate: string, signal: AbortSignal, silent = false) => {
      if (!silent) {
        const cached = cache.current.get(targetDate);
        if (cached) {
          setStayPoints(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) setIsLoading(true);

      try {
        const response = await fetch(`/api/timeline/locations/stay-points?date=${targetDate}`, {
          signal,
        });
        if (!response.ok) throw new Error("Failed to fetch stay points");

        const data = (await response.json()) as StayPointsResponse;

        // Skip state update if data hasn't changed (prevents map re-render)
        if (silent) {
          const prev = cache.current.get(targetDate);
          if (
            prev &&
            prev.length === data.stayPoints.length &&
            prev.at(-1)?.endTime === data.stayPoints.at(-1)?.endTime
          ) {
            return;
          }
        }

        cache.current.set(targetDate, data.stayPoints);
        setStayPoints(data.stayPoints);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) setStayPoints([]);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchStayPoints(date, controller.signal);

    if (!isToday(date) || !visible) return () => controller.abort();

    const interval = setInterval(() => {
      fetchStayPoints(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, visible, fetchStayPoints]);

  return { stayPoints, isLoading };
}

interface DailyDistancesResponse {
  distances: Record<string, number>;
}

export function useDailyDistances(dateFrom: string, dateTo: string) {
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, Record<string, number>>>(new Map());
  const visible = usePageVisible();

  const fetchDistances = useCallback(
    async (from: string, to: string, signal: AbortSignal, silent = false) => {
      const cacheKey = `${from}:${to}`;

      if (!silent) {
        const cached = cache.current.get(cacheKey);
        if (cached) {
          setDistances(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) setIsLoading(true);

      try {
        const response = await fetch(`/api/timeline/locations/distances?from=${from}&to=${to}`, {
          signal,
        });
        if (!response.ok) throw new Error("Failed to fetch distances");

        const data = (await response.json()) as DailyDistancesResponse;

        cache.current.set(cacheKey, data.distances);
        setDistances(data.distances);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) setDistances({});
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!dateFrom || !dateTo) return;

    const controller = new AbortController();
    fetchDistances(dateFrom, dateTo, controller.signal);

    // Poll if today is in range
    const today = toLocalDateString(new Date());
    if (visible && today >= dateFrom && today <= dateTo) {
      const interval = setInterval(() => {
        // Invalidate cache for polling
        cache.current.delete(`${dateFrom}:${dateTo}`);
        fetchDistances(dateFrom, dateTo, controller.signal, true);
      }, POLL_INTERVAL_MS);

      return () => {
        controller.abort();
        clearInterval(interval);
      };
    }

    return () => controller.abort();
  }, [dateFrom, dateTo, visible, fetchDistances]);

  return { distances, isLoading };
}

export function useLocations(date: string) {
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, LocationData[]>>(new Map());
  const visible = usePageVisible();

  const fetchLocations = useCallback(
    async (targetDate: string, signal: AbortSignal, silent = false) => {
      if (!silent) {
        const cached = cache.current.get(targetDate);
        if (cached) {
          setLocations(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams({ date: targetDate });
        const response = await fetch(`/api/timeline/locations?${params}`, { signal });
        if (!response.ok) throw new Error("Failed to fetch locations");

        const data = (await response.json()) as LocationsResponse;

        // Skip state update if data hasn't changed (prevents map re-render/re-animation)
        if (silent) {
          const prev = cache.current.get(targetDate);
          if (
            prev &&
            prev.length === data.locations.length &&
            prev.at(-1)?.timestamp === data.locations.at(-1)?.timestamp
          ) {
            return;
          }
        }

        cache.current.set(targetDate, data.locations);
        setLocations(data.locations);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) {
          setError(e instanceof Error ? e.message : "Unknown error");
          setLocations([]);
        }
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchLocations(date, controller.signal);

    // Poll every minute when viewing today (only if tab is visible)
    if (!isToday(date) || !visible) return () => controller.abort();

    const interval = setInterval(() => {
      fetchLocations(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, visible, fetchLocations]);

  return { locations, isLoading, error };
}

// ── Track Data ───────────────────────────────────────────────────────────────

export interface SubwayLegData {
  lineId: string;
  lineRef: string | null;
  lineName: string | null;
  lineColor: string;
  startStationName: string | null;
  endStationName: string | null;
  sessionId: string | null;
  legOrder: number;
  totalConfidence: number;
}

export interface TrackSegmentData {
  mode: string;
  confidence: string;
  startTime: string;
  endTime: string;
  distanceMeters: number;
  durationSeconds: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  subwayLegs: SubwayLegData[];
}

export interface TrackData {
  id: string;
  startTime: string;
  endTime: string;
  distanceMeters: number;
  durationSeconds: number;
  pointCount: number;
  startPlaceName: string | null;
  endPlaceName: string | null;
  dominantMode: string | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  segments: TrackSegmentData[];
}

interface TracksResponse {
  tracks: TrackData[];
}

export function useTracks(date: string) {
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, TrackData[]>>(new Map());
  const visible = usePageVisible();

  const fetchTracks = useCallback(
    async (targetDate: string, signal: AbortSignal, silent = false) => {
      if (!silent) {
        const cached = cache.current.get(targetDate);
        if (cached) {
          setTracks(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) setIsLoading(true);

      try {
        const response = await fetch(`/api/timeline/locations/tracks?date=${targetDate}`, {
          signal,
        });
        if (!response.ok) throw new Error("Failed to fetch tracks");

        const data = (await response.json()) as TracksResponse;

        if (silent) {
          const prev = cache.current.get(targetDate);
          if (
            prev &&
            prev.length === data.tracks.length &&
            prev.at(-1)?.id === data.tracks.at(-1)?.id
          ) {
            return;
          }
        }

        cache.current.set(targetDate, data.tracks);
        setTracks(data.tracks);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) setTracks([]);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchTracks(date, controller.signal);

    if (!isToday(date) || !visible) return () => controller.abort();

    const interval = setInterval(() => {
      fetchTracks(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, visible, fetchTracks]);

  return { tracks, isLoading };
}

// ── Trip Data ────────────────────────────────────────────────────────────────

export interface TripData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  totalDistanceMeters: number | null;
  visitedCities: string[];
  visitedCountries: string[];
  isOverseas: boolean;
  notes: string | null;
}

export function useTrips(year: string | null) {
  const [trips, setTrips] = useState<TripData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!year) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/trips?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch trips");
      const data = await res.json();
      setTrips(data.trips);
    } catch {
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  }, [year]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteTrip = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setTrips((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { trips, isLoading, refresh, deleteTrip };
}

export interface DetectedTripData {
  name: string;
  startDate: string;
  endDate: string;
  visitedCities: string[];
  visitedCountries: string[];
  isOverseas: boolean;
  totalDistanceMeters: number | null;
}

export function useTripDetection() {
  const [detected, setDetected] = useState<DetectedTripData[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const detectionRange = useRef<{ from: string; to: string } | null>(null);
  const exclusionRevision = useRef<string | null>(null);

  const detect = useCallback(async (from: string, to: string) => {
    setIsDetecting(true);
    try {
      const res = await fetch("/api/trips/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) throw new Error("Failed to detect");
      const data = await res.json();
      detectionRange.current = { from, to };
      exclusionRevision.current = data.exclusionRevision;
      setDetected(data.trips);
      return data.trips as DetectedTripData[];
    } catch {
      setDetected([]);
      return [];
    } finally {
      setIsDetecting(false);
    }
  }, []);

  const confirmTrips = useCallback(async (trips: DetectedTripData[]) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/trips/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: detectionRange.current?.from,
          to: detectionRange.current?.to,
          confirm: true,
          trips,
          exclusionRevision: exclusionRevision.current,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      detectionRange.current = null;
      exclusionRevision.current = null;
      setDetected([]);
      return data.saved as number;
    } catch {
      return 0;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { detected, isDetecting, isSaving, detect, confirmTrips };
}

// ── Saved Places ─────────────────────────────────────────────────────────────

export interface SavedPlaceData {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  category: string | null;
  address: string | null;
  excludeFromTrips: boolean;
  tripExclusionRadiusM: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedPlacesResponse {
  places: SavedPlaceData[];
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlaceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/saved-places");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = (await res.json()) as SavedPlacesResponse;
      setPlaces(data.places);
    } catch {
      setPlaces([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createPlace = useCallback(
    async (data: {
      name: string;
      lat: number;
      lon: number;
      radiusM?: number;
      category?: string;
      address?: string;
      excludeFromTrips?: boolean;
      tripExclusionRadiusM?: number | null;
      icon?: string;
      color?: string;
    }) => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/saved-places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create");
        const { place } = await res.json();
        setPlaces((prev) => [place, ...prev]);
        return true;
      } catch {
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const updatePlace = useCallback(
    async (id: string, data: Partial<Omit<SavedPlaceData, "id" | "createdAt" | "updatedAt">>) => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/saved-places/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to update");
        const { place } = await res.json();
        setPlaces((prev) => prev.map((p) => (p.id === id ? place : p)));
        return true;
      } catch {
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const deletePlace = useCallback(async (id: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/saved-places/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setPlaces((prev) => prev.filter((p) => p.id !== id));
      return true;
    } catch {
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { places, isLoading, isSaving, createPlace, updatePlace, deletePlace, refresh };
}
