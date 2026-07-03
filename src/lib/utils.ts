import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp as Date object (for PostgreSQL)
 * Use this for Drizzle ORM timestamp fields
 */
export function now(): Date {
  return new Date();
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  const intervals = [
    { label: "년", seconds: 31536000 },
    { label: "개월", seconds: 2592000 },
    { label: "일", seconds: 86400 },
    { label: "시간", seconds: 3600 },
    { label: "분", seconds: 60 },
    { label: "초", seconds: 1 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count}${interval.label} 전`;
    }
  }

  return "방금 전";
}

/**
 * Format date to local string
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Truncate diff content for AI processing
 */
export function truncateDiff(diff: string, maxChars: number = 8000): string {
  if (diff.length <= maxChars) return diff;

  // Try to truncate at a sensible boundary
  const truncated = diff.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxChars * 0.8) {
    return `${truncated.slice(0, lastNewline)}\n\n[... truncated ...]`;
  }

  return `${truncated}\n\n[... truncated ...]`;
}

/**
 * Parse owner and repo from full name
 */
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return { owner, repo };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a date query parameter into YYYY-MM-DD format.
 * Supports: YYYY-MM-DD, MM-DD, M-DD, MMDD (4-digit).
 * Returns today for null, empty, invalid, or future dates.
 */
export function parseDateParam(param: string | null): string {
  // Local (KST in production) calendar day — toISOString would report the UTC
  // day, which is *yesterday* for the first 9 hours of every KST day.
  const today = toLocalDateString(new Date());
  if (!param) return today;

  const trimmed = param.trim();
  if (!trimmed) return today;

  let candidate: string;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // YYYY-MM-DD
    candidate = trimmed;
  } else if (/^\d{1,2}-\d{2}$/.test(trimmed)) {
    // M-DD or MM-DD
    const year = new Date().getFullYear();
    const [m, d] = trimmed.split("-");
    candidate = `${year}-${m.padStart(2, "0")}-${d}`;
  } else if (/^\d{4}$/.test(trimmed)) {
    // MMDD
    const year = new Date().getFullYear();
    candidate = `${year}-${trimmed.slice(0, 2)}-${trimmed.slice(2)}`;
  } else {
    return today;
  }

  // Validate the date is real and not in the future
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return today;
  // Check the date components match (catches Feb 30 etc.)
  const [y, m, d] = candidate.split("-").map(Number);
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return today;
  }
  if (candidate > today) return today;

  return candidate;
}

/**
 * Parse a date string into a local-timezone Date object.
 *
 * CLAUDE.md requires avoiding `new Date("YYYY-MM-DD")` since ECMAScript parses
 * date-only strings as UTC midnight — in KST that's the previous day 09:00,
 * which corrupts day-window queries.
 *
 * - "YYYY-MM-DD" → local midnight (uses new Date(y, m-1, d))
 * - Full ISO / other formats → new Date(str) as-is
 * - Invalid → null
 */
export function parseDateLocal(str: string): Date | null {
  const dateOnly = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Start of the given local day ("YYYY-MM-DD" → that day 00:00:00 local time). */
export function startOfLocalDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** End of the given local day ("YYYY-MM-DD" → that day 23:59:59.999 local time). */
export function endOfLocalDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Format a Date as "YYYY-MM-DD" using local timezone fields. */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format seconds as compact coding time ("1분 미만", "45m", "2h", "2h 30m"). */
export function formatCodingTime(seconds: number): string {
  if (seconds < 60) return "1분 미만";
  const minutes = Math.floor(seconds / 60);
  if (seconds < 3600) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  const remainMinutes = Math.floor((seconds % 3600) / 60);
  if (remainMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainMinutes}m`;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Get the application's public URL
 * Uses NEXT_PUBLIC_APP_URL if available, otherwise falls back to window.location.origin
 * This is important for OAuth redirects in reverse proxy environments
 */
export function getAppUrl(): string {
  // Server-side: must use environment variable
  if (!isBrowser()) {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }

  // Client-side: prefer environment variable, fallback to current origin
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}
