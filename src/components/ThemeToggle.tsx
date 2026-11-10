"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useSaveThemePreference } from "@/modules/settings/hooks";

const subscribeNoop = () => () => {};

/**
 * One-click light/dark switch (app bar). The icon is CSS-driven by the `.dark`
 * class so the server render matches; the label names the next theme once the
 * client knows the resolved theme. The choice is this device's explicit theme
 * (it wins over the server copy) and is also saved to settings in the
 * background so the settings page and other devices agree.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const saveTheme = useSaveThemePreference();
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
  const isDark = isClient && resolvedTheme === "dark";
  const label = !isClient ? "테마 전환" : isDark ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = isDark ? "light" : "dark";
        setTheme(next);
        saveTheme(next);
      }}
    >
      <svg
        aria-hidden="true"
        className="size-4 dark:hidden"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
      <svg
        aria-hidden="true"
        className="hidden size-4 dark:block"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </Button>
  );
}
