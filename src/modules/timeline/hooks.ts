"use client";

import { useCallback, useEffect, useState } from "react";

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
  repoFullName?: string;
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
    async (pageNum: number, append: boolean = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          per_page: String(perPage),
        });

        if (filters?.repoFullName) {
          params.set("repo", filters.repoFullName);
        }
        if (filters?.from) {
          params.set("from", filters.from);
        }
        if (filters?.to) {
          params.set("to", filters.to);
        }

        const response = await fetch(`/api/timeline?${params}`);

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
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [perPage, filters]
  );

  useEffect(() => {
    setPage(1);
    fetchTimeline(1);
  }, [fetchTimeline]);

  const loadMore = useCallback(() => {
    if (hasNext && !isLoading) {
      fetchTimeline(page + 1, true);
    }
  }, [hasNext, isLoading, page, fetchTimeline]);

  const refresh = useCallback(() => {
    setCommits([]);
    setPage(1);
    fetchTimeline(1);
  }, [fetchTimeline]);

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
    goToPage,
  };
}

interface UseFiltersReturn {
  filters: TimelineFilters;
  setRepoFullName: (fullName?: string) => void;
  setDateRange: (from?: string, to?: string) => void;
  clearFilters: () => void;
}

export function useFilters(): UseFiltersReturn {
  const [filters, setFilters] = useState<TimelineFilters>({});

  const setRepoFullName = useCallback((fullName?: string) => {
    setFilters((prev) => ({ ...prev, repoFullName: fullName }));
  }, []);

  const setDateRange = useCallback((from?: string, to?: string) => {
    setFilters((prev) => ({ ...prev, from, to }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  return {
    filters,
    setRepoFullName,
    setDateRange,
    clearFilters,
  };
}
