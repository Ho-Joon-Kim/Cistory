"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface LocationData {
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  velocity: number | null;
  battery: number | null;
  timestamp: string;
}

interface LocationsResponse {
  locations: LocationData[];
  count: number;
}

const POLL_INTERVAL_MS = 60_000;

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
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
        const response = await fetch(
          `/api/timeline/locations/stay-points?date=${targetDate}`,
          { signal },
        );
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
    [],
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchStayPoints(date, controller.signal);

    if (!isToday(date)) return () => controller.abort();

    const interval = setInterval(() => {
      fetchStayPoints(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, fetchStayPoints]);

  return { stayPoints, isLoading };
}

interface DailyDistancesResponse {
  distances: Record<string, number>;
}

export function useDailyDistances(dateFrom: string, dateTo: string) {
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, Record<string, number>>>(new Map());

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
        const response = await fetch(
          `/api/timeline/locations/distances?from=${from}&to=${to}`,
          { signal },
        );
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
    [],
  );

  useEffect(() => {
    if (!dateFrom || !dateTo) return;

    const controller = new AbortController();
    fetchDistances(dateFrom, dateTo, controller.signal);

    // Poll if today is in range
    const today = new Date().toISOString().slice(0, 10);
    if (today >= dateFrom && today <= dateTo) {
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
  }, [dateFrom, dateTo, fetchDistances]);

  return { distances, isLoading };
}

export function useLocations(date: string) {
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, LocationData[]>>(new Map());

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
    [],
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchLocations(date, controller.signal);

    // Poll every minute when viewing today
    if (!isToday(date)) return () => controller.abort();

    const interval = setInterval(() => {
      fetchLocations(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, fetchLocations]);

  return { locations, isLoading, error };
}

export interface SavedPlaceData {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  category: string | null;
  address: string | null;
  icon: string | null;
  color: string | null;
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
    [],
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
    [],
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
