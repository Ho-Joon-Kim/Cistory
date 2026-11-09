import { describe, expect, it } from "vitest";
import { barIndexAt, commitGraphBars, commitGraphLabel, commitLevel } from "./commit-graph";

const NOW = new Date("2026-11-09T13:00:00Z");

describe("commit graph", () => {
  it("maps counts to the five absolute levels", () => {
    expect([0, 1, 30, 31, 100, 101, 300, 301].map(commitLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it("keeps the last 28 days with √-scaled heights and marks today", () => {
    const stats = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-10-${String(i + 11).padStart(2, "0")}`.replace("2026-10-32", "2026-11-01"),
      count: 0,
    }));
    stats[10].count = 605; // 10월 21일
    stats[2].count = 196;
    stats[29] = { date: "2026-11-09", count: 22 };
    const bars = commitGraphBars(stats, "2026-11-09", NOW);
    expect(bars).toHaveLength(28);
    expect(bars[0].date).toBe(stats[2].date);
    expect(bars[0].height).toBe("57%");
    expect(bars[0].level).toBe(3);
    expect(bars.find((b) => b.count === 605)!.height).toBe("100%");
    expect(bars[1].height).toBeNull();
    const today = bars[bars.length - 1];
    expect(today.isToday).toBe(true);
    expect(today.height).toBe("19%");
    expect(today.tip).toBe("11월 9일 · 커밋 22");
    expect(commitGraphLabel(bars, NOW)).toBe(
      "최근 28일 커밋 823건 · 하루 최고 10월 21일 605건 · 오늘 22건"
    );
  });

  it("floors tiny days at 18% and summarizes an empty window", () => {
    const bars = commitGraphBars(
      [
        { date: "2026-11-08", count: 605 },
        { date: "2026-11-09", count: 7 },
      ],
      "2026-11-09",
      NOW
    );
    expect(bars[1].height).toBe("18%");
    expect(commitGraphLabel([], NOW)).toBe("최근 0일 커밋 0건");
  });
});

describe("barIndexAt", () => {
  it("maps a tap position to its bar, clamped to the strip", () => {
    expect(barIndexAt(100, 100, 112, 28)).toBe(0);
    expect(barIndexAt(105, 100, 112, 28)).toBe(1);
    expect(barIndexAt(211.9, 100, 112, 28)).toBe(27);
    expect(barIndexAt(90, 100, 112, 28)).toBe(0); // the padded hit area left of the strip
    expect(barIndexAt(260, 100, 112, 28)).toBe(27);
  });

  it("is safe for an empty strip", () => {
    expect(barIndexAt(10, 0, 0, 28)).toBe(0);
    expect(barIndexAt(10, 0, 100, 0)).toBe(0);
  });
});
