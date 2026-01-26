/**
 * Sync Hooks
 *
 * 동기화 관련 React hooks
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface SyncJob {
  id: string;
  syncType: string;
  status: string;
  progress: number;
  totalCommits: number;
  processedCommits: number;
  startedAt: string | null;
}

export interface RecentSyncJob {
  id: string;
  syncType: string;
  status: string;
  totalCommits: number;
  completedAt: string | null;
}

export interface SyncStatus {
  hasActiveSync: boolean;
  activeJobs: SyncJob[];
  recentCompleted: RecentSyncJob[];
  lastSyncTime: string | null;
}

export interface SyncJobHistory {
  id: string;
  syncType: string;
  status: string;
  triggerType: string;
  totalCommits: number;
  processedCommits: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  duration: number | null;
}

export interface SyncStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  totalCommitsSynced: number;
}

/**
 * SSE를 사용한 실시간 동기화 상태 훅
 */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // 기존 연결 정리
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource("/api/sync/status");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.addEventListener("status", (event) => {
      try {
        const data = JSON.parse(event.data) as SyncStatus;
        setStatus(data);
      } catch (e) {
        console.error("Failed to parse status:", e);
      }
    });

    eventSource.addEventListener("reconnect", () => {
      // 서버가 재연결 요청
      eventSource.close();
      reconnectTimeoutRef.current = setTimeout(connect, 1000);
    });

    eventSource.addEventListener("error", (event) => {
      console.error("Failed to get sync status:", event);
      setError("동기화 상태를 가져오는데 실패했습니다");
    });

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();

      // 자동 재연결 (3초 후)
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    isConnected,
    error,
    reconnect: connect,
    disconnect,
  };
}

/**
 * 수동 동기화 트리거 훅
 */
export function useSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "동기화 시작에 실패했습니다");
      }

      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    isSyncing,
    error,
    sync,
    clearError: () => setError(null),
  };
}

/**
 * 동기화 작업 히스토리 훅
 */
export function useSyncHistory(options?: {
  limit?: number;
  status?: string;
  syncType?: string;
  days?: number;
}) {
  const [jobs, setJobs] = useState<SyncJobHistory[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    offset: 0,
    hasMore: false,
  });

  const fetchJobs = useCallback(
    async (offset = 0) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (options?.limit) params.set("limit", options.limit.toString());
        if (options?.status) params.set("status", options.status);
        if (options?.syncType) params.set("syncType", options.syncType);
        if (options?.days) params.set("days", options.days.toString());
        params.set("offset", offset.toString());

        const response = await fetch(`/api/sync/jobs?${params.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to fetch sync jobs");
        }

        const data = (await response.json()) as {
          jobs: SyncJobHistory[];
          stats: SyncStats;
          pagination: { total: number; offset: number; hasMore: boolean };
        };

        if (offset === 0) {
          setJobs(data.jobs);
        } else {
          setJobs((prev) => [...prev, ...data.jobs]);
        }

        setStats(data.stats);
        setPagination({
          total: data.pagination.total,
          offset: data.pagination.offset + data.jobs.length,
          hasMore: data.pagination.hasMore,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [options?.limit, options?.status, options?.syncType, options?.days]
  );

  const loadMore = useCallback(() => {
    if (pagination.hasMore && !isLoading) {
      fetchJobs(pagination.offset);
    }
  }, [pagination.hasMore, pagination.offset, isLoading, fetchJobs]);

  const refresh = useCallback(() => {
    fetchJobs(0);
  }, [fetchJobs]);

  useEffect(() => {
    fetchJobs(0);
  }, [fetchJobs]);

  return {
    jobs,
    stats,
    isLoading,
    error,
    pagination,
    loadMore,
    refresh,
  };
}
