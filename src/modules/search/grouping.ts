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
        // The server's counts cover the whole day's group (the page may hold only
        // a few of its commits); fall back to the loaded rows.
        const types = new Map<string, number>(Object.entries(list[0]?.groupTypes ?? {}));
        if (types.size === 0) {
          for (const c of list)
            types.set(commitType(c.title), (types.get(commitType(c.title)) ?? 0) + 1);
        }
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

/** Leading conventional type and the line it earns, or null for no line. */
function groupLead(
  typeCounts: [string, number][],
  n: number
): { type: string; count: number; template: string } | null {
  const typed = typeCounts.filter(([t]) => t !== "other" && t !== "merge" && !/\d/.test(t));
  const [type, count] = typed[0] ?? ["", 0];
  const majority = count / n >= 0.5;
  if (!type || (!majority && (count < 3 || count === (typed[1]?.[1] ?? 0)))) return null;
  const label = TYPE_LABELS[type] ?? type;
  if (!majority)
    return { type, count, template: `{total}건 중 ${label} 작업이 가장 많아요({fact}).` };
  const lead =
    count === n ? "{total}건 모두" : `{total}건 중 ${count / n >= 0.75 ? "대부분" : "절반 넘게"}`;
  return { type, count, template: `${lead} ${label} 작업({fact})이에요.` };
}

/**
 * The AI line for a commit group of five or more. Counted over the whole day's
 * group (server type counts), so the quantifier matches the real share.
 * - One conventional type holds at least half → "N건 중 대부분/절반 넘게 X 작업".
 * - Otherwise the leading conventional type (other/merge never lead) with at
 *   least 3 commits and a strict lead over the runner-up → "N건 중 X 작업이 가장 많아요".
 * - Groups under five, untyped groups, or a tie at the top get no line.
 */
export function commitGroupFact(group: CommitGroup): Fact | null {
  const n = group.typeCounts.reduce((sum, [, c]) => sum + c, 0);
  const lead = n < 5 ? null : groupLead(group.typeCounts, n);
  if (!lead) return null;
  const { type, count, template } = lead;
  return diagnosis({
    id: `search.commits.${group.key}`,
    metric: "commits",
    metricLabel: "커밋",
    period: { from: group.items.at(-1)?.date ?? "", to: group.items[0]?.date ?? "", label: "이날" },
    value: count,
    unit: "count",
    unitLabel: "건",
    template,
    detail: { total: n, trigger: `${type} ${count}건` },
    rows: [
      { label: "유형", value: group.typeCounts.map(([t, c]) => `${t} ${c}`).join(" · ") },
      ...(group.ticket ? [{ label: "티켓", value: group.ticket }] : []),
    ],
  });
}

/** Tab counts: exact below 1,000, then a short real figure ("1.2천", "3.4만"). */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const [div, unit] = n < 10_000 ? [1000, "천"] : [10_000, "만"];
  const v = n / div;
  return `${v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10}${unit}`;
}
