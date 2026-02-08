/**
 * WakaTime Adapter Interface
 *
 * Abstraction layer for WakaTime API.
 * Provides coding duration and summary data.
 */

export interface WakaTimeDuration {
  project: string | null;
  time: number; // Unix epoch (seconds)
  duration: number; // Duration in seconds
  humanAdditions: number | null;
  humanDeletions: number | null;
  aiAdditions: number | null;
  aiDeletions: number | null;
}

export interface WakaTimeSummaryItem {
  name: string;
  totalSeconds: number;
}

export interface WakaTimeDailySummary {
  date: string; // YYYY-MM-DD
  grandTotalSeconds: number;
  projects: WakaTimeSummaryItem[];
  languages: WakaTimeSummaryItem[];
  editors: WakaTimeSummaryItem[];
  categories: WakaTimeSummaryItem[];
}

export interface WakaTimeUser {
  id: string;
  email: string;
  displayName: string;
}

export interface WakaTimeAdapter {
  /** Get coding duration blocks for a specific date */
  getDurations(date: string): Promise<WakaTimeDuration[]>;

  /** Get daily summaries for a date range */
  getSummaries(start: string, end: string): Promise<WakaTimeDailySummary[]>;

  /** Verify the API key is valid */
  verifyApiKey(): Promise<boolean>;

  /** Get current user info */
  getCurrentUser(): Promise<WakaTimeUser>;
}
