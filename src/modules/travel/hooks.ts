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
  /** Dominant non-home saved place (e.g. "본가"); null when none. */
  anchorPlaceName: string | null;
}

/** Every trip of the current year + Toss coverage, for the list hero. */
export interface TravelListSummary {
  year: number;
  trips: TravelTripListItem[];
  /** KST date of the first Toss transaction; trips ending before it have no record. */
  spendingSince: string | null;
}

export interface TravelTripsPage {
  trips: TravelTripListItem[];
  nextCursor: string | null;
  summary?: TravelListSummary;
}

export type TravelTrip = Omit<
  TravelTripListItem,
  "totalSpending" | "visitCount" | "anchorPlaceName"
>;

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
  savedPlaceName: string | null;
  savedPlaceCategory: string | null;
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
  spendingSince: string | null;
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
  summary: TravelListSummary | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  markNotTrip: (tripId: string) => Promise<boolean>;
  markingTripIds: ReadonlySet<string>;
  /** Hide now, call the API after {@link NOT_TRIP_UNDO_MS} unless undone. */
  scheduleNotTrip: (trip: TravelTripListItem) => void;
  undoNotTrip: (tripId: string) => void;
  /** Trips hidden and waiting for their undo window to close. */
  pendingNotTrips: TravelTripListItem[];
  renameTrip: (tripId: string, name: string) => Promise<boolean>;
}

/** How long "여행 아님" can be undone before the request is sent. */
export const NOT_TRIP_UNDO_MS = 6000;

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
  return (
    isFiniteNumber(record.totalSpending) &&
    isFiniteNumber(record.visitCount) &&
    (record.anchorPlaceName === undefined || isNullableString(record.anchorPlaceName))
  );
}

function withListDefaults(trip: TravelTripListItem): TravelTripListItem {
  return { ...trip, anchorPlaceName: trip.anchorPlaceName ?? null };
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
    isNullableString(value.countryName) &&
    (value.savedPlaceName === undefined || isNullableString(value.savedPlaceName)) &&
    (value.savedPlaceCategory === undefined || isNullableString(value.savedPlaceCategory))
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
    !value.health.every(isHealthSummary) ||
    !(
      value.spendingSince === undefined ||
      value.spendingSince === null ||
      isDateKey(value.spendingSince)
    )
  ) {
    throw new Error("여행 상세 응답 형식이 올바르지 않습니다");
  }
  const detail = value as unknown as TravelTripDetail;
  return {
    ...detail,
    visits: detail.visits.map((visit) => ({
      ...visit,
      savedPlaceName: visit.savedPlaceName ?? null,
      savedPlaceCategory: visit.savedPlaceCategory ?? null,
    })),
    spendingSince: detail.spendingSince ?? null,
  };
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
  const page: TravelTripsPage = {
    trips: value.trips.map(withListDefaults),
    nextCursor: value.nextCursor,
  };
  if (value.summary !== undefined) {
    const summary = value.summary;
    if (
      !isRecord(summary) ||
      !Number.isInteger(summary.year) ||
      !Array.isArray(summary.trips) ||
      !summary.trips.every(isTravelTripListItem) ||
      !(summary.spendingSince === null || isDateKey(summary.spendingSince))
    ) {
      throw new Error("여행 목록 응답 형식이 올바르지 않습니다");
    }
    page.summary = {
      year: summary.year as number,
      trips: summary.trips.map(withListDefaults),
      spendingSince: summary.spendingSince,
    };
  }
  return page;
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

export function addPendingTripId(current: ReadonlySet<string>, tripId: string): Set<string> {
  const next = new Set(current);
  next.add(tripId);
  return next;
}

export function removePendingTripId(current: ReadonlySet<string>, tripId: string): Set<string> {
  const next = new Set(current);
  next.delete(tripId);
  return next;
}

export async function requestMarkNotTrip(
  tripId: string,
  options: { keepalive?: boolean } = {}
): Promise<void> {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/not-a-trip`, {
    method: "POST",
    keepalive: options.keepalive,
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(
    typeof body?.error === "string"
      ? body.error
      : "여행에서 제외하지 못했습니다. 잠시 후 다시 시도해 주세요."
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function requestRenameTrip(tripId: string, name: string): Promise<void> {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(
    typeof body?.error === "string" ? body.error : "이름을 바꾸지 못했습니다. 다시 시도해 주세요."
  );
}

/** Applies a rename to a list without reordering it. */
export function renameTravelTrip(
  current: TravelTripListItem[],
  tripId: string,
  name: string
): TravelTripListItem[] {
  return current.map((trip) => (trip.id === tripId ? { ...trip, name } : trip));
}

async function requestTravelTripsPage(
  cursor: string | null,
  signal?: AbortSignal
): Promise<TravelTripsPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  else params.set("summary", "1");
  const response = await fetch(`/api/trips?${params.toString()}`, { signal });
  if (!response.ok) throw new Error("여행 목록을 불러오지 못했습니다");
  return parseTravelTripsPage(await response.json());
}

export class TravelTripsRequestCoordinator {
  private generation = 0;
  private readonly controllers = new Set<AbortController>();

  currentGeneration(): number {
    return this.generation;
  }

  invalidate(): number {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.generation += 1;
    return this.generation;
  }

  createRequest(generation: number): AbortController | null {
    if (generation !== this.generation) return null;
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  finishRequest(controller: AbortController): void {
    this.controllers.delete(controller);
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export async function requestCurrentTravelTripsPage(
  coordinator: TravelTripsRequestCoordinator,
  generation: number,
  cursor: string | null,
  request: (signal: AbortSignal) => Promise<TravelTripsPage> = (signal) =>
    requestTravelTripsPage(cursor, signal)
): Promise<TravelTripsPage | null> {
  const controller = coordinator.createRequest(generation);
  if (!controller) return null;
  try {
    const page = await request(controller.signal);
    return coordinator.isCurrent(generation) && !controller.signal.aborted ? page : null;
  } finally {
    coordinator.finishRequest(controller);
  }
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
  const [summary, setSummary] = useState<TravelListSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [markingTripIds, setMarkingTripIds] = useState<Set<string>>(() => new Set());
  const [pendingNotTrips, setPendingNotTrips] = useState<TravelTripListItem[]>([]);
  const markingTripIdsRef = useRef(new Set<string>());
  const requestCoordinatorRef = useRef(new TravelTripsRequestCoordinator());
  const inFlightCursorRef = useRef<string | null>(null);
  const undoTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const fetchPage = useCallback(
    async (cursor: string | null, replace: boolean, generation: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const page = await requestCurrentTravelTripsPage(
          requestCoordinatorRef.current,
          generation,
          cursor
        );
        if (!page) return;

        setTrips((current) => (replace ? page.trips : mergeTravelTrips(current, page.trips)));
        if (page.summary) setSummary(page.summary);
        setNextCursor(page.nextCursor === cursor ? null : page.nextCursor);
      } catch (fetchError) {
        if (isAbortError(fetchError) || !requestCoordinatorRef.current.isCurrent(generation))
          return;
        setError(fetchErrorMessage(fetchError));
      } finally {
        if (requestCoordinatorRef.current.isCurrent(generation)) setIsLoading(false);
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

    const generation = requestCoordinatorRef.current.invalidate();
    void fetchPage(null, true, generation);
    return () => {
      requestCoordinatorRef.current.invalidate();
    };
  }, [enabled, fetchPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || isLoading || inFlightCursorRef.current === nextCursor) return;
    inFlightCursorRef.current = nextCursor;
    void fetchPage(nextCursor, false, requestCoordinatorRef.current.currentGeneration());
  }, [fetchPage, isLoading, nextCursor]);

  const refresh = useCallback(() => {
    inFlightCursorRef.current = null;
    const generation = requestCoordinatorRef.current.invalidate();
    void fetchPage(null, true, generation);
  }, [fetchPage]);

  const markNotTrip = useCallback(
    async (tripId: string) => {
      if (markingTripIdsRef.current.has(tripId)) return false;
      markingTripIdsRef.current.add(tripId);
      setMarkingTripIds((current) => addPendingTripId(current, tripId));
      setError(null);
      try {
        await requestMarkNotTrip(tripId);
        inFlightCursorRef.current = null;
        const generation = requestCoordinatorRef.current.invalidate();
        setTrips((current) => removeTravelTrip(current, tripId));
        setSummary((current) =>
          current ? { ...current, trips: removeTravelTrip(current.trips, tripId) } : current
        );
        setNextCursor(null);
        void fetchPage(null, true, generation);
        return true;
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "여행에서 제외하지 못했습니다. 잠시 후 다시 시도해 주세요."
        );
        return false;
      } finally {
        markingTripIdsRef.current.delete(tripId);
        setMarkingTripIds((current) => removePendingTripId(current, tripId));
      }
    },
    [fetchPage]
  );

  const commitNotTrip = useCallback(
    (tripId: string) => {
      undoTimersRef.current.delete(tripId);
      void markNotTrip(tripId).finally(() => {
        setPendingNotTrips((current) => current.filter((trip) => trip.id !== tripId));
      });
    },
    [markNotTrip]
  );

  const scheduleNotTrip = useCallback(
    (trip: TravelTripListItem) => {
      if (undoTimersRef.current.has(trip.id)) return;
      setPendingNotTrips((current) => [...current.filter((t) => t.id !== trip.id), trip]);
      undoTimersRef.current.set(
        trip.id,
        setTimeout(() => commitNotTrip(trip.id), NOT_TRIP_UNDO_MS)
      );
    },
    [commitNotTrip]
  );

  const undoNotTrip = useCallback((tripId: string) => {
    const timer = undoTimersRef.current.get(tripId);
    if (timer) clearTimeout(timer);
    undoTimersRef.current.delete(tripId);
    setPendingNotTrips((current) => current.filter((trip) => trip.id !== tripId));
  }, []);

  // Leaving the page (or closing the tab) inside the undo window still sends the
  // correction — `keepalive` lets the request outlive the document.
  useEffect(() => {
    const timers = undoTimersRef.current;
    const flush = () => {
      for (const [tripId, timer] of timers) {
        clearTimeout(timer);
        void requestMarkNotTrip(tripId, { keepalive: true }).catch(() => undefined);
      }
      timers.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const renameTrip = useCallback(async (tripId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      await requestRenameTrip(tripId, trimmed);
      setTrips((current) => renameTravelTrip(current, tripId, trimmed));
      setSummary((current) =>
        current ? { ...current, trips: renameTravelTrip(current.trips, tripId, trimmed) } : current
      );
      return true;
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "이름을 바꾸지 못했습니다.");
      return false;
    }
  }, []);

  const hidden = new Set(pendingNotTrips.map((trip) => trip.id));
  const visibleTrips = hidden.size ? trips.filter((trip) => !hidden.has(trip.id)) : trips;
  const visibleSummary =
    summary && hidden.size
      ? { ...summary, trips: summary.trips.filter((trip) => !hidden.has(trip.id)) }
      : summary;

  return {
    trips: visibleTrips,
    summary: visibleSummary,
    isLoading,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    refresh,
    markNotTrip,
    markingTripIds,
    scheduleNotTrip,
    undoNotTrip,
    pendingNotTrips,
    renameTrip,
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
