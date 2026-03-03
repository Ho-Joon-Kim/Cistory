"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "next-themes";

export interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
  lastSyncedAt: string | null;
  hasOwnTracksKey: boolean;
  hasTossKey: boolean;
  hasWakaTimeKey: boolean;
  lastLat: number | null;
  lastLon: number | null;
}

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
      } catch (e) {
        throw e;
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
    } catch (e) {
      throw e;
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
