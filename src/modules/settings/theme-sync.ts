import type { UserSettings } from "./types";

export type ThemePreference = UserSettings["theme"];

/** next-themes' localStorage key (ThemeProvider uses the default). */
export const THEME_STORAGE_KEY = "theme";

const THEMES: readonly string[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEMES.includes(value);
}

/**
 * Which theme to apply after the server settings load, or null to leave the
 * page alone.
 *
 * The server value only seeds a device that has never chosen a theme. Once this
 * browser has an explicit choice (header toggle or the settings segment — both
 * write next-themes' localStorage key) that choice wins: the server copy can lag
 * behind it (the toggle saves in the background) and re-applying it is what
 * used to undo every header-toggle click on /dashboard and /settings.
 */
export function themeToApplyFromServer(
  serverTheme: ThemePreference | null | undefined,
  storedTheme: string | null
): ThemePreference | null {
  if (!isThemePreference(serverTheme)) return null;
  if (isThemePreference(storedTheme)) return null;
  return serverTheme;
}

/** Read this browser's explicit theme choice; null when unset or storage is blocked. */
export function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
