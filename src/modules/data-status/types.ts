export const SOURCE_IDS = [
  "github",
  "location",
  "toss",
  "wakatime",
  "kis",
  "withings",
  "health",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export const RECOVERABLE_SOURCES = ["wakatime", "withings", "health"] as const;
export type RecoverableSource = (typeof RECOVERABLE_SOURCES)[number];
export type DayState = "observed" | "unknown" | "checked" | "failed" | "pending";
export interface SourceDay {
  date: string;
  count: number;
  state: DayState;
}
export interface RecoveryJob {
  id: string;
  source: RecoverableSource;
  fromDate: string;
  toDate: string;
  nextDate: string;
  status: "pending" | "running" | "completed" | "failed";
  error: string | null;
  createdAt: string;
}
export interface SourceStatus {
  id: SourceId;
  label: string;
  connected: boolean;
  needsReauth: boolean;
  /**
   * Why `needsReauth` is set: `legacy_key` = a retired WakaTime API key with no
   * OAuth connection, `auth` = the provider confirmed an auth failure.
   */
  reauthReason?: "legacy_key" | "auth" | null;
  lastSuccessAt: string | null;
  lastRecordAt: string | null;
  error: string | null;
  stale: boolean;
  canRecover: boolean;
  recoveryHelp: string;
  days: SourceDay[];
  /**
   * Everything stored for this source, all time. Only computed for a source
   * that needs attention (failing, stale or needing re-auth) — otherwise null.
   */
  retained: { count: number; days: number } | null;
}
export interface DataStatusResponse {
  from: string;
  to: string;
  timeZone: "Asia/Seoul";
  sources: SourceStatus[];
  jobs: RecoveryJob[];
}
