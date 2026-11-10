import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import { commitGroupFact, compactCount, groupByDay, splitCommitTitle } from "./grouping";
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
      "5건 중 대부분 성능 작업(4건)이에요."
    );
    const [small] = groupByDay(items.slice(0, 3))[0].rows;
    if (small.kind !== "commits") throw new Error("expected group");
    expect(commitGroupFact(small)).toBeNull();
  });
});

describe("groupByDay with collapsed commit groups", () => {
  it("counts the whole group once and keeps a two-row group from a larger total", () => {
    const days = groupByDay([
      { ...commit("a", "fix: one"), groupTotal: 29 },
      { ...commit("b", "fix: two"), groupTotal: 29 },
      visit("v1", "집"),
    ]);
    expect(days[0].total).toBe(30);
    expect(days[0].rows[0]).toMatchObject({ kind: "commits", total: 29 });
    expect((days[0].rows[0] as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe("commit group line over the whole day's group", () => {
  it("uses the server's type counts when the view carries only a few rows", () => {
    const types = { perf: 12, fix: 6, other: 5 };
    const [group] = groupByDay([
      { ...commit("a", "perf: a"), groupTotal: 23, groupTypes: types },
      { ...commit("b", "fix: b"), groupTotal: 23, groupTypes: types },
      { ...commit("c", "perf: c"), groupTotal: 23, groupTypes: types },
    ])[0].rows;
    if (group.kind !== "commits") throw new Error("expected group");
    expect(renderTemplate(commitGroupFact(group)!).text).toBe(
      "23건 중 절반 넘게 성능 작업(12건)이에요."
    );
  });

  it("says 모두 rather than 대부분 when every commit has the type", () => {
    const items = ["perf: a", "perf: b", "perf: c", "perf: d", "perf: e"].map((t, i) =>
      commit(String(i), t)
    );
    const [group] = groupByDay(items)[0].rows;
    if (group.kind !== "commits") throw new Error("expected group");
    expect(renderTemplate(commitGroupFact(group)!).text).toBe("5건 모두 성능 작업이에요.");
  });
});

describe("commit group line without a majority type", () => {
  const group = (types: Record<string, number>, total: number) => {
    const [g] = groupByDay([
      { ...commit("a", "fix: a"), groupTotal: total, groupTypes: types },
      { ...commit("b", "fix: b"), groupTotal: total, groupTypes: types },
    ])[0].rows;
    if (g.kind !== "commits") throw new Error("expected group");
    return g;
  };

  it("names the leading conventional type, never other/merge", () => {
    const g = group({ other: 17, fix: 11, feat: 5, docs: 3, test: 2 }, 38);
    expect(renderTemplate(commitGroupFact(g)!).text).toBe("38건 중 수정 작업이 가장 많아요(11건).");
  });

  it("stays silent on a tie at the top or a lead under three", () => {
    expect(commitGroupFact(group({ other: 6, fix: 3, feat: 3 }, 12))).toBeNull();
    expect(commitGroupFact(group({ other: 6, fix: 2, feat: 1 }, 9))).toBeNull();
  });
});

describe("compactCount", () => {
  it("keeps small counts exact and shortens large ones without a fake cap", () => {
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1000)).toBe("1천");
    expect(compactCount(1290)).toBe("1.2천");
    expect(compactCount(34_567)).toBe("3.4만");
    expect(compactCount(1_234_567)).toBe("123만");
  });
});
