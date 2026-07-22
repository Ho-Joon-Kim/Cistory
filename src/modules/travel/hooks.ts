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

export type TravelTrip = Omit<TravelTripListItem, "totalSpending" | "visitCount">;

export interface TravelTripVisit {
  id: string;
  centerLat: number;
  centerLon: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  placeName: string | null;
  address: string | null;
  category: string | null;
  city: string | null;
  countryName: string | null;
}

export interface TravelTripTransaction {
  id: string;
  amount: number;
  merchant: string;
  accountName: string;
  category: string | null;
  transactedAt: string;
}

export interface TravelTripDetail {
  trip: TravelTrip;
  visits: TravelTripVisit[];
  spending: {
    total: number;
    dailyAverage: number;
    categories: { category: string; total: number; count: number }[];
    transactions: TravelTripTransaction[];
  };
  transport: {
    totalDistanceMeters: number;
    modes: {
      mode: string;
      distanceMeters: number;
      durationSeconds: number;
      segmentCount: number;
    }[];
  };
  routine: {
    codingSeconds: number;
    commitCount: number;
    comparison: {
      codingSeconds: number;
      commitCount: number;
      codingPercentChange: number | null;
      commitPercentChange: number | null;
    } | null;
  };
  health: {
    day: string;
    metric: string;
    valueAvg: number | null;
    valueMin: number | null;
    valueMax: number | null;
    valueSum: number | null;
    count: number | null;
  }[];
}

export interface TravelRoutePoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: string;
}

export interface TravelRoute {
  points: TravelRoutePoint[];
  count: number;
  rawSampledCount: number;
  maxPoints: number;
}

interface UseTravelTripsReturn {
  trips: TravelTripListItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  markNotTrip: (tripId: string) => Promise<boolean>;
  markingTripId: string | null;
}

interface UseTravelDetailReturn {
  detail: TravelTripDetail | null;
  route: TravelRoute | null;
  isLoading: boolean;
  error: string | null;
  notFound: boolean;
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

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isTimestampString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isTravelTrip(value: unknown): value is TravelTrip {
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
    isTimestampString(value.createdAt) &&
    isTimestampString(value.updatedAt)
  );
}

function isTravelTripListItem(value: unknown): value is TravelTripListItem {
  if (!isTravelTrip(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return isFiniteNumber(record.totalSpending) && isFiniteNumber(record.visitCount);
}

function isTravelTripVisit(value: unknown): value is TravelTripVisit {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isFiniteNumber(value.centerLat) &&
    isFiniteNumber(value.centerLon) &&
    isTimestampString(value.startTime) &&
    isTimestampString(value.endTime) &&
    isFiniteNumber(value.durationSeconds) &&
    isNullableString(value.placeName) &&
    isNullableString(value.address) &&
    isNullableString(value.category) &&
    isNullableString(value.city) &&
    isNullableString(value.countryName)
  );
}

function isTravelTripTransaction(value: unknown): value is TravelTripTransaction {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isFiniteNumber(value.amount) &&
    typeof value.merchant === "string" &&
    typeof value.accountName === "string" &&
    isNullableString(value.category) &&
    isTimestampString(value.transactedAt)
  );
}

function isSpendingCategory(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.category === "string" &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.count)
  );
}

function isTransportMode(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.mode === "string" &&
    isFiniteNumber(value.distanceMeters) &&
    isFiniteNumber(value.durationSeconds) &&
    isFiniteNumber(value.segmentCount)
  );
}

function isRoutineComparison(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.codingSeconds) &&
    isFiniteNumber(value.commitCount) &&
    isNullableFiniteNumber(value.codingPercentChange) &&
    isNullableFiniteNumber(value.commitPercentChange)
  );
}

function isHealthSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    isDateKey(value.day) &&
    typeof value.metric === "string" &&
    isNullableFiniteNumber(value.valueAvg) &&
    isNullableFiniteNumber(value.valueMin) &&
    isNullableFiniteNumber(value.valueMax) &&
    isNullableFiniteNumber(value.valueSum) &&
    isNullableFiniteNumber(value.count)
  );
}

export function parseTravelDetail(value: unknown): TravelTripDetail {
  if (!isRecord(value) || !isTravelTrip(value.trip)) {
    throw new Error("여행 상세 응답 형식이 올바르지 않습니다");
  }
  const { spending, transport, routine } = value;
  if (
    !Array.isArray(value.visits) ||
    !value.visits.every(isTravelTripVisit) ||
    !isRecord(spending) ||
    !isFiniteNumber(spending.total) ||
    !isFiniteNumber(spending.dailyAverage) ||
    !Array.isArray(spending.categories) ||
    !spending.categories.every(isSpendingCategory) ||
    !Array.isArray(spending.transactions) ||
    !spending.transactions.every(isTravelTripTransaction) ||
    !isRecord(transport) ||
    !isFiniteNumber(transport.totalDistanceMeters) ||
    !Array.isArray(transport.modes) ||
    !transport.modes.every(isTransportMode) ||
    !isRecord(routine) ||
    !isFiniteNumber(routine.codingSeconds) ||
    !isFiniteNumber(routine.commitCount) ||
    !(routine.comparison === null || isRoutineComparison(routine.comparison)) ||
    !Array.isArray(value.health) ||
    !value.health.every(isHealthSummary)
  ) {
    throw new Error("여행 상세 응답 형식이 올바르지 않습니다");
  }
  return value as unknown as TravelTripDetail;
}

export function parseTravelRoute(value: unknown): TravelRoute {
  if (
    !isRecord(value) ||
    !Array.isArray(value.points) ||
    !value.points.every(
      (point) =>
        isRecord(point) &&
        isFiniteNumber(point.lat) &&
        isFiniteNumber(point.lon) &&
        isNullableFiniteNumber(point.accuracy) &&
        isTimestampString(point.timestamp)
    ) ||
    !isFiniteNumber(value.count) ||
    !isFiniteNumber(value.rawSampledCount) ||
    !isFiniteNumber(value.maxPoints)
  ) {
    throw new Error("여행 경로 응답 형식이 올바르지 않습니다");
  }
  return value as unknown as TravelRoute;
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

export function removeTravelTrip(
  current: TravelTripListItem[],
  tripId: string
): TravelTripListItem[] {
  return current.filter((trip) => trip.id !== tripId);
}

export async function requestMarkNotTrip(tripId: string): Promise<void> {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/not-a-trip`, {
    method: "POST",
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === "string" ? body.error : "여행 제외 처리에 실패했습니다");
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

class TravelDetailRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TravelDetailRequestError";
  }
}

async function assertDetailResponse(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 404) {
    throw new TravelDetailRequestError("여행을 찾을 수 없습니다", 404);
  }
  throw new TravelDetailRequestError(fallbackMessage, response.status);
}

export async function requestTravelDetail(
  tripId: string,
  signal?: AbortSignal
): Promise<{ detail: TravelTripDetail; route: TravelRoute }> {
  const encodedTripId = encodeURIComponent(tripId);
  const [detailResponse, routeResponse] = await Promise.all([
    fetch(`/api/trips/${encodedTripId}`, { signal }),
    fetch(`/api/trips/${encodedTripId}/route-points`, { signal }),
  ]);
  await assertDetailResponse(detailResponse, "여행 상세를 불러오지 못했습니다");
  await assertDetailResponse(routeResponse, "여행 경로를 불러오지 못했습니다");
  const [detailValue, routeValue] = await Promise.all([
    detailResponse.json(),
    routeResponse.json(),
  ]);
  return {
    detail: parseTravelDetail(detailValue),
    route: parseTravelRoute(routeValue),
  };
}

export function useTravelTrips(enabled = true): UseTravelTripsReturn {
  const [trips, setTrips] = useState<TravelTripListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [markingTripId, setMarkingTripId] = useState<string | null>(null);
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

  const markNotTrip = useCallback(async (tripId: string) => {
    setMarkingTripId(tripId);
    setError(null);
    try {
      await requestMarkNotTrip(tripId);
      setTrips((current) => removeTravelTrip(current, tripId));
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "여행 제외 처리에 실패했습니다"
      );
      return false;
    } finally {
      setMarkingTripId(null);
    }
  }, []);

  return {
    trips,
    isLoading,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    refresh,
    markNotTrip,
    markingTripId,
  };
}

export function useTravelDetail(tripId: string, enabled = true): UseTravelDetailReturn {
  const [detail, setDetail] = useState<TravelTripDetail | null>(null);
  const [route, setRoute] = useState<TravelRoute | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!enabled || !tripId) {
      setIsLoading(false);
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);
    setRoute(null);

    void requestTravelDetail(tripId, controller.signal)
      .then((result) => {
        if (generationRef.current !== generation || controller.signal.aborted) return;
        setDetail(result.detail);
        setRoute(result.route);
      })
      .catch((loadError: unknown) => {
        if (
          isAbortError(loadError) ||
          generationRef.current !== generation ||
          controller.signal.aborted
        ) {
          return;
        }
        const missing = loadError instanceof TravelDetailRequestError && loadError.status === 404;
        setNotFound(missing);
        setError(
          loadError instanceof Error ? loadError.message : "여행 상세를 불러오지 못했습니다"
        );
        setDetail(null);
        setRoute(null);
      })
      .finally(() => {
        if (generationRef.current === generation) setIsLoading(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      });
  }, [enabled, tripId]);

  useEffect(() => {
    if (!enabled || !tripId) {
      controllerRef.current?.abort();
      generationRef.current += 1;
      setIsLoading(false);
      return;
    }
    load();
    return () => {
      controllerRef.current?.abort();
      generationRef.current += 1;
    };
  }, [enabled, load, tripId]);

  return { detail, route, isLoading, error, notFound, refresh: load };
}
