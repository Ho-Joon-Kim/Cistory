/**
 * Groups loaded search results for display: by KST day, commits collapsed per
 * repository, repeated visits to one place merged. Pure, unit tested.
 */
import { diagnosis } from "@/lib/facts/helpers";
import type { Fact } from "@/lib/facts/types";
import type { SearchItem } from "./types";

export interface CommitGroup {
  kind: "commits";
  key: string;
  repository: string;
  owner: string;
  name: string;
  items: SearchItem[];
  /** Commits that day in this repository; more than `items` in the mixed view. */
  total: number;
  /** Most frequent ticket id in the titles (e.g. RE-1008), if any. */
  ticket: string | null;
  typeCounts: [string, number][];
}

export interface ItemRow {
  kind: "item";
  key: string;
  item: SearchItem;
  /** Merged repeat visits to the same place on this day. */
  repeat: number;
}

export type DayRow = CommitGroup | ItemRow;

export interface DayGroup {
  date: string;
  rows: DayRow[];
  total: number;
}

const COMMIT_TYPE = /^(\w+)(\([^)]*\))?!?:/;
const TICKET = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

const TYPE_LABELS: Record<string, string> = {
  perf: "성능",
  fix: "수정",
  feat: "기능",
  refactor: "리팩터링",
  test: "테스트",
  docs: "문서",
  chore: "정리",
  style: "스타일",
  build: "빌드",
};

export function commitType(title: string): string {
  if (/^merge\b/i.test(title)) return "merge";
  return COMMIT_TYPE.exec(title)?.[1]?.toLowerCase() ?? "other";
}

/** Splits `fix(api): body (RE-1008)` into a mono tag and a body. */
export function splitCommitTitle(title: string): { tag: string; body: string } {
  const m = /^(\w+(?:\([^)]*\))?!?):\s*(.*)$/.exec(title);
  if (!m) return { tag: /^merge\b/i.test(title) ? "merge" : "", body: title };
  return { tag: m[1], body: m[2].replace(/\s*\([A-Z][A-Z0-9]+-\d+\)\s*$/, "") };
}

function topTicket(items: SearchItem[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const m of item.title.matchAll(TICKET)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.max(2, items.length / 2) ? best[0] : null;
}

export function groupByDay(items: SearchItem[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const item of items) {
    let day = days.at(-1);
    if (!day || day.date !== item.date) {
      day = { date: item.date, rows: [], total: 0 };
      days.push(day);
    }
    // A collapsed commit group counts every commit it stands for, once.
    if (item.source !== "commit" || !item.groupTotal) day.total += 1;
  }
  for (const day of days) {
    const dayItems = items.filter((item) => item.date === day.date);
    const repos = new Map<string, SearchItem[]>();
    const visits = new Map<string, ItemRow>();
    for (const item of dayItems) {
      if (item.source === "commit") {
        const repo = item.repository ?? item.description ?? "";
        const list = repos.get(repo) ?? [];
        if (list.length === 0 && item.groupTotal) day.total += item.groupTotal;
        list.push(item);
        repos.set(repo, list);
      }
    }
    const seenRepo = new Set<string>();
    for (const item of dayItems) {
      if (item.source === "commit") {
        const repo = item.repository ?? item.description ?? "";
        const list = repos.get(repo) ?? [item];
        const total = Math.max(list.length, list[0]?.groupTotal ?? 0);
        if (total < 2) {
          day.rows.push({ kind: "item", key: `${item.source}:${item.id}`, item, repeat: 1 });
          continue;
        }
        if (seenRepo.has(repo)) continue;
        seenRepo.add(repo);
        const [owner, ...rest] = repo.split("/");
        const types = new Map<string, number>();
        for (const c of list)
          types.set(commitType(c.title), (types.get(commitType(c.title)) ?? 0) + 1);
        day.rows.push({
          kind: "commits",
          key: `commits:${day.date}:${repo}`,
          repository: repo,
          owner: rest.length ? owner : "",
          name: rest.length ? rest.join("/") : repo,
          items: list,
          total,
          ticket: topTicket(list),
          typeCounts: [...types.entries()].sort((a, b) => b[1] - a[1]),
        });
        continue;
      }
      if (item.source === "visit") {
        const existing = visits.get(item.title);
        if (existing) {
          existing.repeat += 1;
          continue;
        }
        const row: ItemRow = { kind: "item", key: `visit:${item.id}`, item, repeat: 1 };
        visits.set(item.title, row);
        day.rows.push(row);
        continue;
      }
      day.rows.push({ kind: "item", key: `${item.source}:${item.id}`, item, repeat: 1 });
    }
  }
  return days;
}

/**
 * "대부분 perf 작업" line for a large commit group: only when one conventional
 * type holds at least half of five or more commits.
 */
export function commitGroupFact(group: CommitGroup): Fact | null {
  const n = group.items.length;
  const [type, count] = group.typeCounts[0] ?? ["", 0];
  if (n < 5 || count / n < 0.5 || type === "other" || type === "merge" || /\d/.test(type)) {
    return null;
  }
  return diagnosis({
    id: `search.commits.${group.key}`,
    metric: "commits",
    metricLabel: "커밋",
    period: { from: group.items.at(-1)?.date ?? "", to: group.items[0]?.date ?? "", label: "이날" },
    value: count,
    unit: "count",
    unitLabel: "건",
    template: `{total}건 중 대부분 ${TYPE_LABELS[type] ?? type} 작업({fact})이에요.`,
    detail: { total: n, trigger: `${type} ${count}건` },
    rows: [
      { label: "유형", value: group.typeCounts.map(([t, c]) => `${t} ${c}`).join(" · ") },
      ...(group.ticket ? [{ label: "티켓", value: group.ticket }] : []),
    ],
  });
}
