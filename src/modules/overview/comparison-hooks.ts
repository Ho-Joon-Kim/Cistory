"use client";

import { useEffect, useState } from "react";
import { loadStoredOverviewComparison } from "./comparison";
import type { OverviewSnapshotResponse } from "./service";

export function useStoredOverviewComparison(year1: string, year2: string, enabled: boolean) {
  const [snapshots, setSnapshots] = useState<
    [OverviewSnapshotResponse, OverviewSnapshotResponse] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSnapshots(null);
    setError(null);
    setIsLoading(true);
    if (!enabled) return;

    const controller = new AbortController();
    loadStoredOverviewComparison(year1, year2, controller.signal)
      .then((result) => setSnapshots(result))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "연간 비교를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [enabled, year1, year2]);

  return { snapshots, error, isLoading };
}
