"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toKstCalendarDate } from "@/lib/date-key";

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
/** Today's records are still arriving; a past day only changes when the nightly pipeline reruns. */
const TODAY_STALE_MS = 30_000;
const PAST_STALE_MS = 5 * 60_000;

export type LocationDayKind = "points" | "stay-points" | "tracks" | "distances";

/**
 * Query options for one KST day of location data.
 *
 * These used to live in per-component `useRef` caches, so every visit to
 * /dashboard (and every return from another page) started empty: the list fell
 * back to its skeleton and the map was framed twice — once on the reused map's
 * default view, again when the refetch landed. In the shared query cache a
 * return renders the cached day at once and refreshes it in the background;
 * structural sharing keeps an unchanged refetch from producing new arrays, so
 * nothing downstream (the map in particular) re-renders. Polling stays
 * today-only and pauses while the tab is hidden (react-query's default).
 */
export function locationDayOptions<T>(
  kind: LocationDayKind,
  from: string,
  to: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  now: Date = new Date()
) {
  const todayKey = toKstCalendarDate(now);
  const today = from <= todayKey && todayKey <= to;
  return queryOptions({
    queryKey: ["location", kind, from, to],
    queryFn: ({ signal }) => fetcher(signal),
    enabled: !!from && !!to,
    staleTime: today ? TODAY_STALE_MS : PAST_STALE_MS,
    refetchInterval: today ? POLL_INTERVAL_MS : false,
    // A failed day settles to its error/empty state at once instead of holding
    // the skeleton through a retry; today's poll (and 다시 시도) try again.
    retry: false,
  });
}

// Stable empties, so a pending or failed source doesn't hand out a new [] each render.
const EMPTY_LOCATIONS: LocationData[] = [];
const EMPTY_STAY_POINTS: StayPointData[] = [];
const EMPTY_TRACKS: TrackData[] = [];
const EMPTY_DISTANCES: Record<string, number> = {};

async function getJson<T>(url: string, signal: AbortSignal, failure: string): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(failure);
  return (await response.json()) as T;
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
  const query = useQuery(
    locationDayOptions("stay-points", date, date, async (signal) => {
      const data = await getJson<StayPointsResponse>(
        `/api/timeline/locations/stay-points?date=${date}`,
        signal,
        "Failed to fetch stay points"
      );
      return data.stayPoints ?? [];
    })
  );
  // Loading means "nothing for this date yet" — a background refresh of a
  // cached day is not loading, and a failure settles to no records.
  return { stayPoints: query.data ?? EMPTY_STAY_POINTS, isLoading: query.isPending };
}

interface DailyDistancesResponse {
  distances: Record<string, number>;
}

export function useDailyDistances(dateFrom: string, dateTo: string) {
  const query = useQuery(
    locationDayOptions("distances", dateFrom, dateTo, async (signal) => {
      const data = await getJson<DailyDistancesResponse>(
        `/api/timeline/locations/distances?from=${dateFrom}&to=${dateTo}`,
        signal,
        "Failed to fetch distances"
      );
      return data.distances ?? {};
    })
  );
  return { distances: query.data ?? EMPTY_DISTANCES, isLoading: query.isPending };
}

export function useLocations(date: string) {
  const query = useQuery(
    locationDayOptions("points", date, date, async (signal) => {
      const params = new URLSearchParams({ date });
      const data = await getJson<LocationsResponse>(
        `/api/timeline/locations?${params}`,
        signal,
        "Failed to fetch locations"
      );
      return data.locations ?? [];
    })
  );
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  // A failed background refresh of a day already on screen keeps that day; only
  // a day with nothing to show reports the failure (and its retry).
  const failure: unknown = query.data === undefined ? query.error : null;
  return {
    locations: query.data ?? EMPTY_LOCATIONS,
    isLoading: query.isPending,
    error: failure instanceof Error ? failure.message : failure ? "Unknown error" : null,
    failure,
    refresh,
  };
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
  id: string;
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
  const query = useQuery(
    locationDayOptions("tracks", date, date, async (signal) => {
      const data = await getJson<TracksResponse>(
        `/api/timeline/locations/tracks?date=${date}`,
        signal,
        "Failed to fetch tracks"
      );
      return data.tracks ?? [];
    })
  );
  return { tracks: query.data ?? EMPTY_TRACKS, isLoading: query.isPending };
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

export type TripConfirmationErrorCode = "STALE_DETECTION";

export class TripConfirmationError extends Error {
  constructor(
    message: string,
    readonly code?: TripConfirmationErrorCode
  ) {
    super(message);
    this.name = "TripConfirmationError";
  }
}

interface TripConfirmationResponse {
  saved?: number;
  error?: string;
  code?: string;
}

export async function requestTripConfirmation(
  trips: DetectedTripData[],
  exclusionRevision: string | null
): Promise<number> {
  try {
    const res = await fetch("/api/trips/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, trips, exclusionRevision }),
    });
    const data = (await res.json().catch(() => ({}))) as TripConfirmationResponse;
    if (!res.ok) {
      throw new TripConfirmationError(
        data.error ?? "여행을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        data.code === "STALE_DETECTION" ? data.code : undefined
      );
    }
    if (typeof data.saved !== "number") {
      throw new TripConfirmationError(
        "여행 저장 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
    }
    return data.saved;
  } catch (error) {
    if (error instanceof TripConfirmationError) throw error;
    throw new TripConfirmationError(
      error instanceof Error
        ? error.message
        : "여행을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}

export function useTripDetection() {
  const [detected, setDetected] = useState<DetectedTripData[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
      const saved = await requestTripConfirmation(trips, exclusionRevision.current);
      exclusionRevision.current = null;
      setDetected([]);
      return saved;
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
  /** Korean address for display (romanized geocoder strings replaced); null if none. */
  displayAddress?: string | null;
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
