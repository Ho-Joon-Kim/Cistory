"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "@/lib/hooks/usePageVisible";
import { userErrorMessage } from "@/lib/user-error";
import { toLocalDateString } from "@/lib/utils";
import type { SearchResponse } from "@/modules/search/types";
import type { OverviewHistoryResponse } from "./history";
import {
  getPeriodKey,
  getPeriodRange,
  isCanonicalPeriodKey,
  type PeriodType,
  periodTypes,
} from "./period";
import type { OverviewSnapshotResponse } from "./service";
import type { StayFocus } from "./view/flow";

export const OVERVIEW_POLL_INTERVAL_MS = 3_000;
export const OVERVIEW_MAX_POLLS = 200;
export const NARRATIVE_POLL_INTERVAL_MS = 10_000;
export const NARRATIVE_MAX_POLLS = 60;

export interface OverviewPeriodSelection {
  periodType: PeriodType;
  periodKey: string;
}

interface OverviewRequestIdentity {
  requestKey: string;
  generation: number;
}

export function isCurrentOverviewRequest(
  request: OverviewRequestIdentity,
  currentRequestKey: string,
  currentGeneration: number
): boolean {
  return request.requestKey === currentRequestKey && request.generation === currentGeneration;
}

function kstWallClock(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== "literal") values[part.type] = part.value;
      return values;
    }, {});
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

export function currentOverviewPeriodKey(periodType: PeriodType, now: Date = new Date()): string {
  return getPeriodKey(periodType, kstWallClock(now));
}

export function resolveOverviewPeriod(
  rawPeriodType: string | null,
  rawPeriodKey: string | null,
  now: Date = new Date()
): OverviewPeriodSelection {
  const periodType = periodTypes.includes(rawPeriodType as PeriodType)
    ? (rawPeriodType as PeriodType)
    : "recent";
  const currentKey = currentOverviewPeriodKey(periodType, now);
  if (
    !rawPeriodKey ||
    !isCanonicalPeriodKey(periodType, rawPeriodKey) ||
    rawPeriodKey > currentKey
  ) {
    return { periodType, periodKey: currentKey };
  }
  return { periodType, periodKey: rawPeriodKey };
}

export function adjacentOverviewPeriod(
  periodType: PeriodType,
  periodKey: string,
  direction: -1 | 1,
  now: Date = new Date()
) {
  const range = getPeriodRange(periodType, periodKey);
  let reference: Date;

  if (direction === -1) {
    reference = new Date(range.from);
    reference.setDate(reference.getDate() - 1);
  } else {
    reference = new Date(range.toExclusive);
    if (periodType === "recent") reference.setDate(reference.getDate() + 13);
  }

  const nextKey = getPeriodKey(periodType, reference);
  return {
    periodType,
    periodKey: nextKey,
    isFuture: nextKey > currentOverviewPeriodKey(periodType, now),
  };
}

export function overviewPeriodLabel(periodType: PeriodType, periodKey: string): string {
  const range = getPeriodRange(periodType, periodKey);
  const end = new Date(range.toExclusive);
  end.setDate(end.getDate() - 1);
  const date = (value: Date) =>
    new Date(`${toLocalDateString(value)}T00:00:00+09:00`).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  if (periodType === "year") return `${periodKey}년`;
  if (periodType === "month") return `${periodKey.slice(0, 4)}년 ${Number(periodKey.slice(5))}월`;
  return `${date(range.from)} – ${date(end)}`;
}

type Wait = (signal: AbortSignal) => Promise<void>;

interface PollingInput {
  get: (signal: AbortSignal) => Promise<OverviewSnapshotResponse>;
  enqueue: (signal: AbortSignal) => Promise<OverviewSnapshotResponse>;
  wait: Wait;
  isVisible: () => boolean;
  enqueued: Set<string>;
  periodType: PeriodType;
  periodKey: string;
  maxPolls: number;
  signal: AbortSignal;
  onUpdate: (response: OverviewSnapshotResponse) => void;
}

function pendingResponse(periodType: PeriodType, periodKey: string): OverviewSnapshotResponse {
  return { status: "pending", periodType, periodKey };
}

export async function loadOverviewUntilSettled(input: PollingInput) {
  const requestKey = `${input.periodType}:${input.periodKey}`;
  let response = await input.get(input.signal);
  input.onUpdate(response);

  if (response.status === "missing") {
    if (!input.enqueued.has(requestKey)) {
      response = await input.enqueue(input.signal);
      input.enqueued.add(requestKey);
    } else {
      response = pendingResponse(input.periodType, input.periodKey);
    }
    input.onUpdate(response);
  }

  let polls = 0;
  while (
    (response.status === "pending" || response.status === "computing") &&
    input.isVisible() &&
    polls < input.maxPolls
  ) {
    await input.wait(input.signal);
    if (input.signal.aborted || !input.isVisible()) break;
    response = await input.get(input.signal);
    input.onUpdate(response);
    polls++;
  }
  if (
    (response.status === "pending" || response.status === "computing") &&
    input.isVisible() &&
    !input.signal.aborted &&
    polls >= input.maxPolls
  ) {
    throw new Error("계산 대기 시간이 초과되었습니다. 다시 계산을 시도해 주세요.");
  }
  return response;
}

async function responseJson(response: Response): Promise<OverviewSnapshotResponse> {
  const body = (await response.json()) as OverviewSnapshotResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "대시보드 요청에 실패했습니다");
  return body;
}

export async function recomputeResponseJson(
  response: Response,
  periodType: PeriodType,
  periodKey: string
): Promise<OverviewSnapshotResponse> {
  const body = (await response.json()) as OverviewSnapshotResponse & {
    error?: string;
    code?: string;
  };
  if (response.status === 409 && body.code === "PERIOD_COMPUTING") {
    return { status: "computing", periodType, periodKey };
  }
  if (!response.ok) throw new Error(body.error ?? "재계산 요청에 실패했습니다");
  return body;
}

/**
 * Message safe to show under an overview error state — the shared
 * {@link userErrorMessage} with an overview-specific fallback.
 */
export function overviewErrorMessage(reason: unknown, fallback: string): string {
  return userErrorMessage(reason, fallback);
}

export function abortableDelay(signal: AbortSignal, intervalMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const snapshotDelay: Wait = (signal) => abortableDelay(signal, OVERVIEW_POLL_INTERVAL_MS);
const narrativeDelay: Wait = (signal) => abortableDelay(signal, NARRATIVE_POLL_INTERVAL_MS);

export function useOverviewSnapshot(periodType: PeriodType, periodKey: string, enabled = true) {
  const visible = usePageVisible();
  const [snapshot, setSnapshot] = useState<OverviewSnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const enqueued = useRef(new Set<string>());
  const latest = useRef<OverviewSnapshotResponse | null>(null);
  const requestKey = `${periodType}:${periodKey}`;
  const previousKey = useRef(requestKey);
  const currentRequestKey = useRef(requestKey);
  const recomputeGeneration = useRef(0);
  const recomputeController = useRef<AbortController | null>(null);
  currentRequestKey.current = requestKey;

  useEffect(() => {
    return () => {
      recomputeGeneration.current++;
      recomputeController.current?.abort();
      recomputeController.current = null;
    };
  }, []);

  useEffect(() => {
    void refreshVersion;
    const periodChanged = previousKey.current !== requestKey;
    previousKey.current = requestKey;
    if (periodChanged) {
      recomputeGeneration.current++;
      recomputeController.current?.abort();
      recomputeController.current = null;
      latest.current = null;
      setSnapshot(null);
      setIsLoading(true);
      setError(null);
    }
    if (!enabled) return;
    if (
      !visible &&
      (latest.current?.status === "pending" || latest.current?.status === "computing")
    ) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ periodType, periodKey });
    const get = (signal: AbortSignal) =>
      fetch(`/api/overview?${params.toString()}`, { signal }).then(responseJson);
    const enqueue = (signal: AbortSignal) =>
      fetch("/api/overview/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodType, periodKey }),
        signal,
      }).then((response) => recomputeResponseJson(response, periodType, periodKey));

    loadOverviewUntilSettled({
      get,
      enqueue,
      wait: snapshotDelay,
      isVisible: () => visible,
      enqueued: enqueued.current,
      periodType,
      periodKey,
      maxPolls: OVERVIEW_MAX_POLLS,
      signal: controller.signal,
      onUpdate: (next) => {
        latest.current = next;
        setSnapshot(next);
        setIsLoading(false);
        setError(null);
      },
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (!controller.signal.aborted) {
        setError(
          overviewErrorMessage(reason, "개요를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")
        );
        setIsLoading(false);
      }
    });

    return () => controller.abort();
  }, [enabled, periodKey, periodType, refreshVersion, requestKey, visible]);

  const recompute = useCallback(async () => {
    const controller = new AbortController();
    const request = {
      requestKey,
      generation: recomputeGeneration.current + 1,
    };
    recomputeGeneration.current = request.generation;
    recomputeController.current?.abort();
    recomputeController.current = controller;

    try {
      setError(null);
      const response = await fetch("/api/overview/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodType, periodKey }),
        signal: controller.signal,
      }).then((result) => recomputeResponseJson(result, periodType, periodKey));
      if (
        controller.signal.aborted ||
        !isCurrentOverviewRequest(request, currentRequestKey.current, recomputeGeneration.current)
      ) {
        return;
      }
      enqueued.current.add(requestKey);
      latest.current = response;
      setSnapshot(response);
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        !isCurrentOverviewRequest(request, currentRequestKey.current, recomputeGeneration.current)
      ) {
        return;
      }
      setError(
        overviewErrorMessage(reason, "재계산을 요청하지 못했어요. 잠시 후 다시 시도해 주세요.")
      );
    } finally {
      if (recomputeController.current === controller) {
        recomputeController.current = null;
      }
    }
  }, [periodKey, periodType, requestKey]);

  return { snapshot, error, isLoading, recompute };
}

interface OverviewNarrativeResponse {
  status: "missing" | "pending" | "generating" | "ready" | "failed";
  content?: string | null;
  generatedAt?: string | null;
}

interface NarrativePollingInput {
  get: (signal: AbortSignal) => Promise<OverviewNarrativeResponse>;
  wait: Wait;
  isVisible: () => boolean;
  maxPolls: number;
  signal: AbortSignal;
  onUpdate: (response: OverviewNarrativeResponse) => void;
}

export async function loadNarrativeUntilSettled(input: NarrativePollingInput) {
  let response = await input.get(input.signal);
  input.onUpdate(response);
  let polls = 0;
  while (
    (response.status === "missing" ||
      response.status === "pending" ||
      response.status === "generating") &&
    input.isVisible() &&
    polls < input.maxPolls
  ) {
    await input.wait(input.signal);
    if (input.signal.aborted || !input.isVisible()) break;
    response = await input.get(input.signal);
    input.onUpdate(response);
    polls++;
  }
  return response;
}

export function useOverviewNarrative(periodType: PeriodType, periodKey: string, enabled: boolean) {
  const [narrative, setNarrative] = useState<OverviewNarrativeResponse | null>(null);
  const visible = usePageVisible();
  const latest = useRef<OverviewNarrativeResponse | null>(null);
  const requestKey = `${periodType}:${periodKey}`;
  const previousKey = useRef(requestKey);

  useEffect(() => {
    if (previousKey.current !== requestKey) {
      previousKey.current = requestKey;
      latest.current = null;
      setNarrative(null);
    }
    if (!enabled || periodType === "recent") {
      latest.current = null;
      setNarrative(null);
      return;
    }
    if (latest.current?.status === "ready" || latest.current?.status === "failed") return;
    if (!visible && latest.current) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ periodType, periodKey });
    const get = (signal: AbortSignal) =>
      fetch(`/api/overview/narrative?${params.toString()}`, { signal }).then(async (response) => {
        if (!response.ok) throw new Error("회고문을 불러오지 못했습니다");
        return (await response.json()) as OverviewNarrativeResponse;
      });
    loadNarrativeUntilSettled({
      get,
      wait: narrativeDelay,
      isVisible: () => visible,
      maxPolls: NARRATIVE_MAX_POLLS,
      signal: controller.signal,
      onUpdate: (response) => {
        latest.current = response;
        setNarrative(response);
      },
    }).catch((reason: unknown) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setNarrative(null);
    });
    return () => controller.abort();
  }, [enabled, periodKey, periodType, requestKey, visible]);

  return narrative;
}

/**
 * Stored-only period history for the hero (previous period + recent bars). Never
 * enqueues work; refetches when `refreshKey` changes (e.g. the snapshot's
 * computedAt), so a recompute is reflected once it lands.
 */
export function useOverviewHistory(
  periodType: PeriodType,
  periodKey: string,
  enabled: boolean,
  refreshKey: string | null
) {
  const [history, setHistory] = useState<OverviewHistoryResponse | null>(null);
  useEffect(() => {
    void refreshKey;
    if (!enabled || periodType === "recent") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ periodType, periodKey });
    fetch(`/api/overview/history?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("history unavailable");
        return (await response.json()) as OverviewHistoryResponse;
      })
      .then((body) => setHistory(body))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // History only adds comparisons; the page renders without it.
        setHistory(null);
      });
    return () => controller.abort();
  }, [enabled, periodKey, periodType, refreshKey]);
  return history;
}

/**
 * KST days in the period with a visit to `focus.area` — the snapshot has no
 * per-day place data, so the flow chart's stay span reads the owner-scoped
 * record search (visits matching the area's city). A few pages at most.
 * Throws on any failed page — a partial day list would be cached as if
 * complete; the hook reads an error as "no data".
 */
export async function fetchStayDays(focus: StayFocus, signal?: AbortSignal): Promise<string[]> {
  const days = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      q: focus.area,
      source: "visit",
      from: focus.from,
      to: focus.to,
      page: String(page),
    });
    const response = await fetch(`/api/search?${params.toString()}`, { signal });
    if (!response.ok) throw new Error(`stay days: HTTP ${response.status}`);
    const body = (await response.json()) as SearchResponse;
    for (const item of body.items) if (item.source === "visit") days.add(item.date);
    if (!body.hasMore) break;
  }
  return [...days];
}

export function useStayDays(focus: StayFocus | null): string[] {
  const { data } = useQuery({
    queryKey: ["overview", "stay-days", focus?.area, focus?.from, focus?.to],
    enabled: focus != null,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => (focus ? fetchStayDays(focus, signal) : []),
  });
  // An error leaves `data` undefined: no stay days are highlighted.
  return data ?? [];
}

/** Payment counts per category; throws on a failed response (never cached as data). */
export async function fetchCategoryPaymentCounts(
  range: { from: string; to: string },
  signal?: AbortSignal
): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    bucket: "spending",
    limit: "1",
  });
  const response = await fetch(`/api/spending?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`category counts: HTTP ${response.status}`);
  const body = (await response.json()) as {
    summary?: { categoryBreakdown?: { category: string | null; count: number }[] };
  };
  const counts: Record<string, number> = {};
  for (const row of body.summary?.categoryBreakdown ?? []) {
    counts[row.category ?? "uncategorized"] = row.count;
  }
  return counts;
}

/**
 * Spending payment counts per category for a date range (the snapshot carries
 * only totals), used to flag categories driven by one or two payments.
 */
export function useCategoryPaymentCounts(
  range: { from: string; to: string } | null
): Record<string, number> | null {
  const { data } = useQuery({
    queryKey: ["overview", "category-counts", range?.from, range?.to],
    enabled: range != null,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => (range ? fetchCategoryPaymentCounts(range, signal) : null),
  });
  // An error leaves `data` undefined: no category is flagged.
  return data ?? null;
}
