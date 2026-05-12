"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccountListItem {
  id: string;
  label: string;
  broker: string;
  cano: string;
  acntPrdtCd: string;
  accountType: string;
  appKeyMasked: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

export interface SummaryAccount {
  id: string;
  label: string;
  cano: string;
  acntPrdtCd: string;
  accountType: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface SummarySnapshot {
  id: string;
  accountId: string;
  takenAt: string;
  asOfDate: string;
  totalEvalAmount: number;
  securitiesEvalAmount: number;
  deposit: number;
  totalPurchaseAmount: number;
  totalPnl: number;
  totalPnlRate: number | null;
  realizedPnl: number | null;
  prevDayTotalAsset: number | null;
  assetIcdcAmt: number | null;
}

export interface SummaryPosition {
  id: string;
  snapshotId: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnl: number;
  pnlRate: number | null;
  weight: number;
}

export interface SummaryTotals {
  totalEvalAmount: number;
  totalDeposit: number;
  totalPurchaseAmount: number;
  totalPnl: number;
  totalPnlRate: number;
  prevDayTotalAsset: number | null;
  assetIcdcAmt: number | null;
}

export interface PortfolioSummary {
  accounts: SummaryAccount[];
  totals: SummaryTotals | null;
  latestSnapshots: SummarySnapshot[];
  positions: SummaryPosition[];
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, isLoading, error, refresh };
}

export function usePortfolioSummary() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/summary");
      if (!res.ok) throw new Error("Failed to fetch portfolio");
      const data = (await res.json()) as PortfolioSummary;
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, isLoading, error, refresh };
}

export interface SnapshotPoint {
  id: string;
  accountId: string;
  asOfDate: string;
  takenAt: string;
  totalEvalAmount: number;
  securitiesEvalAmount: number;
  deposit: number;
  totalPurchaseAmount: number;
  totalPnl: number;
  totalPnlRate: number | null;
}

export function useSnapshots(params: { from?: string; to?: string; accountId?: string }) {
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const url = new URL("/api/portfolio/snapshots", window.location.origin);
    if (params.from) url.searchParams.set("from", params.from);
    if (params.to) url.searchParams.set("to", params.to);
    if (params.accountId) url.searchParams.set("accountId", params.accountId);

    setIsLoading(true);
    fetch(url.toString(), { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => setSnapshots(data.snapshots ?? []))
      .catch(() => undefined)
      .finally(() => setIsLoading(false));

    return () => ctrl.abort();
  }, [params.from, params.to, params.accountId]);

  return { snapshots, isLoading };
}

export interface ExecutionItem {
  id: string;
  accountId: string;
  accountLabel: string;
  odno: string;
  ordDt: string;
  ordTime: string | null;
  side: "buy" | "sell";
  ticker: string;
  name: string;
  orderQty: number;
  filledQty: number;
  filledAmount: number;
  avgPrice: number;
  cancelled: boolean;
}

export function useExecutions(params: { accountId?: string; limit?: number } = {}) {
  const [executions, setExecutions] = useState<ExecutionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = new URL("/api/portfolio/executions", window.location.origin);
      if (params.accountId) url.searchParams.set("accountId", params.accountId);
      if (params.limit) url.searchParams.set("limit", String(params.limit));
      const res = await fetch(url.toString());
      const data = await res.json();
      setExecutions(data.executions ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [params.accountId, params.limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { executions, isLoading, refresh };
}

export async function syncAllAccounts(): Promise<{ ok: boolean; results: unknown }> {
  const res = await fetch("/api/portfolio/sync", { method: "POST" });
  const data = await res.json();
  return { ok: res.ok, results: data.results };
}

export async function syncAccount(
  accountId: string
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const res = await fetch(`/api/portfolio/accounts/${accountId}/sync`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true, result: data.result };
}

export async function createAccount(input: {
  label: string;
  cano: string;
  acntPrdtCd: string;
  accountType: string;
  appKey: string;
  appSecret: string;
}): Promise<{ ok: boolean; id?: string; error?: string; code?: string }> {
  const res = await fetch("/api/portfolio/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error, code: data.code };
  return { ok: true, id: data.id };
}

export async function deleteAccount(accountId: string): Promise<boolean> {
  const res = await fetch(`/api/portfolio/accounts/${accountId}`, { method: "DELETE" });
  return res.ok;
}

export async function patchAccount(
  accountId: string,
  patch: { label?: string; isActive?: boolean }
): Promise<boolean> {
  const res = await fetch(`/api/portfolio/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export interface TargetAllocation {
  ticker: string;
  name: string;
  targetWeight: number;
}

export function useTargetAllocations(accountId: string | null) {
  const [targets, setTargets] = useState<TargetAllocation[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setTargets([]);
      setUpdatedAt(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/accounts/${accountId}/targets`);
      if (!res.ok) throw new Error("Failed to fetch targets");
      const data = await res.json();
      setTargets(data.targets ?? []);
      setUpdatedAt(data.updatedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { targets, updatedAt, isLoading, error, refresh };
}

export interface ReturnsCashflow {
  date: string;
  amount: number;
  inferredFrom: {
    totalAssetDelta: number;
    purchaseAmountDelta: number;
    netExecutions: number;
    settledExecutions: number;
    expectedDepositDelta: number;
  };
}

export interface ReturnsPeriodPoint {
  date: string;
  startValue: number;
  endValue: number;
  cashflow: number;
  periodReturn: number;
  cumulativeReturn: number;
}

export interface ReturnsResponse {
  twr: {
    totalReturn: number | null;
    annualizedReturn: number | null;
    days: number;
    periods: ReturnsPeriodPoint[];
  };
  xirr: number | null;
  cashflows: ReturnsCashflow[];
  startDate: string | null;
  endDate: string | null;
  startValue: number;
  endValue: number;
}

export function useReturns(params: { accountId?: string; from?: string; to?: string }) {
  const [data, setData] = useState<ReturnsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const url = new URL("/api/portfolio/returns", window.location.origin);
    if (params.accountId) url.searchParams.set("accountId", params.accountId);
    if (params.from) url.searchParams.set("from", params.from);
    if (params.to) url.searchParams.set("to", params.to);

    setIsLoading(true);
    fetch(url.toString(), { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => undefined)
      .finally(() => setIsLoading(false));

    return () => ctrl.abort();
  }, [params.accountId, params.from, params.to]);

  return { data, isLoading };
}

export async function saveTargetAllocations(
  accountId: string,
  targets: TargetAllocation[]
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/portfolio/accounts/${accountId}/targets`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targets }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? "저장 실패" };
  return { ok: true };
}
