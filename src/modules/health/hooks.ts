"use client";

import { useCallback, useEffect, useState } from "react";

// Re-export the shared wire contract so existing importers of these types from
// hooks keep working while the source of truth lives in one client-safe module.
export type { HealthDayPoint, HealthMetricSeries, HealthSummary } from "./types";

import type { BodyResult } from "@/modules/insights/service";
import type { HealthSummary } from "./types";

export function useHealthSummary() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, isLoading, error, refresh };
}

/** Withings body-composition data (this year), for the 체성분 card on /health. */
export function useBody() {
  const [data, setData] = useState<BodyResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/insights?section=body&year=${year}`);
        if (!res.ok) throw new Error("failed");
        const json = (await res.json()) as { data: BodyResult };
        if (!cancelled) setData(json.data);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, isLoading };
}
