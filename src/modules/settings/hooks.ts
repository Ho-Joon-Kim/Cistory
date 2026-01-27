"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";

export interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
  lastSyncedAt: string | null;
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
