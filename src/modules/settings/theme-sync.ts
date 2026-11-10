import type { UserSettings } from "./types";

export type ThemePreference = UserSettings["theme"];

/** next-themes' localStorage key (ThemeProvider uses the default). */
export const THEME_STORAGE_KEY = "theme";

const THEMES: readonly string[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEMES.includes(value);
}

/**
 * The server theme this browser last saw. Lets a reload tell "the server copy
 * changed on another device" (adopt it) apart from "the server copy lags this
 * device's own toggle" (ignore it). Not read by next-themes' pre-paint script.
 */
export const SERVER_THEME_STORAGE_KEY = "theme-server";

/**
 * Which theme to apply after the server settings load, or null to leave the
 * page alone.
 *
 * - No explicit choice on this browser yet: the server value seeds it.
 * - The server value changed since this browser last saw it (another device
 *   picked a theme): adopt it, unless it already matches.
 * - Otherwise this browser's choice wins. The server copy can lag behind it
 *   (the header toggle saves in the background), and re-applying a stale copy
 *   is what used to undo every header-toggle click on /dashboard and /settings.
 *
 * Whatever is applied goes through next-themes' setTheme, which persists it to
 * localStorage, so the next reload's pre-paint script already paints it.
 */
export function themeToApplyFromServer(
  serverTheme: ThemePreference | null | undefined,
  storedTheme: string | null,
  lastSeenServerTheme: string | null = null
): ThemePreference | null {
  if (!isThemePreference(serverTheme)) return null;
  if (!isThemePreference(storedTheme)) return serverTheme;
  if (serverTheme === storedTheme) return null;
  if (isThemePreference(lastSeenServerTheme) && lastSeenServerTheme !== serverTheme) {
    return serverTheme;
  }
  return null;
}

/** Read this browser's explicit theme choice; null when unset or storage is blocked. */
export function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The server theme this browser last saw; null when unset or storage is blocked. */
export function readLastSeenServerTheme(): string | null {
  try {
    return window.localStorage.getItem(SERVER_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeenServerTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(SERVER_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: cross-device adoption just stays off for this browser.
  }
}
