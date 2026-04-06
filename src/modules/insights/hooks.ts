"use client";

import { useState, useEffect, useCallback } from "react";

interface SectionState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

function useSectionFetch<T>(url: string, enabled = true): SectionState<T> & { refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("데이터를 가져오는데 실패했습니다");
      }
      const result = (await response.json()) as T;
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setIsLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

export function useInsights(year: number) {
  const streaks = useSectionFetch<{
    currentCommitStreak: number;
    maxCommitStreak: number;
    calendar: Record<string, { hasCommit: boolean }>;
  }>(`/api/insights?year=${year}&section=streaks`);

  const patterns = useSectionFetch<{
    avgFirstCommitHour: number;
    avgLastCommitHour: number;
    mostProductiveHour: number;
    mostProductiveDay: number;
    nightRatio: number;
    weekendRatio: number;
    totalCommits: number;
  }>(`/api/insights?year=${year}&section=patterns`);

  const routines = useSectionFetch<{
    dayPatterns: { day: number; commits: number }[];
  }>(`/api/insights?year=${year}&section=routines`);

  const digests = useSectionFetch<{
    months: {
      month: number;
      totalCommits: number;
      topProject: string | null;
    }[];
  }>(`/api/insights?year=${year}&section=digests`);

  const commitHeatmap = useSectionFetch<{
    days: { date: string; count: number }[];
  }>(`/api/insights?year=${year}&section=commit-heatmap`);

  return { streaks, patterns, routines, digests, commitHeatmap };
}
