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
        const response = await fetch(`/api/timeline/locations?date=${targetDate}`, { signal });
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
