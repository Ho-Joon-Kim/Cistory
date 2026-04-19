"use client";

import { useEffect, useState } from "react";
import type {
  CommitHeatmapResult,
  MonthlyDigestsResult,
  RoutinePatternsResult,
  StreaksResult,
  WorkPatternsResult,
} from "./service";

export interface SectionState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

function useSectionFetch<T>(url: string | null): SectionState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch section");
        return res.json();
      })
      .then((json: { data: T }) => {
        if (!cancelled) setData(json.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, isLoading, error };
}

export interface UseInsightsReturn {
  streaks: SectionState<StreaksResult>;
  patterns: SectionState<WorkPatternsResult>;
  routines: SectionState<RoutinePatternsResult>;
  digests: SectionState<MonthlyDigestsResult>;
  commitHeatmap: SectionState<CommitHeatmapResult>;
}

export function useInsights(year: number): UseInsightsReturn {
  const baseUrl = `/api/insights?year=${year}`;

  const streaks = useSectionFetch<StreaksResult>(`${baseUrl}&section=streaks`);
  const patterns = useSectionFetch<WorkPatternsResult>(`${baseUrl}&section=patterns`);
  const routines = useSectionFetch<RoutinePatternsResult>(`${baseUrl}&section=routines`);
  const digests = useSectionFetch<MonthlyDigestsResult>(`${baseUrl}&section=digests`);
  const commitHeatmap = useSectionFetch<CommitHeatmapResult>(`${baseUrl}&section=commit-heatmap`);

  return { streaks, patterns, routines, digests, commitHeatmap };
}
