"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const POLL_INTERVAL_MS = 60_000;

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
}

export interface CodingSessionData {
  id: string;
  project: string | null;
  startedAt: string;
  durationSeconds: number;
  humanAdditions: number | null;
  humanDeletions: number | null;
  aiAdditions: number | null;
  aiDeletions: number | null;
}

interface CodingSessionsResponse {
  sessions: CodingSessionData[];
  count: number;
}

export function useCodingSessions(date: string) {
  const [sessions, setSessions] = useState<CodingSessionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, CodingSessionData[]>>(new Map());

  const fetchSessions = useCallback(
    async (targetDate: string, signal: AbortSignal, silent = false) => {
      if (!silent) {
        const cached = cache.current.get(targetDate);
        if (cached) {
          setSessions(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) setIsLoading(true);

      try {
        const tz = new Date().getTimezoneOffset();
        const response = await fetch(
          `/api/timeline/coding-sessions?date=${targetDate}&tz=${tz}`,
          { signal }
        );
        if (!response.ok) throw new Error("Failed to fetch coding sessions");

        const data = (await response.json()) as CodingSessionsResponse;

        if (silent) {
          const prev = cache.current.get(targetDate);
          if (
            prev &&
            prev.length === data.sessions.length &&
            prev.at(-1)?.startedAt === data.sessions.at(-1)?.startedAt
          ) {
            return;
          }
        }

        cache.current.set(targetDate, data.sessions);
        setSessions(data.sessions);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) setSessions([]);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!date) return;

    const controller = new AbortController();
    fetchSessions(date, controller.signal);

    if (!isToday(date)) return () => controller.abort();

    const interval = setInterval(() => {
      fetchSessions(date, controller.signal, true);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [date, fetchSessions]);

  return { sessions, isLoading };
}

export interface CodingStatData {
  date: string;
  totalSeconds: number;
  projects: { name: string; totalSeconds: number }[];
  languages: { name: string; totalSeconds: number }[];
  editors: { name: string; totalSeconds: number }[];
  categories: { name: string; totalSeconds: number }[];
}

interface CodingStatsResponse {
  stats: CodingStatData[];
}

export function useCodingStats(dateFrom: string, dateTo: string) {
  const [stats, setStats] = useState<CodingStatData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cache = useRef<Map<string, CodingStatData[]>>(new Map());

  const fetchStats = useCallback(
    async (from: string, to: string, signal: AbortSignal, silent = false) => {
      const cacheKey = `${from}:${to}`;

      if (!silent) {
        const cached = cache.current.get(cacheKey);
        if (cached) {
          setStats(cached);
          setIsLoading(false);
          return;
        }
      }

      if (!silent) setIsLoading(true);

      try {
        const response = await fetch(
          `/api/timeline/coding-stats?from=${from}&to=${to}`,
          { signal }
        );
        if (!response.ok) throw new Error("Failed to fetch coding stats");

        const data = (await response.json()) as CodingStatsResponse;

        cache.current.set(cacheKey, data.stats);
        setStats(data.stats);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) setStats([]);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!dateFrom || !dateTo) return;

    const controller = new AbortController();
    fetchStats(dateFrom, dateTo, controller.signal);

    const today = new Date().toISOString().slice(0, 10);
    if (today >= dateFrom && today <= dateTo) {
      const interval = setInterval(() => {
        cache.current.delete(`${dateFrom}:${dateTo}`);
        fetchStats(dateFrom, dateTo, controller.signal, true);
      }, POLL_INTERVAL_MS);

      return () => {
        controller.abort();
        clearInterval(interval);
      };
    }

    return () => controller.abort();
  }, [dateFrom, dateTo, fetchStats]);

  return { stats, isLoading };
}
