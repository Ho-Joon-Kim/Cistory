"use client";

import { useCallback, useEffect, useState } from "react";

// Re-export the shared wire contract so existing importers of these types from
// hooks keep working while the source of truth lives in one client-safe module.
export type { HealthDayPoint, HealthMetricSeries, HealthSummary } from "./types";

import type { HealthSummary } from "./types";

export function useHealthSummary() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fitbit/summary");
      if (!res.ok) throw new Error("Failed to fetch health summary");
      const data = (await res.json()) as HealthSummary;
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Pull fresh data from Google Health now (no 24h gate), then re-read the summary.
  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/fitbit/sync", { method: "POST" });
      if (!res.ok) throw new Error("동기화에 실패했습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, isLoading, isSyncing, error, refresh, syncNow };
}
