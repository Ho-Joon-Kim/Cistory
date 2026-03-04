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

        if (filters?.from) params.set("from", filters.from);
        if (filters?.to) params.set("to", filters.to);
        if (filters?.type) params.set("type", filters.type);

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
    [perPage, filters],
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
