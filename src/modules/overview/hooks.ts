"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "@/lib/hooks/usePageVisible";
import { toLocalDateString } from "@/lib/utils";
import { getPeriodKey, getPeriodRange, type PeriodType, periodTypes } from "./period";
import type { OverviewSnapshotResponse } from "./service";

export const OVERVIEW_POLL_INTERVAL_MS = 3_000;
export const OVERVIEW_MAX_POLLS = 200;
export const NARRATIVE_POLL_INTERVAL_MS = 10_000;
export const NARRATIVE_MAX_POLLS = 60;

export interface OverviewPeriodSelection {
  periodType: PeriodType;
  periodKey: string;
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

function isCanonicalPeriod(periodType: PeriodType, periodKey: string): boolean {
  try {
    const range = getPeriodRange(periodType, periodKey);
    const reference =
      periodType === "recent" ? new Date(range.toExclusive.getTime() - 1) : range.from;
    return getPeriodKey(periodType, reference) === periodKey;
  } catch {
    return false;
  }
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
  if (!rawPeriodKey || !isCanonicalPeriod(periodType, rawPeriodKey) || rawPeriodKey > currentKey) {
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

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, OVERVIEW_POLL_INTERVAL_MS);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

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

  useEffect(() => {
    void refreshVersion;
    const periodChanged = previousKey.current !== requestKey;
    previousKey.current = requestKey;
    if (periodChanged) {
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
      wait: delay,
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
        setError(reason instanceof Error ? reason.message : "대시보드를 불러오지 못했습니다");
        setIsLoading(false);
      }
    });

    return () => controller.abort();
  }, [enabled, periodKey, periodType, refreshVersion, requestKey, visible]);

  const recompute = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/overview/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodType, periodKey }),
      }).then((result) => recomputeResponseJson(result, periodType, periodKey));
      enqueued.current.add(requestKey);
      latest.current = response;
      setSnapshot(response);
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "재계산을 요청하지 못했습니다");
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

function narrativeDelay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, NARRATIVE_POLL_INTERVAL_MS);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
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
