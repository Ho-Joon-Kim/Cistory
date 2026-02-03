"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TimelineCommit {
  id: string;
  sha: string;
  message: string;
  authorName: string;
  authorAvatarUrl: string | null;
  committedAt: string;
  additions: number;
  deletions: number;
  changedFilesCount: number;
  isMergeCommit: boolean;
  repository: {
    fullName: string;
    id: number | null;
    isPrivate: boolean | null;
  };
  summary: {
    status: string;
    summary: string | null;
  } | null;
}

export interface TimelineFilters {
  repoFullNames?: string[];
  from?: string;
  to?: string;
}

interface UseTimelineOptions {
  perPage?: number;
  filters?: TimelineFilters;
}

interface UseTimelineReturn {
  commits: TimelineCommit[];
  isLoading: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  loadMore: () => void;
  refresh: () => void;
  fetchNew: () => void;
  goToPage: (page: number) => void;
}

export function useTimeline(options: UseTimelineOptions = {}): UseTimelineReturn {
  const { perPage = 20, filters } = options;

  const [commits, setCommits] = useState<TimelineCommit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);

  const fetchTimeline = useCallback(
    async (pageNum: number, append: boolean = false, signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          per_page: String(perPage),
        });

        if (filters?.repoFullNames && filters.repoFullNames.length > 0) {
          params.set("repos", filters.repoFullNames.join(","));
        }
        if (filters?.from) {
          params.set("from", filters.from);
        }
        if (filters?.to) {
          params.set("to", filters.to);
        }

        const response = await fetch(`/api/timeline?${params}`, { signal });

        if (!response.ok) {
          throw new Error("Failed to fetch timeline");
        }

        const data = (await response.json()) as {
          commits: TimelineCommit[];
          pagination: {
            page: number;
            totalPages: number;
            hasNext: boolean;
            hasPrev: boolean;
          };
        };

        setCommits((prev) =>
          append ? [...prev, ...data.commits] : data.commits
        );
        setPage(data.pagination.page);
        setTotalPages(data.pagination.totalPages);
        setHasNext(data.pagination.hasNext);
        setHasPrev(data.pagination.hasPrev);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [perPage, filters]
  );

  useEffect(() => {
    const controller = new AbortController();
    setPage(1);
    fetchTimeline(1, false, controller.signal);
    return () => controller.abort();
  }, [fetchTimeline]);

  const loadMore = useCallback(() => {
    if (hasNext && !isLoading) {
      fetchTimeline(page + 1, true);
    }
  }, [hasNext, isLoading, page, fetchTimeline]);

  const commitsRef = useRef<TimelineCommit[]>([]);
  commitsRef.current = commits;

  const refresh = useCallback(() => {
    setPage(1);
    fetchTimeline(1);
  }, [fetchTimeline]);

  const fetchNew = useCallback(async () => {
    const current = commitsRef.current;
    if (current.length === 0) {
      fetchTimeline(1);
      return;
    }

    const latestCommittedAt = current[0].committedAt;
    const params = new URLSearchParams({
      after: latestCommittedAt,
      per_page: "200",
    });

    if (filters?.repoFullNames && filters.repoFullNames.length > 0) {
      params.set("repos", filters.repoFullNames.join(","));
    }

    try {
      const response = await fetch(`/api/timeline?${params}`);
      if (!response.ok) return;

      const data = (await response.json()) as { commits: TimelineCommit[] };
      if (data.commits.length > 0) {
        setCommits((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const newCommits = data.commits.filter((c) => !existingIds.has(c.id));
          return [...newCommits, ...prev];
        });
      }
    } catch {
      // silent fail
    }
  }, [filters, fetchTimeline]);

  const goToPage = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPages) {
        fetchTimeline(newPage);
      }
    },
    [totalPages, fetchTimeline]
  );

  return {
    commits,
    isLoading,
    error,
    page,
    totalPages,
    hasNext,
    hasPrev,
    loadMore,
    refresh,
    fetchNew,
    goToPage,
  };
}

interface UseFiltersReturn {
  filters: TimelineFilters;
  setRepoFullNames: (fullNames: string[]) => void;
  setDateRange: (from?: string, to?: string) => void;
  clearFilters: () => void;
}

export function useFilters(initialRepos?: string[]): UseFiltersReturn {
  const [filters, setFilters] = useState<TimelineFilters>(() => ({
    repoFullNames: initialRepos,
  }));

  const setRepoFullNames = useCallback((fullNames: string[]) => {
    setFilters((prev) => ({
      ...prev,
      repoFullNames: fullNames.length > 0 ? fullNames : undefined
    }));
  }, []);

  const setDateRange = useCallback((from?: string, to?: string) => {
    setFilters((prev) => ({ ...prev, from, to }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  return {
    filters,
    setRepoFullNames,
    setDateRange,
    clearFilters,
  };
}
