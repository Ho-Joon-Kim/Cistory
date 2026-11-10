import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import {
  buildHero,
  buildSourceView,
  focusFact,
  formatDateRuns,
  intensityLevel,
  recoveryRange,
  rowFact,
  rowSubline,
  sortBySeverity,
} from "./insights";
import type { SourceId, SourceStatus } from "./types";

const NOW = new Date("2026-11-09T05:00:00Z"); // 14:00 KST, 11월 9일

function days(counts: number[], end = "2026-11-09") {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return counts.map((count, i) => ({
    date: new Date(endMs - (counts.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    count,
    state: count > 0 ? ("observed" as const) : ("unknown" as const),
  }));
}

function source(id: SourceId, counts: number[], patch: Partial<SourceStatus> = {}): SourceStatus {
  return {
    id,
    label: id,
    connected: true,
    needsReauth: false,
    lastSuccessAt: "2026-11-09T04:00:00Z",
    lastRecordAt: null,
    error: null,
    stale: false,
    canRecover: id === "health" || id === "wakatime" || id === "withings",
    recoveryHelp: "",
    days: days(counts),
    retained: null,
    ...patch,
  };
}

describe("intensityLevel", () => {
  it("uses one log10 scale for every source", () => {
    expect([0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 50000].map(intensityLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
  });
});

describe("buildSourceView", () => {
  it("hatches every empty day after the last success of a failing source", () => {
    const view = buildSourceView(
      source("wakatime", [0, 0, 0, 0, 0, 0, 0], {
        error: "실패",
        lastSuccessAt: "2026-09-06T08:00:00Z",
      }),
      NOW
    );
    expect(view.status).toBe("failed");
    expect(view.cells.every((c) => c.kind === "fail")).toBe(true);
    expect(view.daysSinceSuccess).toBe(63);
    expect(rowSubline(view, NOW)).toEqual({ text: "미동기화 63일", tone: "gain" });
  });

  it("keeps a re-auth source in the amber state on its subline", () => {
    const view = buildSourceView(
      source("wakatime", [0, 0, 0], { needsReauth: true, lastSuccessAt: "2026-09-06T08:00:00Z" }),
      NOW
    );
    expect(view.status).toBe("reauth");
    expect(rowSubline(view, NOW)).toEqual({ text: "다시 연결 필요", tone: "warn" });
  });

  it("names the retired API-key path, not an expired token, for a legacy WakaTime key", () => {
    const patch = { needsReauth: true, lastSuccessAt: "2026-09-06T08:00:00Z" };
    const legacy = buildSourceView(
      source("wakatime", [0, 0, 0], { ...patch, reauthReason: "legacy_key" }),
      NOW
    );
    const fact = focusFact(legacy, [legacy], NOW);
    expect(fact.rows?.find((r) => r.label === "오류")?.value).toBe(
      "API 키 읽기 중단됨 · OAuth로 다시 연결 필요"
    );
    expect(renderTemplate(fact).text).toContain("API 키로는 기록을 읽을 수 없게 바꿨어요");
    const expired = buildSourceView(
      source("wakatime", [0, 0, 0], { ...patch, reauthReason: "auth" }),
      NOW
    );
    expect(renderTemplate(focusFact(expired, [expired], NOW)).text).toContain(
      "제공자가 인증을 거부했어요"
    );
  });

  it("marks zero days of an expected-daily source as gaps, but never today", () => {
    const counts = [1600, 1500, 1400, 1360, 2238, 0, 0, 614, 1700, 0, 1800, 0];
    const view = buildSourceView(source("health", counts), NOW);
    expect(view.gaps).toEqual(["2026-11-03", "2026-11-04", "2026-11-07"]);
    expect(view.cells.at(-1)?.kind).toBe("none");
    expect(rowSubline(view, NOW).text).toBe("공백 3일 · 11월\u00A03일–4일, 7일");
    expect(recoveryRange(view)).toEqual({ from: "2026-11-03", to: "2026-11-07" });
  });

  it("treats empty commit days as plain no-record days", () => {
    const view = buildSourceView(source("github", [10, 0, 30, 40, 50, 0, 0, 20]), NOW);
    expect(view.gaps).toEqual([]);
    expect(view.emptyDays).toEqual(["2026-11-03", "2026-11-07", "2026-11-08"]);
  });
});

describe("hero and ordering", () => {
  it("leads with the worst source and counts healthy ones", () => {
    const views = [
      buildSourceView(source("location", [10_000, 12_000, 11_000, 9_000, 10_000, 9_500]), NOW),
      buildSourceView(
        source("wakatime", [0, 0, 0, 0, 0, 0], {
          error: "실패",
          lastSuccessAt: "2026-09-06T08:00:00Z",
        }),
        NOW
      ),
      buildSourceView(source("health", [100, 0, 120, 130, 140, 150]), NOW),
    ];
    const hero = buildHero(views);
    expect(hero.headline).toBe("3개 중 2개 정상");
    expect(hero.subline).toBe("WakaTime 63일째 동기화 실패");
    expect(hero.focus?.id).toBe("wakatime");
    expect(hero.gapNote?.id).toBe("health");
    expect(sortBySeverity(views).map((v) => v.id)).toEqual(["wakatime", "health", "location"]);
  });

  it("says everything is fine when it is", () => {
    const hero = buildHero([buildSourceView(source("toss", [3, 4, 5]), NOW)]);
    expect(hero.headline).toBe("1개 모두 정상");
    expect(hero.subline).toBeNull();
    expect(hero.focus).toBeNull();
  });
});

describe("facts", () => {
  it("explains weekend-heavy empty commit days", () => {
    // 2026-11-07 (토), 11-08 (일) are empty.
    const view = buildSourceView(source("github", [10, 20, 30, 40, 50, 0, 0, 20]), NOW);
    const fact = rowFact(view, NOW);
    expect(fact).not.toBeNull();
    expect(renderTemplate(fact!).text).toBe(
      "기록 없는 2일 중 2일이 주말이에요 — 수집 문제가 아니라 쉰 날로 보여요."
    );
  });

  it("omits the line when nothing is notable", () => {
    const view = buildSourceView(source("location", [10, 20, 30, 40, 50, 60]), NOW);
    expect(rowFact(view, NOW)).toBeNull();
  });

  it("formats gap runs compactly", () => {
    expect(formatDateRuns(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-22"], NOW)).toBe(
      "10월\u00A017일–19일, 22일"
    );
  });
});
