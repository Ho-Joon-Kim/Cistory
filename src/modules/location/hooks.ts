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
