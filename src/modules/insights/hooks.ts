"use client";

import { useEffect, useState } from "react";
import type { SubwayInsightsData } from "@/modules/location/services/subway-match/usage";
import type {
  AIClockResult,
  BodyResult,
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

// Shape returned by the batched (no-section) /api/insights endpoint.
interface AllInsights {
  streaks: StreaksResult;
  patterns: WorkPatternsResult;
  routines: RoutinePatternsResult;
  digests: MonthlyDigestsResult;
  commitHeatmap: CommitHeatmapResult;
  subway: SubwayInsightsData;
  swimlane: SwimlaneResult;
  aiClock: AIClockResult;
  commute: CommuteReliabilityResult;
  placeProductivity: PlaceProductivityResult;
  trips: TripsResult;
  transport: TransportModesResult;
  visitsXCommits: VisitsXCommitsResult;
  netSpend: NetSpendResult;
  repoSplit: RepoSplitResult;
  dataUsage: DataUsageResult;
  discoveries: DiscoveriesResult;
  body: BodyResult;
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
  body: SectionState<BodyResult>;
}

export function useInsights(year: number): UseInsightsReturn {
  // Fetch ALL sections in ONE request to the batched (no-section) endpoint
  // instead of firing 17 parallel per-section requests. Those 17 concurrent
  // requests each demanded their own pooled DB connection on a cold pool,
  // stampeding it — saturating every slot so unrelated requests (Better Auth
  // /get-session) and even the cron's own queries timed out acquiring a
  // connection. The batched endpoint runs the whole fan-out on a single
  // transaction connection (see src/app/api/insights/route.ts).
  const [state, setState] = useState<{
    data: AllInsights | null;
    isLoading: boolean;
    error: string | null;
  }>({ data: null, isLoading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, isLoading: true, error: null });

    fetch(`/api/insights?year=${year}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch insights");
        return res.json();
      })
      .then((json: AllInsights) => {
        if (!cancelled) setState({ data: json, isLoading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            data: null,
            isLoading: false,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year]);

  const { data, isLoading, error } = state;
  const section = <T>(value: T | undefined): SectionState<T> => ({
    data: value ?? null,
    isLoading,
    error,
  });

  return {
    streaks: section(data?.streaks),
    patterns: section(data?.patterns),
    routines: section(data?.routines),
    digests: section(data?.digests),
    commitHeatmap: section(data?.commitHeatmap),
    subway: section(data?.subway),
    swimlane: section(data?.swimlane),
    aiClock: section(data?.aiClock),
    commute: section(data?.commute),
    placeProductivity: section(data?.placeProductivity),
    trips: section(data?.trips),
    transport: section(data?.transport),
    visitsXCommits: section(data?.visitsXCommits),
    netSpend: section(data?.netSpend),
    repoSplit: section(data?.repoSplit),
    dataUsage: section(data?.dataUsage),
    discoveries: section(data?.discoveries),
    body: section(data?.body),
  };
}
