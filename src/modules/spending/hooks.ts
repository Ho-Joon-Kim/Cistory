"use client";

import { useCallback, useEffect, useState } from "react";

export interface TransactionItem {
  id: string;
  type: "withdrawal" | "deposit";
  amount: number;
  merchant: string;
  accountName: string;
  rawTitle: string;
  rawText: string;
  transactedAt: string;
}

export interface TransactionSummary {
  totalWithdrawal: number;
  totalDeposit: number;
  withdrawalCount: number;
  depositCount: number;
}

export interface SpendingFilters {
  from?: string;
  to?: string;
  type?: "withdrawal" | "deposit";
}

interface UseTransactionsOptions {
  perPage?: number;
  filters?: SpendingFilters;
  enabled?: boolean;
}

interface UseTransactionsReturn {
  transactions: TransactionItem[];
  summary: TransactionSummary;
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

const emptySummary: TransactionSummary = {
  totalWithdrawal: 0,
  totalDeposit: 0,
  withdrawalCount: 0,
  depositCount: 0,
};

export function useTransactions(options: UseTransactionsOptions = {}): UseTransactionsReturn {
  const { perPage = 30, filters, enabled = true } = options;
  const filterFrom = filters?.from;
  const filterTo = filters?.to;
  const filterType = filters?.type;

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [summary, setSummary] = useState<TransactionSummary>(emptySummary);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchTransactions = useCallback(
    async (currentOffset: number, append: boolean, signal?: AbortSignal) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(perPage),
          offset: String(currentOffset),
        });

        if (filterFrom) params.set("from", filterFrom);
        if (filterTo) params.set("to", filterTo);
        if (filterType) params.set("type", filterType);

        const response = await fetch(`/api/spending?${params}`, { signal });

        if (!response.ok) {
          throw new Error("Failed to fetch transactions");
        }

        const data = (await response.json()) as {
          transactions: TransactionItem[];
          summary: TransactionSummary;
          hasMore: boolean;
        };

        setTransactions((prev) => (append ? [...prev, ...data.transactions] : data.transactions));
        setSummary(data.summary);
        setHasMore(data.hasMore);
        setOffset(currentOffset + data.transactions.length);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch transactions:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [perPage, filterFrom, filterTo, filterType],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setOffset(0);
    setTransactions([]);
    fetchTransactions(0, false, controller.signal);
    return () => controller.abort();
  }, [enabled, fetchTransactions]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      fetchTransactions(offset, true);
    }
  }, [hasMore, isLoading, offset, fetchTransactions]);

  const refresh = useCallback(() => {
    setOffset(0);
    setTransactions([]);
    fetchTransactions(0, false);
  }, [fetchTransactions]);

  return {
    transactions,
    summary,
    isLoading,
    hasMore,
    loadMore,
    refresh,
  };
}

// ============ Notification Logs ============

export interface NotificationLogItem {
  id: string;
  source: string;
  title: string;
  text: string;
  rawPayload: string;
  receivedAt: string;
  parsed: boolean;
}

interface UseNotificationLogsOptions {
  perPage?: number;
  filters?: { from?: string; to?: string };
  enabled?: boolean;
}

interface UseNotificationLogsReturn {
  logs: NotificationLogItem[];
  total: number;
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useNotificationLogs(
  options: UseNotificationLogsOptions = {},
): UseNotificationLogsReturn {
  const { perPage = 30, filters, enabled = true } = options;
  const filterFrom = filters?.from;
  const filterTo = filters?.to;

  const [logs, setLogs] = useState<NotificationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchLogs = useCallback(
    async (currentOffset: number, append: boolean, signal?: AbortSignal) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(perPage),
          offset: String(currentOffset),
        });

        if (filterFrom) params.set("from", filterFrom);
        if (filterTo) params.set("to", filterTo);

        const response = await fetch(`/api/spending/notifications?${params}`, { signal });

        if (!response.ok) {
          throw new Error("Failed to fetch notification logs");
        }

        const data = (await response.json()) as {
          logs: NotificationLogItem[];
          total: number;
          hasMore: boolean;
        };

        setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(currentOffset + data.logs.length);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch notification logs:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [perPage, filterFrom, filterTo],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setOffset(0);
    setLogs([]);
    fetchLogs(0, false, controller.signal);
    return () => controller.abort();
  }, [enabled, fetchLogs]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      fetchLogs(offset, true);
    }
  }, [hasMore, isLoading, offset, fetchLogs]);

  const refresh = useCallback(() => {
    setOffset(0);
    setLogs([]);
    fetchLogs(0, false);
  }, [fetchLogs]);

  return { logs, total, isLoading, hasMore, loadMore, refresh };
}

// ============ Reparse ============

export interface ReparseItem {
  logId: string;
  title: string;
  text: string;
  receivedAt: string;
  action: "create" | "update" | "skip";
  reason?: string;
  parsed?: {
    type: string;
    amount: number;
    merchant: string;
    accountName: string;
  };
}

export interface ReparseProgress {
  processed: number;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ReparseResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  items: ReparseItem[];
}

interface UseReparseReturn {
  preview: () => Promise<void>;
  apply: () => Promise<void>;
  result: ReparseResult | null;
  progress: ReparseProgress | null;
  isLoading: boolean;
  clear: () => void;
}

export function useReparse(): UseReparseReturn {
  const [result, setResult] = useState<ReparseResult | null>(null);
  const [progress, setProgress] = useState<ReparseProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const run = useCallback(async (dryRun: boolean) => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      const response = await fetch("/api/spending/reparse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Reparse failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep incomplete last line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === "start") {
              setProgress({ processed: 0, total: event.total, created: 0, updated: 0, skipped: 0, failed: 0 });
            } else if (event.type === "progress") {
              setProgress({
                processed: event.processed,
                total: event.total,
                created: event.created,
                updated: event.updated,
                skipped: event.skipped,
                failed: event.failed,
              });
            } else if (event.type === "done") {
              setResult({
                dryRun: event.dryRun,
                total: event.total,
                created: event.created,
                updated: event.updated,
                skipped: event.skipped,
                failed: event.failed,
                items: event.items,
              });
              setProgress(null);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      console.error("Reparse failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const preview = useCallback(() => run(true), [run]);
  const apply = useCallback(() => run(false), [run]);
  const clear = useCallback(() => {
    setResult(null);
    setProgress(null);
  }, []);

  return { preview, apply, result, progress, isLoading, clear };
}
