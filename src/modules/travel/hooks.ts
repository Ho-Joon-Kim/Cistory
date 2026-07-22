"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TravelTripListItem {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  totalDistanceMeters: number | null;
  visitedCities: string[];
  visitedCountries: string[];
  isOverseas: boolean;
  autoDetected: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  totalSpending: number;
  visitCount: number;
}

export interface TravelTripsPage {
  trips: TravelTripListItem[];
  nextCursor: string | null;
}

interface UseTravelTripsReturn {
  trips: TravelTripListItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isTravelTripListItem(value: unknown): value is TravelTripListItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.name === "string" &&
    isDateKey(value.startDate) &&
    isDateKey(value.endDate) &&
    (value.totalDistanceMeters === null || isFiniteNumber(value.totalDistanceMeters)) &&
    isStringArray(value.visitedCities) &&
    isStringArray(value.visitedCountries) &&
    typeof value.isOverseas === "boolean" &&
    typeof value.autoDetected === "boolean" &&
    isNullableString(value.notes) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isFiniteNumber(value.totalSpending) &&
    isFiniteNumber(value.visitCount)
  );
}

export function parseTravelTripsPage(value: unknown): TravelTripsPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.trips) ||
    !value.trips.every(isTravelTripListItem) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string")
  ) {
    throw new Error("여행 목록 응답 형식이 올바르지 않습니다");
  }
  return { trips: value.trips, nextCursor: value.nextCursor };
}

export function mergeTravelTrips(
  current: TravelTripListItem[],
  incoming: TravelTripListItem[]
): TravelTripListItem[] {
  const seen = new Set(current.map((trip) => trip.id));
  const additions = incoming.filter((trip) => {
    if (seen.has(trip.id)) return false;
    seen.add(trip.id);
    return true;
  });
  return [...current, ...additions];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function requestTravelTripsPage(
  cursor: string | null,
  signal?: AbortSignal
): Promise<TravelTripsPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/trips?${params.toString()}`, { signal });
  if (!response.ok) throw new Error("여행 목록을 불러오지 못했습니다");
  return parseTravelTripsPage(await response.json());
}

function fetchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "여행 목록을 불러오지 못했습니다";
}

export function useTravelTrips(enabled = true): UseTravelTripsReturn {
  const [trips, setTrips] = useState<TravelTripListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const inFlightCursorRef = useRef<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null, replace: boolean, generation: number, signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      try {
        const page = await requestTravelTripsPage(cursor, signal);
        if (generationRef.current !== generation) return;

        setTrips((current) => (replace ? page.trips : mergeTravelTrips(current, page.trips)));
        setNextCursor(page.nextCursor === cursor ? null : page.nextCursor);
      } catch (fetchError) {
        if (isAbortError(fetchError) || generationRef.current !== generation) return;
        setError(fetchErrorMessage(fetchError));
      } finally {
        if (generationRef.current === generation) setIsLoading(false);
        if (inFlightCursorRef.current === cursor) inFlightCursorRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const generation = ++generationRef.current;
    void fetchPage(null, true, generation, controller.signal);
    return () => {
      controller.abort();
      generationRef.current += 1;
    };
  }, [enabled, fetchPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || isLoading || inFlightCursorRef.current === nextCursor) return;
    inFlightCursorRef.current = nextCursor;
    void fetchPage(nextCursor, false, generationRef.current);
  }, [fetchPage, isLoading, nextCursor]);

  const refresh = useCallback(() => {
    inFlightCursorRef.current = null;
    const generation = ++generationRef.current;
    void fetchPage(null, true, generation);
  }, [fetchPage]);

  return {
    trips,
    isLoading,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    refresh,
  };
}
