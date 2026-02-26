"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CodingSectionData,
  CommitsSectionData,
  CrossAnalysisData,
  EnrichedCodingSectionData,
  EnrichedCommitsSectionData,
  EnrichedLocationSectionData,
  LocationSectionData,
  YearlyCodingSectionData,
  YearlyCommitsSectionData,
} from "./types";

export interface SectionState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseReportReturn<TCommits, TCoding, TLocation> {
  commits: SectionState<TCommits>;
  coding: SectionState<TCoding>;
  location: SectionState<TLocation>;
  enrichedCommits: SectionState<EnrichedCommitsSectionData>;
  enrichedCoding: SectionState<EnrichedCodingSectionData>;
  enrichedLocation: SectionState<EnrichedLocationSectionData>;
  crossAnalysis: SectionState<CrossAnalysisData>;
  isLoading: boolean;
  hasAnyData: boolean;
  narrative: string | null;
  isGeneratingNarrative: boolean;
  error: string | null;
  generateNarrative: () => void;
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

export function useMonthlyReport(
  yearMonth: string | null
): UseReportReturn<CommitsSectionData, CodingSectionData, LocationSectionData> {
  const baseUrl = yearMonth ? `/api/reports/monthly?yearMonth=${yearMonth}` : null;

  const commits = useSectionFetch<CommitsSectionData>(
    baseUrl ? `${baseUrl}&section=commits` : null
  );
  const coding = useSectionFetch<CodingSectionData>(baseUrl ? `${baseUrl}&section=coding` : null);
  const location = useSectionFetch<LocationSectionData>(
    baseUrl ? `${baseUrl}&section=location` : null
  );

  // Enriched data (loaded in parallel with base data)
  const enrichedCommits = useSectionFetch<EnrichedCommitsSectionData>(
    baseUrl ? `${baseUrl}&section=commits&enriched=true` : null
  );
  const enrichedCoding = useSectionFetch<EnrichedCodingSectionData>(
    baseUrl ? `${baseUrl}&section=coding&enriched=true` : null
  );
  const enrichedLocation = useSectionFetch<EnrichedLocationSectionData>(
    baseUrl ? `${baseUrl}&section=location&enriched=true` : null
  );
  const crossAnalysis = useSectionFetch<CrossAnalysisData>(
    baseUrl ? `${baseUrl}&section=cross` : null
  );

  const isLoading = commits.isLoading || coding.isLoading || location.isLoading;
  const hasAnyData = !!(commits.data || coding.data || location.data);
  const error = commits.error || coding.error || location.error;

  const [narrative, setNarrative] = useState<string | null>(null);
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  // Reset narrative when period changes
  useEffect(() => {
    setNarrative(null);
  }, [yearMonth]);

  const generateNarrative = useCallback(async () => {
    if (!yearMonth) return;

    setIsGeneratingNarrative(true);
    setNarrativeError(null);

    try {
      const res = await fetch("/api/reports/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });

      if (!res.ok) throw new Error("Failed to generate narrative");

      const json = (await res.json()) as { narrative: string };
      setNarrative(json.narrative);
    } catch (e) {
      setNarrativeError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGeneratingNarrative(false);
    }
  }, [yearMonth]);

  return {
    commits,
    coding,
    location,
    enrichedCommits,
    enrichedCoding,
    enrichedLocation,
    crossAnalysis,
    isLoading,
    hasAnyData,
    narrative,
    isGeneratingNarrative,
    error: narrativeError || error,
    generateNarrative,
  };
}

export function useYearlyReport(
  year: string | null
): UseReportReturn<YearlyCommitsSectionData, YearlyCodingSectionData, LocationSectionData> {
  const baseUrl = year ? `/api/reports/yearly?year=${year}` : null;

  const commits = useSectionFetch<YearlyCommitsSectionData>(
    baseUrl ? `${baseUrl}&section=commits` : null
  );
  const coding = useSectionFetch<YearlyCodingSectionData>(
    baseUrl ? `${baseUrl}&section=coding` : null
  );
  const location = useSectionFetch<LocationSectionData>(
    baseUrl ? `${baseUrl}&section=location` : null
  );

  // Enriched data (loaded in parallel with base data)
  const enrichedCommits = useSectionFetch<EnrichedCommitsSectionData>(
    baseUrl ? `${baseUrl}&section=commits&enriched=true` : null
  );
  const enrichedCoding = useSectionFetch<EnrichedCodingSectionData>(
    baseUrl ? `${baseUrl}&section=coding&enriched=true` : null
  );
  const enrichedLocation = useSectionFetch<EnrichedLocationSectionData>(
    baseUrl ? `${baseUrl}&section=location&enriched=true` : null
  );
  const crossAnalysis = useSectionFetch<CrossAnalysisData>(
    baseUrl ? `${baseUrl}&section=cross` : null
  );

  const isLoading = commits.isLoading || coding.isLoading || location.isLoading;
  const hasAnyData = !!(commits.data || coding.data || location.data);
  const error = commits.error || coding.error || location.error;

  const [narrative, setNarrative] = useState<string | null>(null);
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  // Reset narrative when period changes
  useEffect(() => {
    setNarrative(null);
  }, [year]);

  const generateNarrative = useCallback(async () => {
    if (!year) return;

    setIsGeneratingNarrative(true);
    setNarrativeError(null);

    try {
      const res = await fetch("/api/reports/yearly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });

      if (!res.ok) throw new Error("Failed to generate narrative");

      const json = (await res.json()) as { narrative: string };
      setNarrative(json.narrative);
    } catch (e) {
      setNarrativeError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGeneratingNarrative(false);
    }
  }, [year]);

  return {
    commits,
    coding,
    location,
    enrichedCommits,
    enrichedCoding,
    enrichedLocation,
    crossAnalysis,
    isLoading,
    hasAnyData,
    narrative,
    isGeneratingNarrative,
    error: narrativeError || error,
    generateNarrative,
  };
}
