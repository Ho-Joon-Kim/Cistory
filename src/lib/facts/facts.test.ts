import { describe, expect, it } from "vitest";
import {
  applyChoices,
  concentration,
  deltaVsPrevious,
  diagnosis,
  evidenceMatches,
  eyo,
  type Fact,
  factRows,
  hasBatchim,
  iGa,
  oneOff,
  pickNotable,
  pickOne,
  recordLowHigh,
  renderTemplate,
  streak,
  templateChooser,
  validateTemplate,
} from "./index";

const NOW = new Date("2026-11-09T13:00:00Z");
const OCT = { from: "2026-10-01", to: "2026-10-31", label: "10월" };
// Real October 2026 daily commit counts from the owner's data (Main mockup).
const OCT_COMMITS = [
  18, 7, 0, 0, 93, 19, 127, 382, 391, 487, 131, 232, 196, 76, 76, 7, 0, 493, 316, 156, 605, 391, 78,
  0, 100, 34, 102, 59, 84, 13, 0,
];
const octSeries = OCT_COMMITS.map((value, i) => ({
  key: `2026-10-${String(i + 1).padStart(2, "0")}`,
  value,
}));

const text = (fact: Fact) => renderTemplate(fact).text;

describe("deltaVsPrevious", () => {
  it("computes the relative change and phrases it against the baseline", () => {
    const fact = deltaVsPrevious({
      id: "commits.delta",
      metric: "commits",
      metricLabel: "커밋",
      period: OCT,
      unit: "count",
      unitLabel: "건",
      current: 4673,
      previous: 4415,
      baselineLabel: "9월",
    });
    expect(fact).not.toBeNull();
    expect(fact!.detail!.ratio).toBeCloseTo(0.0584, 3);
    expect(fact!.score).toBeCloseTo(0.117, 2);
    expect(text(fact!)).toBe("9월보다 6% 많아요.");
    const rendered = renderTemplate(fact!);
    expect(rendered.segments.filter((s) => s.type === "fact")).toEqual([
      { type: "fact", text: "6%" },
    ]);
    expect(rendered.numeric).toBe(true);
    expect(factRows(fact!)).toEqual([
      { label: "10월 커밋", value: "4,673건" },
      { label: "9월 · 비교 기준", value: "4,415건 (+5.8%)" },
    ]);
  });

  it("returns null without a usable baseline and uses the down word", () => {
    const base = {
      id: "x",
      metric: "spending",
      metricLabel: "지출",
      period: OCT,
      unit: "won" as const,
      baselineLabel: "9월",
    };
    expect(deltaVsPrevious({ ...base, current: 10, previous: 0 })).toBeNull();
    expect(deltaVsPrevious({ ...base, current: 10, previous: null })).toBeNull();
    const down = deltaVsPrevious({ ...base, current: 50, previous: 100, downWord: "덜 썼어요" });
    expect(text(down!)).toBe("9월보다 50% 덜 썼어요.");
    expect(down!.score).toBe(1);
  });
});

describe("concentration", () => {
  it("finds the densest contiguous window and scores it against an even spread", () => {
    const fact = concentration({
      id: "commits.burst",
      metric: "commits",
      metricLabel: "커밋",
      period: OCT,
      unit: "count",
      unitLabel: "건",
      series: octSeries,
      windowSize: 5,
      now: NOW,
    })!;
    expect(fact.detail!.partValue).toBe(1961);
    expect(fact.detail!.windowFrom).toBe("2026-10-18");
    expect(fact.detail!.windowTo).toBe("2026-10-22");
    expect(fact.value).toBeCloseTo(1961 / 4673, 4);
    expect(fact.score).toBeGreaterThan(0.6);
    expect(text(fact)).toBe("그중 42%(1,961건)가 10월 18일–22일에 몰렸어요.");
    expect(fact.evidence).toEqual({ kind: "range", from: "2026-10-18", to: "2026-10-22" });
    expect(factRows(fact)).toEqual([
      { label: "10월 18일–22일 합", value: "1,961건" },
      { label: "10월 합", value: "4,673건" },
      { label: "비중", value: "42%" },
    ]);
  });

  it("scores an even series at zero and rejects degenerate input", () => {
    const even = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, value: 5 }));
    const base = {
      id: "e",
      metric: "m",
      metricLabel: "m",
      period: OCT,
      unit: "count" as const,
    };
    expect(concentration({ ...base, series: even, windowSize: 2 })!.score).toBeCloseTo(0, 5);
    expect(concentration({ ...base, series: even, windowSize: 10 })).toBeNull();
    expect(
      concentration({ ...base, series: even.map((p) => ({ ...p, value: 0 })), windowSize: 2 })
    ).toBeNull();
  });
});

describe("recordLowHigh", () => {
  const base = {
    id: "commits.max",
    metric: "commits",
    metricLabel: "커밋",
    period: OCT,
    unit: "count" as const,
    unitLabel: "건",
    series: octSeries,
    scopeLabel: "30일",
  };

  it("detects the highest point with a margin-based score", () => {
    const fact = recordLowHigh({ ...base, direction: "high", targetKey: "2026-10-21" })!;
    expect(fact.value).toBe(605);
    expect(fact.baseline!.value).toBe(493);
    expect(fact.score).toBeGreaterThan(0.9);
    expect(text(fact)).toBe("30일 중 가장 많은 605건이에요.");
    expect(evidenceMatches(fact.evidence, "2026-10-21")).toBe(true);
  });

  it("returns null when the target is not a record", () => {
    expect(recordLowHigh({ ...base, direction: "high", targetKey: "2026-10-01" })).toBeNull();
    expect(recordLowHigh({ ...base, direction: "low" })).toBeNull(); // last day 0 ties with others
  });
});

describe("oneOff", () => {
  it("flags a single dominating item", () => {
    const fact = oneOff({
      id: "spend.oneoff",
      metric: "spending",
      metricLabel: "지출",
      period: { from: "2026-11-01", to: "2026-11-09", label: "11월" },
      unit: "won",
      items: [
        { key: "t1", value: 1_800_000, label: "(주)휴메이크 헬스케어" },
        { key: "t2", value: 85_000 },
        { key: "t3", value: 9_280 },
      ],
      total: 2_083_890,
    })!;
    expect(fact.value).toBeCloseTo(0.864, 3);
    expect(fact.score).toBeGreaterThan(0.9);
    expect(text(fact)).toBe("한 건이 11월 지출 2,083,890원의 86%예요.");
    expect(factRows(fact)).toEqual([
      { label: "(주)휴메이크 헬스케어", value: "1,800,000원" },
      { label: "11월 지출", value: "2,083,890원" },
      { label: "나머지 중 최대", value: "85,000원" },
    ]);
  });

  it("scores an even list low", () => {
    const fact = oneOff({
      id: "flat",
      metric: "spending",
      metricLabel: "지출",
      period: OCT,
      unit: "won",
      items: [
        { key: "a", value: 100 },
        { key: "b", value: 95 },
        { key: "c", value: 90 },
      ],
    })!;
    expect(fact.score).toBeLessThan(0.1);
  });
});

describe("streak", () => {
  it("counts the trailing run and rewards the longest run", () => {
    const days = [true, true, false, true, true, true, true].map((active, i) => ({
      key: `2026-11-0${i + 1}`,
      active,
    }));
    const fact = streak({
      id: "commit.streak",
      metric: "commits",
      metricLabel: "커밋",
      period: { from: "2026-11-01", to: "2026-11-07", label: "11월" },
      days,
    })!;
    expect(fact.value).toBe(4);
    expect(fact.score).toBeCloseTo(4 / 14 + 0.25, 5);
    expect(text(fact)).toBe("커밋이 4일째 이어지고 있어요.");
    expect(fact.evidence).toEqual({ kind: "range", from: "2026-11-04", to: "2026-11-07" });
    expect(evidenceMatches(fact.evidence, "2026-11-05")).toBe(true);
    expect(evidenceMatches(fact.evidence, "2026-11-03")).toBe(false);
  });

  it("scores a short or broken run at zero", () => {
    const fact = streak({
      id: "s",
      metric: "m",
      metricLabel: "걸음",
      period: OCT,
      days: [
        { key: "a", active: true },
        { key: "b", active: false },
      ],
    })!;
    expect(fact.value).toBe(0);
    expect(fact.score).toBe(0);
  });
});

describe("templates", () => {
  const delta = deltaVsPrevious({
    id: "d",
    metric: "commits",
    metricLabel: "커밋",
    period: OCT,
    unit: "count",
    unitLabel: "건",
    current: 4673,
    previous: 4415,
    baselineLabel: "9월",
  })!;

  it("renders custom templates with named placeholders", () => {
    const r = renderTemplate(
      delta,
      "{period} {metric}는 {value}, {baseline}({baselineValue})보다 {fact} 늘었어요."
    );
    expect(r.text).toBe("10월 커밋는 4,673건, 9월(4,415건)보다 6% 늘었어요.");
  });

  it("validates templates", () => {
    expect(validateTemplate(delta, "{fact}만큼")).toEqual([]);
    expect(validateTemplate(delta, "no trigger")).toContain("expected exactly one {fact}, found 0");
    expect(validateTemplate(delta, "{fact} {nope}")).toContain("unknown placeholder {nope}");
    expect(validateTemplate(delta, "{fact} 12% 많아요")).toContain(
      "numbers must come from placeholders, not the template text"
    );
    expect(() => renderTemplate(delta, "{fact}{fact}")).toThrow();
  });

  it("supports diagnosis sentences written by the caller", () => {
    const fact = diagnosis({
      id: "wakatime.diag",
      metric: "wakatime",
      metricLabel: "WakaTime",
      period: { from: "2026-10-11", to: "2026-11-09", label: "최근 30일" },
      value: 3330,
      unit: "count",
      unitLabel: "건",
      template: "같은 30일 동안 GitHub 커밋 {fact}은 들어왔어요 — 수집이 멈춘 쪽은 WakaTime이에요.",
      detail: { trigger: "3,330건" },
    });
    expect(text(fact)).toBe(
      "같은 30일 동안 GitHub 커밋 3,330건은 들어왔어요 — 수집이 멈춘 쪽은 WakaTime이에요."
    );
    expect(fact.score).toBe(1);
  });

  it("applies Korean particles", () => {
    expect(hasBatchim("건")).toBe(true);
    expect(hasBatchim("보")).toBe(false);
    expect(eyo("86%")).toBe("예요");
    expect(eyo("605건")).toBe("이에요");
    expect(iGa("지출")).toBe("이");
    expect(iGa("소비")).toBe("가");
    expect(iGa("1,961건")).toBe("이");
  });
});

describe("choosing", () => {
  const mk = (id: string, score: number): Fact => ({
    id,
    kind: "delta",
    metric: "m",
    metricLabel: "m",
    period: OCT,
    value: 2,
    unit: "count",
    baseline: { value: 1, label: "9월", kind: "previous" },
    detail: { ratio: 1 },
    score,
  });

  it("keeps facts above the threshold, most notable first", () => {
    const picked = pickNotable([mk("a", 0.4), mk("b", 0.9), null, mk("c", 0.6), mk("d", 0.9)]);
    expect(picked.map((f) => f.id)).toEqual(["b", "d", "c"]);
    expect(pickOne([mk("a", 0.2)])).toBeNull();
    expect(pickNotable([mk("a", 0.9), mk("b", 0.8)], 0.5, 1).map((f) => f.id)).toEqual(["a"]);
  });

  it("falls back to default templates when a chooser's template is invalid", async () => {
    const facts = [mk("a", 0.9), mk("b", 0.1)];
    const choices = await templateChooser.choose(facts);
    expect(choices).toEqual([{ factId: "a" }]);
    const rendered = applyChoices(facts, [
      { factId: "a", template: "{fact} 123" },
      { factId: "zzz" },
    ]);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].text).toBe("9월보다 100% 많아요.");
  });
});
