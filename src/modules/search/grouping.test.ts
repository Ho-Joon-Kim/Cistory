import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import { commitGroupFact, groupByDay, splitCommitTitle } from "./grouping";
import type { SearchItem } from "./types";

const commit = (id: string, title: string, date = "2026-11-09"): SearchItem => ({
  id,
  source: "commit",
  title,
  description: "dev/core",
  repository: "dev/core",
  date,
  href: `https://github.com/dev/core/commit/${id}`,
});
const visit = (id: string, title: string): SearchItem => ({
  id,
  source: "visit",
  title,
  description: "서울",
  date: "2026-11-09",
  href: "/dashboard?date=2026-11-09",
});

describe("groupByDay", () => {
  it("collapses same-repo commits, merges repeat visits and keeps day order", () => {
    const days = groupByDay([
      commit("a", "perf(api): one (RE-1)"),
      visit("v1", "집"),
      commit("b", "perf(api): two (RE-1)"),
      visit("v2", "집"),
      commit("c", "fix: three", "2026-11-08"),
    ]);
    expect(days.map((d) => [d.date, d.total])).toEqual([
      ["2026-11-09", 4],
      ["2026-11-08", 1],
    ]);
    const [group, home] = days[0].rows;
    expect(group).toMatchObject({ kind: "commits", name: "core", owner: "dev", ticket: "RE-1" });
    expect(home).toMatchObject({ kind: "item", repeat: 2 });
    expect(days[1].rows[0]).toMatchObject({ kind: "item" });
  });

  it("splits conventional titles into tag and body", () => {
    expect(splitCommitTitle("fix(web): 시한을 늘린다 (RE-1008)")).toEqual({
      tag: "fix(web)",
      body: "시한을 늘린다",
    });
    expect(splitCommitTitle("Merge branch 'x'")).toEqual({
      tag: "merge",
      body: "Merge branch 'x'",
    });
  });

  it("names the dominant commit type only for big, one-sided groups", () => {
    const items = ["perf: a", "perf: b", "perf: c", "fix: d", "perf: e"].map((t, i) =>
      commit(String(i), t)
    );
    const [group] = groupByDay(items)[0].rows;
    if (group.kind !== "commits") throw new Error("expected group");
    expect(renderTemplate(commitGroupFact(group)!).text).toBe(
      "5건 중 대부분 성능 작업(perf 4건)이에요."
    );
    const [small] = groupByDay(items.slice(0, 3))[0].rows;
    if (small.kind !== "commits") throw new Error("expected group");
    expect(commitGroupFact(small)).toBeNull();
  });
});
