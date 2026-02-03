import type { TimelineCommit } from "./hooks";

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

// --- 1b. Date gap calculation ---
interface DateGapResult {
  gapPx: number;
  showPeriodBreak: boolean;
  daysDiff: number;
}

export function calculateDateGap(dateA: string, dateB: string): DateGapResult {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diffMs = Math.abs(a.getTime() - b.getTime());
  const daysDiff = Math.round(diffMs / (1000 * 60 * 60 * 24));

  let gapPx: number;
  if (daysDiff <= 1) {
    gapPx = 32;
  } else if (daysDiff <= 2) {
    gapPx = 44;
  } else if (daysDiff <= 3) {
    gapPx = 56;
  } else if (daysDiff <= 7) {
    gapPx = 72;
  } else {
    gapPx = 96;
  }

  return {
    gapPx,
    showPeriodBreak: daysDiff >= 4,
    daysDiff,
  };
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

export function groupCommitsByTimeOfDay(commits: TimelineCommit[]): TimeSubGroup[] {
  if (commits.length === 0) return [];

  const groups: TimeSubGroup[] = [];
  let currentGroup: TimelineCommit[] = [commits[0]];
  let currentTod = getTimeOfDay(new Date(commits[0].committedAt).getHours());

  for (let i = 1; i < commits.length; i++) {
    const commitDate = new Date(commits[i].committedAt);
    const prevDate = new Date(commits[i - 1].committedAt);
    const hoursDiff = Math.abs(prevDate.getTime() - commitDate.getTime()) / (1000 * 60 * 60);
    const tod = getTimeOfDay(commitDate.getHours());

    if (hoursDiff >= 3 && tod !== currentTod) {
      groups.push({ label: TIME_OF_DAY_LABELS[currentTod], commits: currentGroup });
      currentGroup = [commits[i]];
      currentTod = tod;
    } else {
      currentGroup.push(commits[i]);
    }
  }

  groups.push({ label: TIME_OF_DAY_LABELS[currentTod], commits: currentGroup });

  // If only one group, don't show label
  if (groups.length === 1) {
    groups[0].label = null;
  }

  return groups;
}

// --- 1d. Commit size classification ---
export type CommitSize = "large" | "normal";

export function getCommitSize(commit: TimelineCommit): CommitSize {
  const total = commit.additions + commit.deletions;
  return total >= 100 ? "large" : "normal";
}

// --- 1e. Day abbreviation ---
const DAY_ABBRS = ["일", "월", "화", "수", "목", "금", "토"];

export function getDayAbbreviation(dateStr: string): string {
  const date = new Date(dateStr);
  return DAY_ABBRS[date.getDay()];
}
