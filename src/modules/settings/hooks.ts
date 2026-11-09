"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredTheme, themeToApplyFromServer } from "./theme-sync";
import type { UserSettings } from "./types";

// Shared with the API route (single response contract) — re-exported so
// existing `import { UserSettings } from ".../hooks"` consumers keep working.
export type { UserSettings } from "./types";

export const SETTINGS_QUERY_KEY = ["settings"] as const;

async function fetchSettingsPayload(): Promise<UserSettings> {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Failed to fetch settings");
  return (await response.json()) as UserSettings;
}

/**
 * Persist a theme choice made outside the settings page (the app-bar toggle) so
 * other devices pick it up, and keep any mounted useSettings in sync. Fire and
 * forget: the local choice is already applied and wins on this device.
 */
export function useSaveThemePreference() {
  const queryClient = useQueryClient();
  return useCallback(
    (theme: UserSettings["theme"]) => {
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          queryClient.setQueryData(SETTINGS_QUERY_KEY, (await response.json()) as UserSettings);
        })
        .catch(() => {});
    },
    [queryClient]
  );
}

/**
 * The user's settings. One shared query (every consumer on the page dedupes to a
 * single GET). The server theme is applied only when this browser has no
 * explicit choice yet — see themeToApplyFromServer.
 */
export function useSettings() {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { setTheme } = useTheme();
  // next-themes hands out a new setTheme whenever the theme changes; reading it
  // through a ref keeps that identity churn from re-running anything below.
  const setThemeRef = useRef(setTheme);
  setThemeRef.current = setTheme;

  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettingsPayload,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const serverTheme = query.data?.theme;
  useEffect(() => {
    const theme = themeToApplyFromServer(serverTheme, readStoredTheme());
    if (theme) setThemeRef.current(theme);
  }, [serverTheme]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const updateSettings = useCallback(
    async (newSettings: Partial<UserSettings>) => {
      setIsSaving(true);
      setSaveError(null);

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
        queryClient.setQueryData(SETTINGS_QUERY_KEY, data);

        // 테마 변경 시 적용 (explicit choice on this device)
        if (newSettings.theme) {
          setThemeRef.current(newSettings.theme);
        }

        return true;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Unknown error");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [queryClient]
  );

  const fetchError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Unknown error"
    : null;

  return {
    settings: query.data ?? null,
    isLoading: query.isPending,
    isSaving,
    error: saveError ?? fetchError,
    updateSettings,
    refresh,
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

export function useHealthImportKey(hasKey: boolean) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hasHealthImportKey, setHasHealthImportKey] = useState(hasKey);
  const prevHasKey = useRef(hasKey);

  useEffect(() => {
    if (prevHasKey.current !== hasKey) {
      setHasHealthImportKey(hasKey);
      prevHasKey.current = hasKey;
    }
  }, [hasKey]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/settings/health-import-key", { method: "POST" });
      if (!response.ok) throw new Error("Failed to generate key");
      const data = (await response.json()) as { apiKey: string };
      setNewKey(data.apiKey);
      setHasHealthImportKey(true);
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
      const response = await fetch("/api/settings/health-import-key", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to revoke key");
      setNewKey(null);
      setHasHealthImportKey(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsRevoking(false);
    }
  }, []);

  return {
    hasHealthImportKey,
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
  const [isSyncing, setIsSyncing] = useState(false);
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

  // Manual pull from Google Health now (no 24h gate) — forward + exercise + backfill.
  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/fitbit/sync", { method: "POST" });
      if (!response.ok) throw new Error("Failed to sync");
      return true;
    } catch {
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return { hasHealthConnection, isDisconnecting, isSyncing, disconnect, syncNow };
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
        throw new Error(
          data.error || "벤치마크를 실행하지 못했습니다. 잠시 후 다시 시도해 주세요."
        );
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
      setError(
        e instanceof Error
          ? e.message
          : "벤치마크를 실행하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
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

export function useWakaTime(hasConnection: boolean) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasWakaTimeConnection, setHasWakaTimeConnection] = useState(hasConnection);
  const [syncStats, setSyncStats] = useState<WakaTimeSyncStats | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const prevHasConnection = useRef(hasConnection);

  useEffect(() => {
    if (prevHasConnection.current !== hasConnection) {
      setHasWakaTimeConnection(hasConnection);
      prevHasConnection.current = hasConnection;
    }
  }, [hasConnection]);

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
    if (hasWakaTimeConnection) {
      fetchSyncStats();
    } else {
      setSyncStats(null);
    }
  }, [hasWakaTimeConnection, fetchSyncStats]);

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
          throw new Error(
            data.error || "WakaTime을 동기화하지 못했습니다. 잠시 후 다시 시도해 주세요."
          );
        }
        await fetchSyncStats();
        return true;
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchSyncStats]
  );

  /** Revokes the OAuth grant and deletes the connection (also clears a legacy API key). */
  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/wakatime", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to disconnect");
      setHasWakaTimeConnection(false);
      setSyncStats(null);
      return true;
    } catch {
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  return {
    hasWakaTimeConnection,
    isDisconnecting,
    disconnect,
    syncStats,
    isSyncing,
    fetchSyncStats,
    triggerSync,
  };
}
