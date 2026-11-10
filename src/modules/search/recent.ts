/**
 * Recent search terms (a per-viewer convenience). Search terms are personal data,
 * so they live in sessionStorage — gone when the tab closes — never in
 * localStorage, where they would outlive the session on a shared browser.
 */
export const RECENT_KEY = "cistory.search.recent";
const MAX_RECENT = 6;

/**
 * Removes the terms an earlier version kept in localStorage. Runs on every load;
 * after the first it is a no-op.
 */
export function clearLegacyRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Storage unavailable: nothing to clean up.
  }
}

export function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((s) => typeof s === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(text: string): void {
  try {
    const next = [text, ...loadRecent().filter((s) => s !== text)].slice(0, MAX_RECENT);
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): recent searches are optional.
  }
}
