import type { TimelineCommit } from "./hooks";
import type { TimeEventSubGroup, TimelineEvent } from "./types";

// --- 1a. Repository color palette ---
const REPO_COLORS = [
  "173 80% 40%", // teal
  "217 91% 60%", // blue
  "263 70% 58%", // violet
  "330 81% 60%", // pink
  "25 95% 53%", // orange
  "45 93% 47%", // amber
  "84 81% 44%", // lime
  "186 94% 42%", // cyan
];

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

export function getRepoColor(repoFullName: string): string {
  const index = djb2Hash(repoFullName) % REPO_COLORS.length;
  return REPO_COLORS[index];
}

// --- 1b. Fill date range (oldest commit date → today, descending) ---
export interface DateEntry {
  date: string; // "YYYY-MM-DD"
  commits: TimelineCommit[];
  isEmpty: boolean;
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fillDateRange(groupedCommits: Record<string, TimelineCommit[]>): DateEntry[] {
  const dates = Object.keys(groupedCommits);
  if (dates.length === 0) return [];

  // Find oldest date among commits
  const sorted = dates.sort(); // ascending "YYYY-MM-DD"
  const oldest = sorted[0];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${oldest}T00:00:00`); // parse as local
  start.setHours(0, 0, 0, 0);

  const entries: DateEntry[] = [];
  const cursor = new Date(today);

  while (cursor >= start) {
    const key = toLocalDateKey(cursor);
    const commits = groupedCommits[key] ?? [];
    entries.push({ date: key, commits, isEmpty: commits.length === 0 });
    cursor.setDate(cursor.getDate() - 1);
  }

  return entries; // descending (newest first)
}

// --- 1c. Time-of-day sub-groups ---
type TimeOfDay = "dawn" | "morning" | "afternoon" | "evening";

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  dawn: "새벽",
  morning: "오전",
  afternoon: "오후",
  evening: "저녁",
};

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour < 6) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export interface TimeSubGroup {
  label: string | null;
  commits: TimelineCommit[];
}

// --- 1d. Unified event time-of-day grouping ---

export function groupEventsByTimeOfDay(events: TimelineEvent[]): TimeEventSubGroup[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const groups: TimeEventSubGroup[] = [];
  let currentGroup: TimelineEvent[] = [sorted[0]];
  let currentTod = getTimeOfDay(new Date(sorted[0].timestamp).getHours());

  for (let i = 1; i < sorted.length; i++) {
    const eventDate = new Date(sorted[i].timestamp);
    const prevDate = new Date(sorted[i - 1].timestamp);
    const hoursDiff = Math.abs(prevDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60);
    const tod = getTimeOfDay(eventDate.getHours());

    if (hoursDiff >= 3 && tod !== currentTod) {
      groups.push({ label: TIME_OF_DAY_LABELS[currentTod], events: currentGroup });
      currentGroup = [sorted[i]];
      currentTod = tod;
    } else {
      currentGroup.push(sorted[i]);
    }
  }

  groups.push({ label: TIME_OF_DAY_LABELS[currentTod], events: currentGroup });

  if (groups.length === 1) {
    groups[0].label = null;
  }

  return groups;
}

// --- 1e. Distance formatting ---
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

// --- 1e. Commit size classification ---
export type CommitSize = "large" | "normal";

export function getCommitSize(commit: TimelineCommit): CommitSize {
  const total = commit.additions + commit.deletions;
  return total >= 100 ? "large" : "normal";
}

// --- 1g. Day abbreviation ---
const DAY_ABBRS = ["일", "월", "화", "수", "목", "금", "토"];

export function getDayAbbreviation(dateStr: string): string {
  const date = new Date(dateStr);
  return DAY_ABBRS[date.getDay()];
}
