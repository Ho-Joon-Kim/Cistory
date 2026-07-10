"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";

import type { UserSettings } from "./types";

// Shared with the API route (single response contract) — re-exported so
// existing `import { UserSettings } from ".../hooks"` consumers keep working.
export type { UserSettings } from "./types";

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { setTheme } = useTheme();

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/settings");

      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }

      const data = (await response.json()) as UserSettings;
      setSettings(data);

      // 테마 적용
      if (data.theme) {
        setTheme(data.theme);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [setTheme]);

  const updateSettings = useCallback(
    async (newSettings: Partial<UserSettings>) => {
      setIsSaving(true);
      setError(null);

      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(newSettings),
        });

        if (!response.ok) {
          throw new Error("Failed to update settings");
        }

        const data = (await response.json()) as UserSettings;
        setSettings(data);

        // 테마 변경 시 적용
        if (newSettings.theme) {
          setTheme(newSettings.theme);
        }

        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [setTheme]
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    isSaving,
    error,
    updateSettings,
    refresh: fetchSettings,
  };
}

export interface DataUsageCategoryData {
  category: string;
  label: string;
  tables: { tableName: string; rowCount: number; estimatedBytes: number }[];
  totalRows: number;
  totalBytes: number;
}

export interface DataUsageData {
  categories: DataUsageCategoryData[];
  grandTotalRows: number;
  grandTotalBytes: number;
  calculatedAt: string | null;
}

export function useDataUsage() {
  const [data, setData] = useState<DataUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/data-usage");
      if (!response.ok) throw new Error("Failed to fetch data usage");
      const result = (await response.json()) as DataUsageData;
      setData(result);
    } catch {
      // ignore - will show empty state
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/settings/data-usage", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to refresh data usage");
      const result = (await response.json()) as DataUsageData;
      setData(result);
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, isRefreshing, refresh };
}

export function useOwnTracksKey(hasKey: boolean) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hasOwnTracksKey, setHasOwnTracksKey] = useState(hasKey);
  const prevHasKey = useRef(hasKey);

  useEffect(() => {
    if (prevHasKey.current !== hasKey) {
      setHasOwnTracksKey(hasKey);
      prevHasKey.current = hasKey;
    }
  }, [hasKey]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/settings/owntracks-key", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to generate key");
      const data = (await response.json()) as { apiKey: string };
      setNewKey(data.apiKey);
      setHasOwnTracksKey(true);
      return true;
    } catch {
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    setIsRevoking(true);
    try {
      const response = await fetch("/api/settings/owntracks-key", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to revoke key");
      setNewKey(null);
      setHasOwnTracksKey(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsRevoking(false);
    }
  }, []);

  return {
    hasOwnTracksKey,
    newKey,
    isGenerating,
    isRevoking,
    generate,
    revoke,
    clearNewKey: () => setNewKey(null),
  };
}

export function useTossKey(hasKey: boolean) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hasTossKey, setHasTossKey] = useState(hasKey);
  const prevHasKey = useRef(hasKey);

  useEffect(() => {
    if (prevHasKey.current !== hasKey) {
      setHasTossKey(hasKey);
      prevHasKey.current = hasKey;
    }
  }, [hasKey]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/settings/toss-key", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to generate key");
      const data = (await response.json()) as { apiKey: string };
      setNewKey(data.apiKey);
      setHasTossKey(true);
      return true;
    } catch {
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    setIsRevoking(true);
    try {
      const response = await fetch("/api/settings/toss-key", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to revoke key");
      setNewKey(null);
      setHasTossKey(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsRevoking(false);
    }
  }, []);

  return {
    hasTossKey,
    newKey,
    isGenerating,
    isRevoking,
    generate,
    revoke,
    clearNewKey: () => setNewKey(null),
  };
}

export function useWithings(hasConnection: boolean) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasWithingsConnection, setHasWithingsConnection] = useState(hasConnection);
  const prevHasConnection = useRef(hasConnection);

  useEffect(() => {
    if (prevHasConnection.current !== hasConnection) {
      setHasWithingsConnection(hasConnection);
      prevHasConnection.current = hasConnection;
    }
  }, [hasConnection]);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/withings", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to disconnect");
      setHasWithingsConnection(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  return { hasWithingsConnection, isDisconnecting, disconnect };
}

export function useHealth(hasConnection: boolean) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasHealthConnection, setHasHealthConnection] = useState(hasConnection);
  const prevHasConnection = useRef(hasConnection);

  useEffect(() => {
    if (prevHasConnection.current !== hasConnection) {
      setHasHealthConnection(hasConnection);
      prevHasConnection.current = hasConnection;
    }
  }, [hasConnection]);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/fitbit", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to disconnect");
      setHasHealthConnection(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  return { hasHealthConnection, isDisconnecting, disconnect };
}

interface WakaTimeUser {
  displayName: string;
  email: string;
}

export interface WakaTimeSyncStats {
  totalSessions: number;
  totalDays: number;
  lastSyncedAt: string | null;
  unsyncedDays: number;
}

// ============ DB Benchmark ============

export interface BenchmarkStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  p95: number;
}

export interface BenchmarkItem {
  name: string;
  label: string;
  runs: number[];
  stats: BenchmarkStats;
}

export interface BenchmarkRun {
  id: string;
  dbHost: string;
  timestamp: string;
  benchmarks: BenchmarkItem[];
}

const BENCHMARK_STORAGE_KEY = "db-benchmark-history";
const MAX_HISTORY = 20;

function loadHistory(): BenchmarkRun[] {
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { runs: BenchmarkRun[] };
    return parsed.runs ?? [];
  } catch {
    return [];
  }
}

function saveHistory(runs: BenchmarkRun[]) {
  localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify({ runs: runs.slice(0, MAX_HISTORY) }));
}

export function useDbBenchmark() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState<BenchmarkRun | null>(null);
  const [history, setHistory] = useState<BenchmarkRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const runBenchmark = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/db-benchmark", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "벤치마크 실행에 실패했습니다");
      }
      const data = (await response.json()) as {
        dbHost: string;
        timestamp: string;
        benchmarks: BenchmarkItem[];
      };
      const run: BenchmarkRun = {
        id: `${Date.now()}`,
        dbHost: data.dbHost,
        timestamp: data.timestamp,
        benchmarks: data.benchmarks,
      };
      setCurrentResult(run);
      const updated = [run, ...loadHistory()].slice(0, MAX_HISTORY);
      saveHistory(updated);
      setHistory(updated);
      return run;
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      return null;
    } finally {
      setIsRunning(false);
    }
  }, []);

  const deleteRun = useCallback(
    (id: string) => {
      const updated = loadHistory().filter((r) => r.id !== id);
      saveHistory(updated);
      setHistory(updated);
      if (currentResult?.id === id) setCurrentResult(null);
    },
    [currentResult]
  );

  const clearHistory = useCallback(() => {
    localStorage.removeItem(BENCHMARK_STORAGE_KEY);
    setHistory([]);
    setCurrentResult(null);
  }, []);

  return { isRunning, currentResult, history, error, runBenchmark, deleteRun, clearHistory };
}

export function useWakaTimeKey(hasKey: boolean) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [hasWakaTimeKey, setHasWakaTimeKey] = useState(hasKey);
  const [wakatimeUser, setWakatimeUser] = useState<WakaTimeUser | null>(null);
  const [syncStats, setSyncStats] = useState<WakaTimeSyncStats | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const prevHasKey = useRef(hasKey);

  useEffect(() => {
    if (prevHasKey.current !== hasKey) {
      setHasWakaTimeKey(hasKey);
      prevHasKey.current = hasKey;
    }
  }, [hasKey]);

  const fetchSyncStats = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/wakatime-sync");
      if (!response.ok) return;
      const data = (await response.json()) as WakaTimeSyncStats;
      setSyncStats(data);
    } catch {
      // ignore
    }
  }, []);

  // Auto-fetch sync stats when connected
  useEffect(() => {
    if (hasWakaTimeKey) {
      fetchSyncStats();
    } else {
      setSyncStats(null);
    }
  }, [hasWakaTimeKey, fetchSyncStats]);

  const triggerSync = useCallback(
    async (mode: "initial" | "regular") => {
      setIsSyncing(true);
      try {
        const response = await fetch("/api/settings/wakatime-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "동기화에 실패했습니다");
        }
        // Refresh stats after sync
        await fetchSyncStats();
        return true;
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchSyncStats]
  );

  const connect = useCallback(async (apiKey: string) => {
    setIsConnecting(true);
    try {
      const response = await fetch("/api/settings/wakatime-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to connect");
      }
      const data = (await response.json()) as { wakatimeUser: WakaTimeUser };
      setWakatimeUser(data.wakatimeUser);
      setHasWakaTimeKey(true);
      return true;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    setIsRevoking(true);
    try {
      const response = await fetch("/api/settings/wakatime-key", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to revoke key");
      setHasWakaTimeKey(false);
      setWakatimeUser(null);
      setSyncStats(null);
      return true;
    } catch {
      return false;
    } finally {
      setIsRevoking(false);
    }
  }, []);

  return {
    hasWakaTimeKey,
    wakatimeUser,
    isConnecting,
    isRevoking,
    connect,
    revoke,
    syncStats,
    isSyncing,
    fetchSyncStats,
    triggerSync,
  };
}
