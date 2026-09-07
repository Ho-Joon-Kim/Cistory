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
  lastSuccessAt: string | null;
  lastRecordAt: string | null;
  error: string | null;
  stale: boolean;
  canRecover: boolean;
  recoveryHelp: string;
  days: SourceDay[];
}
export interface DataStatusResponse {
  from: string;
  to: string;
  timeZone: "Asia/Seoul";
  sources: SourceStatus[];
  jobs: RecoveryJob[];
}
