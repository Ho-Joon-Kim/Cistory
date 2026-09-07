"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { toLocalDateString } from "@/lib/utils";
import type { TransactionItem } from "@/modules/spending/hooks";

export interface Repository {
  fullName: string;
  id: number | null;
  isPrivate: boolean | null;
  commitCount: number;
  lastCommitAt: string;
}

interface UseRepositoriesReturn {
  repositories: Repository[];
  isLoading: boolean;
  refresh: () => void;
}

export function useRepositories(enabled = true): UseRepositoriesReturn {
  const [state, setState] = useState<{ repositories: Repository[]; isLoading: boolean }>({
    repositories: [],
    isLoading: true,
  });

  const fetchRepos = useCallback(async (signal?: AbortSignal) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await fetch("/api/timeline/repos", { signal });
      if (response.ok) {
        const data = (await response.json()) as { repositories: Repository[] };
        setState({ repositories: data.repositories, isLoading: false });
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to fetch repositories:", err);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchRepos(controller.signal);
    return () => controller.abort();
  }, [enabled, fetchRepos]);

  const refresh = useCallback(() => {
    fetchRepos();
  }, [fetchRepos]);

  return { ...state, refresh };
}

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

        setCommits((prev) => (append ? [...prev, ...data.commits] : data.commits));
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

// --- Transactions for a single date (used in unified timeline) ---

export function transactionsForDateOptions(sessionId: string | undefined, date: string) {
  return queryOptions({
    queryKey: ["transactions", sessionId, date],
    enabled: !!sessionId && !!date,
    queryFn: async ({ signal }): Promise<TransactionItem[]> => {
      const params = new URLSearchParams({ from: date, to: date, limit: "100", offset: "0" });
      const response = await fetch(`/api/spending?${params}`, { signal });
      if (!response.ok) throw new Error("거래 내역을 불러오지 못했습니다.");
      const data = (await response.json()) as { transactions: TransactionItem[] };
      return data.transactions;
    },
    staleTime: 30_000,
    refetchInterval: date === toLocalDateString(new Date()) ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useTransactionsForDate(date: string) {
  const { data: session } = useSession();
  const query = useQuery(transactionsForDateOptions(session?.session.id, date));
  return {
    transactions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => {
      void query.refetch();
    },
  };
}

export async function startInitialSync() {
  const response = await fetch("/api/sync", { method: "POST" });
  if (!response.ok) throw new Error("동기화 시작에 실패했습니다");
}
