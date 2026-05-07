"use client";

import { useCallback, useEffect, useState } from "react";
import { useNdjsonStream } from "@/lib/hooks/useNdjsonStream";

export type Bucket = "spending" | "income" | "ignore";

export interface TransactionItem {
  id: string;
  type: "withdrawal" | "deposit";
  amount: number;
  merchant: string;
  accountName: string;
  rawTitle: string;
  rawText: string;
  transactedAt: string;
  bucket: Bucket;
  spendingOverride: "include" | "exclude" | null;
  overrideNote: string | null;
}

export interface TransactionSummary {
  totalSpending: number;
  totalIncome: number;
  totalIgnored: number;
  spendingCount: number;
  incomeCount: number;
  ignoredCount: number;
  totalWithdrawal: number;
  totalDeposit: number;
  withdrawalCount: number;
  depositCount: number;
}

export interface SpendingFilters {
  from?: string;
  to?: string;
  type?: "withdrawal" | "deposit";
  bucket?: Bucket;
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
  totalSpending: 0,
  totalIncome: 0,
  totalIgnored: 0,
  spendingCount: 0,
  incomeCount: 0,
  ignoredCount: 0,
  totalWithdrawal: 0,
  totalDeposit: 0,
  withdrawalCount: 0,
  depositCount: 0,
};

export function useUpdateTransactionOverride() {
  const [isUpdating, setIsUpdating] = useState(false);

  const update = useCallback(
    async (
      transactionId: string,
      spendingOverride: "include" | "exclude" | null,
      overrideNote?: string | null
    ) => {
      setIsUpdating(true);
      try {
        const body: Record<string, unknown> = { spendingOverride };
        if (overrideNote !== undefined) body.overrideNote = overrideNote;
        const response = await fetch(`/api/spending/transactions/${transactionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Failed to update transaction");
        return true;
      } catch (err) {
        console.error("Failed to update transaction override:", err);
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    []
  );

  return { updateOverride: update, isUpdating };
}

export function useDeleteTransaction() {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteTransaction = useCallback(async (transactionId: string) => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/spending/transactions/${transactionId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete transaction");
      return true;
    } catch (err) {
      console.error("Failed to delete transaction:", err);
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  return { deleteTransaction, isDeleting };
}

export function useTransactions(options: UseTransactionsOptions = {}): UseTransactionsReturn {
  const { perPage = 30, filters, enabled = true } = options;
  const filterFrom = filters?.from;
  const filterTo = filters?.to;
  const filterType = filters?.type;
  const filterBucket = filters?.bucket;

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
        if (filterBucket) params.set("bucket", filterBucket);

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
    [perPage, filterFrom, filterTo, filterType, filterBucket]
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

// ============ Spending Trend ============

export function useSpendingTrend() {
  const [data, setData] = useState<import("./types").SpendingTrendResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchTrend() {
      setIsLoading(true);
      try {
        const response = await fetch("/api/spending/trend", { signal: controller.signal });
        if (!response.ok) throw new Error("Failed to fetch spending trend");
        const json = await response.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch spending trend:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchTrend();
    return () => controller.abort();
  }, []);

  return { data, isLoading };
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
  transactionId: string | null;
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
  options: UseNotificationLogsOptions = {}
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
    [perPage, filterFrom, filterTo]
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
  const readNdjson = useNdjsonStream();

  const run = useCallback(
    async (dryRun: boolean) => {
      setIsLoading(true);
      setResult(null);
      setProgress(null);

      try {
        await readNdjson<{ type: string } & Record<string, unknown>>(
          "/api/spending/reparse",
          { dryRun },
          (event) => {
            if (event.type === "start") {
              setProgress({
                processed: 0,
                total: event.total as number,
                created: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
              });
            } else if (event.type === "progress") {
              setProgress({
                processed: event.processed as number,
                total: event.total as number,
                created: event.created as number,
                updated: event.updated as number,
                skipped: event.skipped as number,
                failed: event.failed as number,
              });
            } else if (event.type === "done") {
              setResult({
                dryRun: event.dryRun as boolean,
                total: event.total as number,
                created: event.created as number,
                updated: event.updated as number,
                skipped: event.skipped as number,
                failed: event.failed as number,
                items: event.items as ReparseResult["items"],
              });
              setProgress(null);
            }
          }
        );
      } catch (err) {
        console.error("Reparse failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [readNdjson]
  );

  const preview = useCallback(() => run(true), [run]);
  const apply = useCallback(() => run(false), [run]);
  const clear = useCallback(() => {
    setResult(null);
    setProgress(null);
  }, []);

  return { preview, apply, result, progress, isLoading, clear };
}

// ============ Cleanup ============

export interface CleanupItem {
  logId: string;
  title: string;
  text: string;
  receivedAt: string;
  reason: string;
  bytes: number;
}

export interface CleanupProgress {
  phase: "reparse" | "cleanup";
  // reparse phase
  reparseProcessed?: number;
  reparseTotal?: number;
  reparseCreated?: number;
  reparseUpdated?: number;
  // cleanup phase
  deleted?: number;
  deletableTotal?: number;
}

export interface CleanupResult {
  dryRun: boolean;
  reparseCreated: number;
  reparseUpdated: number;
  reparseSkipped: number;
  deletable: number;
  deleted: number;
  estimatedBytes: number;
  items: CleanupItem[];
}

interface UseCleanupReturn {
  preview: () => Promise<void>;
  execute: () => Promise<void>;
  result: CleanupResult | null;
  progress: CleanupProgress | null;
  isLoading: boolean;
  clear: () => void;
}

export function useCleanup(): UseCleanupReturn {
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [progress, setProgress] = useState<CleanupProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const readNdjson = useNdjsonStream();

  const run = useCallback(
    async (dryRun: boolean) => {
      setIsLoading(true);
      setResult(null);
      setProgress(null);

      // Accumulate reparse/cleanup stats across events
      let reparseCreated = 0;
      let reparseUpdated = 0;
      let reparseSkipped = 0;
      let deletable = 0;
      let estimatedBytes = 0;
      let items: CleanupItem[] = [];
      let sawCleanupDone = false;

      try {
        await readNdjson<{ type: string } & Record<string, unknown>>(
          "/api/spending/notifications/cleanup",
          { dryRun },
          (event) => {
            if (event.type === "reparse-start") {
              setProgress({
                phase: "reparse",
                reparseProcessed: 0,
                reparseTotal: event.total as number,
                reparseCreated: 0,
                reparseUpdated: 0,
              });
            } else if (event.type === "reparse-progress") {
              setProgress({
                phase: "reparse",
                reparseProcessed: event.processed as number,
                reparseTotal: event.total as number,
                reparseCreated: event.created as number,
                reparseUpdated: event.updated as number,
              });
            } else if (event.type === "reparse-done") {
              reparseCreated = event.created as number;
              reparseUpdated = event.updated as number;
              reparseSkipped = event.skipped as number;
              setProgress(null);
            } else if (event.type === "cleanup-start") {
              deletable = event.deletable as number;
              estimatedBytes = event.estimatedBytes as number;
              items = event.items as CleanupItem[];
              if (!dryRun && deletable > 0) {
                setProgress({ phase: "cleanup", deleted: 0, deletableTotal: deletable });
              }
            } else if (event.type === "cleanup-progress") {
              setProgress({
                phase: "cleanup",
                deleted: event.deleted as number,
                deletableTotal: event.total as number,
              });
            } else if (event.type === "cleanup-done") {
              sawCleanupDone = true;
              setResult({
                dryRun,
                reparseCreated,
                reparseUpdated,
                reparseSkipped,
                deletable,
                deleted: event.deleted as number,
                estimatedBytes,
                items,
              });
              setProgress(null);
            }
          }
        );

        // If no cleanup-done event (dryRun=true path), set result from accumulated data
        if (!sawCleanupDone) {
          setResult({
            dryRun,
            reparseCreated,
            reparseUpdated,
            reparseSkipped,
            deletable,
            deleted: 0,
            estimatedBytes,
            items,
          });
        }
      } catch (err) {
        console.error("Cleanup failed:", err);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [readNdjson]
  );

  const preview = useCallback(() => run(true), [run]);
  const execute = useCallback(() => run(false), [run]);
  const clear = useCallback(() => {
    setResult(null);
    setProgress(null);
  }, []);

  return { preview, execute, result, progress, isLoading, clear };
}
