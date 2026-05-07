"use client";

import { useEffect, useState } from "react";
import type { SubwayInsightsData } from "@/modules/location/services/subway-match/usage";
import type {
  AIClockResult,
  CommitHeatmapResult,
  CommuteReliabilityResult,
  DataUsageResult,
  DiscoveriesResult,
  MonthlyDigestsResult,
  NetSpendResult,
  PlaceProductivityResult,
  RepoSplitResult,
  RoutinePatternsResult,
  StreaksResult,
  SwimlaneResult,
  TransportModesResult,
  TripsResult,
  VisitsXCommitsResult,
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
  // existing
  streaks: SectionState<StreaksResult>;
  patterns: SectionState<WorkPatternsResult>;
  routines: SectionState<RoutinePatternsResult>;
  digests: SectionState<MonthlyDigestsResult>;
  commitHeatmap: SectionState<CommitHeatmapResult>;
  subway: SectionState<SubwayInsightsData>;
  // new
  swimlane: SectionState<SwimlaneResult>;
  aiClock: SectionState<AIClockResult>;
  commute: SectionState<CommuteReliabilityResult>;
  placeProductivity: SectionState<PlaceProductivityResult>;
  trips: SectionState<TripsResult>;
  transport: SectionState<TransportModesResult>;
  visitsXCommits: SectionState<VisitsXCommitsResult>;
  netSpend: SectionState<NetSpendResult>;
  repoSplit: SectionState<RepoSplitResult>;
  dataUsage: SectionState<DataUsageResult>;
  discoveries: SectionState<DiscoveriesResult>;
}

export function useInsights(year: number): UseInsightsReturn {
  const baseUrl = `/api/insights?year=${year}`;
  return {
    streaks: useSectionFetch<StreaksResult>(`${baseUrl}&section=streaks`),
    patterns: useSectionFetch<WorkPatternsResult>(`${baseUrl}&section=patterns`),
    routines: useSectionFetch<RoutinePatternsResult>(`${baseUrl}&section=routines`),
    digests: useSectionFetch<MonthlyDigestsResult>(`${baseUrl}&section=digests`),
    commitHeatmap: useSectionFetch<CommitHeatmapResult>(`${baseUrl}&section=commit-heatmap`),
    subway: useSectionFetch<SubwayInsightsData>(`${baseUrl}&section=subway`),
    swimlane: useSectionFetch<SwimlaneResult>(`${baseUrl}&section=swimlane`),
    aiClock: useSectionFetch<AIClockResult>(`${baseUrl}&section=ai-clock`),
    commute: useSectionFetch<CommuteReliabilityResult>(`${baseUrl}&section=commute-reliability`),
    placeProductivity: useSectionFetch<PlaceProductivityResult>(
      `${baseUrl}&section=place-productivity`
    ),
    trips: useSectionFetch<TripsResult>(`${baseUrl}&section=trips`),
    transport: useSectionFetch<TransportModesResult>(`${baseUrl}&section=transport-modes`),
    visitsXCommits: useSectionFetch<VisitsXCommitsResult>(`${baseUrl}&section=visits-x-commits`),
    netSpend: useSectionFetch<NetSpendResult>(`${baseUrl}&section=net-spend`),
    repoSplit: useSectionFetch<RepoSplitResult>(`${baseUrl}&section=repo-split`),
    dataUsage: useSectionFetch<DataUsageResult>(`${baseUrl}&section=data-usage`),
    discoveries: useSectionFetch<DiscoveriesResult>(`${baseUrl}&section=discoveries`),
  };
}
