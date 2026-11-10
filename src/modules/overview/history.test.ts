process.env.TZ = "Asia/Seoul";

import { describe, expect, it, vi } from "vitest";
import {
  buildOverviewHistory,
  type HistorySnapshotRow,
  historyPlan,
  periodDateRange,
  shiftPeriodKey,
} from "./history";
import { getOverviewHistory } from "./history-store";

function row(
  overrides: Partial<HistorySnapshotRow> & Pick<HistorySnapshotRow, "periodType" | "periodKey">
): HistorySnapshotRow {
  return {
    codingStatus: "ready",
    dailyCommits: [],
    spendingStatus: "ready",
    spendingDaily: [],
    healthStatus: "ready",
    healthMetrics: [],
    weightSeries: [],
    ...overrides,
  };
}

describe("period key helpers", () => {
  it("shifts months, weeks and years across boundaries", () => {
    expect(shiftPeriodKey("month", "2026-01", -1)).toBe("2025-12");
    expect(shiftPeriodKey("month", "2026-10", -9)).toBe("2026-01");
    expect(shiftPeriodKey("week", "2026-W01", -1)).toBe("2025-W52");
    expect(shiftPeriodKey("week", "2026-W45", 1)).toBe("2026-W46");
    expect(shiftPeriodKey("year", "2026", -1)).toBe("2025");
  });

  it("returns inclusive KST date ranges", () => {
    expect(periodDateRange("month", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodDateRange("week", "2026-W45")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });
});

describe("historyPlan", () => {
  it("asks for ten months, the previous month and the overlapping years", () => {
    const plan = historyPlan("month", "2026-10", "2026-11-10");
    expect(plan.series.map((p) => p.periodKey)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(plan.previous).toEqual({ periodType: "month", periodKey: "2026-09" });
    const years = plan.snapshotKeys.find((k) => k.periodType === "year");
    expect(years?.periodKeys).toEqual(["2026"]);
  });

  it("uses the months of a year up to today and the previous year", () => {
    const plan = historyPlan("year", "2026", "2026-11-10");
    expect(plan.series.map((p) => p.periodKey)).toEqual(
      Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)
    );
    expect(plan.previous).toEqual({ periodType: "year", periodKey: "2025" });
    expect(plan.snapshotKeys.find((k) => k.periodType === "year")?.periodKeys.sort()).toEqual([
      "2025",
      "2026",
    ]);
  });

  it("spans two years for weeks crossing new year", () => {
    const plan = historyPlan("week", "2026-W02", "2026-11-10");
    expect(plan.series[0].periodKey).toBe("2025-W45");
    expect(plan.snapshotKeys.find((k) => k.periodType === "year")?.periodKeys.sort()).toEqual([
      "2025",
      "2026",
    ]);
  });
});

describe("buildOverviewHistory", () => {
  it("prefers a period's own snapshot and falls back to a covering year snapshot", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [
        row({
          periodType: "year",
          periodKey: "2026",
          dailyCommits: [
            { date: "2026-08-03", count: 5 },
            { date: "2026-09-01", count: 7 },
            { date: "2026-10-01", count: 999 },
          ],
          spendingDaily: [{ date: "2026-09-02", spending: 10_000, income: 0 }],
          healthMetrics: [
            {
              metric: "steps",
              days: [
                { date: "2026-09-01", value: 3000 },
                { date: "2026-09-02", value: 5000 },
              ],
            },
            { metric: "heart_rate", days: [{ date: "2026-09-01", value: 70 }] },
          ],
          weightSeries: [
            { date: "2026-09-06", weight: 90.5 },
            { date: "2026-09-29", weight: 87.1 },
          ],
        }),
        row({
          periodType: "month",
          periodKey: "2026-10",
          dailyCommits: [
            { date: "2026-10-01", count: 3 },
            { date: "2026-10-02", count: 0 },
            { date: "2026-10-09", count: 4 },
          ],
          spendingDaily: [{ date: "2026-10-02", spending: 54_900, income: 8_738_100 }],
          weightSeries: [{ date: "2026-10-27", weight: 85.7 }],
        }),
      ],
    });

    const october = history.series.at(-1);
    expect(october).toMatchObject({
      periodKey: "2026-10",
      commits: 7,
      activeDays: 2,
      spending: 54_900,
      income: 8_738_100,
      inProgress: false,
      weight: { date: "2026-10-27", weight: 85.7 },
    });
    expect(history.previous).toMatchObject({
      periodKey: "2026-09",
      commits: 7,
      activeDays: 1,
      spending: 10_000,
      income: 0,
      steps: { total: 8000, days: 2 },
      heartRate: 70,
      weight: { date: "2026-09-29", weight: 87.1 },
    });
    expect(history.weight.map((w) => w.date)).toEqual(["2026-09-06", "2026-09-29", "2026-10-27"]);
  });

  it("leaves uncovered periods null instead of zero", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [row({ periodType: "month", periodKey: "2026-10", codingStatus: "failed" })],
    });
    expect(history.series[0]).toMatchObject({
      periodKey: "2026-01",
      commits: null,
      spending: null,
    });
    expect(history.series.at(-1)?.commits).toBeNull();
    expect(history.series.at(-1)?.spending).toBe(0);
    expect(history.previous).toBeNull();
  });

  it("only needs coverage up to today for the period in progress", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-11",
      today: "2026-11-10",
      rows: [
        row({
          periodType: "week",
          periodKey: "2026-W45",
          dailyCommits: [{ date: "2026-11-02", count: 2 }],
        }),
        row({
          periodType: "month",
          periodKey: "2026-11",
          dailyCommits: [
            { date: "2026-11-02", count: 2 },
            { date: "2026-11-09", count: 1 },
          ],
        }),
      ],
    });
    expect(history.series.at(-1)).toMatchObject({ inProgress: true, commits: 3, activeDays: 2 });
  });
});

describe("snapshots still being computed", () => {
  it("marks their periods unknown instead of empty, and never reads their data", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [
        row({
          periodType: "month",
          periodKey: "2026-08",
          status: "computing",
          dailyCommits: [{ date: "2026-08-03", count: 99 }],
        }),
        row({ periodType: "month", periodKey: "2026-09", status: "pending" }),
        row({ periodType: "month", periodKey: "2026-10" }),
      ],
    });
    const byKey = new Map(history.series.map((p) => [p.periodKey, p]));
    expect(byKey.get("2026-08")).toMatchObject({ commits: null, pending: true });
    expect(byKey.get("2026-09")).toMatchObject({ commits: null, pending: true });
    expect(byKey.get("2026-07")).toMatchObject({ commits: null, pending: false });
    expect(byKey.get("2026-10")).toMatchObject({ commits: 0, pending: false });
    // No comparison against a month that is still being computed.
    expect(history.previous).toBeNull();
  });

  it("uses a ready covering snapshot over a pending one", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [
        row({
          periodType: "year",
          periodKey: "2026",
          dailyCommits: [{ date: "2026-09-04", count: 7 }],
        }),
        row({ periodType: "month", periodKey: "2026-09", status: "pending" }),
      ],
    });
    expect(history.previous).toMatchObject({ commits: 7, pending: false });
  });
});

describe("same-span comparison base", () => {
  const october = row({
    periodType: "month",
    periodKey: "2026-10",
    dailyCommits: [
      { date: "2026-10-03", count: 40 },
      { date: "2026-10-10", count: 60 },
      { date: "2026-10-11", count: 4000 },
    ],
    spendingDaily: [
      { date: "2026-10-05", spending: 10_000, income: 0 },
      { date: "2026-10-20", spending: 900_000, income: 0 },
    ],
  });

  it("cuts both sides at yesterday: today's partial day is never compared", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-11",
      today: "2026-11-10",
      rows: [october],
    });
    expect(history.previous).toMatchObject({ commits: 4100, spending: 910_000 });
    // 11/1–11/9 (nine settled days) vs 10/1–10/9: the 60 commits of 10/10 stay out.
    expect(history.previousToDate).toMatchObject({
      periodKey: "2026-10",
      from: "2026-10-01",
      to: "2026-10-09",
      commits: 40,
      activeDays: 1,
      spending: 10_000,
    });
  });

  it("matches the settled weekdays of a week in progress", () => {
    const history = buildOverviewHistory({
      periodType: "week",
      periodKey: "2026-W46",
      today: "2026-11-11",
      rows: [
        row({
          periodType: "week",
          periodKey: "2026-W45",
          dailyCommits: [
            { date: "2026-11-02", count: 5 },
            { date: "2026-11-03", count: 7 },
            { date: "2026-11-04", count: 100 },
          ],
        }),
      ],
    });
    expect(history.previousToDate).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-03",
      commits: 12,
    });
  });

  it("has no comparison on the first day of a period (only today has elapsed)", () => {
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-11",
      today: "2026-11-01",
      rows: [october],
    });
    expect(history.previousToDate).toBeNull();
  });

  it("has no comparison once the settled span outgrows a shorter previous period", () => {
    const feb = row({
      periodType: "month",
      periodKey: "2026-02",
      dailyCommits: [{ date: "2026-02-10", count: 3 }],
    });
    // 3/1–3/28 vs all of February: equal day counts, still comparable.
    const march29 = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-03",
      today: "2026-03-29",
      rows: [feb],
    });
    expect(march29.previousToDate).toMatchObject({ to: "2026-02-28", commits: 3 });
    // 3/1–3/30 against a 28-day February would compare unequal spans.
    for (const today of ["2026-03-31", "2026-03-30"]) {
      const march = buildOverviewHistory({
        periodType: "month",
        periodKey: "2026-03",
        today,
        rows: [feb],
      });
      expect(march.previousToDate).toBeNull();
    }
    // 31st after a 30-day month: 12/1–12/30 vs all of November is equal.
    const dec = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-12",
      today: "2026-12-31",
      rows: [row({ periodType: "month", periodKey: "2026-11", dailyCommits: [] })],
    });
    expect(dec.previousToDate).toMatchObject({ to: "2026-11-30" });
    // ...but 31st after a 31-day month is an ordinary cut.
    const aug = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-08",
      today: "2026-08-31",
      rows: [row({ periodType: "month", periodKey: "2026-07", dailyCommits: [] })],
    });
    expect(aug.previousToDate).toMatchObject({ to: "2026-07-30" });
  });

  it("cuts the previous year at the same month-day, not the same day count", () => {
    const year = (periodKey: string) =>
      row({
        periodType: "year",
        periodKey,
        dailyCommits: [{ date: `${periodKey}-01-05`, count: 1 }],
      });
    // 2024 is a leap year: day-count arithmetic would land on 2023-03-02.
    const leap = buildOverviewHistory({
      periodType: "year",
      periodKey: "2024",
      today: "2024-03-02",
      rows: [year("2023")],
    });
    expect(leap.previousToDate).toMatchObject({ from: "2023-01-01", to: "2023-03-01" });
    // Day after a leap day: 02-29 has no counterpart and clamps to 02-28.
    const afterLeapDay = buildOverviewHistory({
      periodType: "year",
      periodKey: "2028",
      today: "2028-03-01",
      rows: [year("2027")],
    });
    expect(afterLeapDay.previousToDate).toMatchObject({ to: "2027-02-28" });
    // The year after a leap year: day-count arithmetic would land on 2024-11-08.
    const after = buildOverviewHistory({
      periodType: "year",
      periodKey: "2025",
      today: "2025-11-10",
      rows: [year("2024")],
    });
    expect(after.previousToDate).toMatchObject({ to: "2024-11-09", commits: 1 });
  });

  it("is absent once a period ends", () => {
    const ended = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [october],
    });
    expect(ended.previousToDate).toBeNull();
  });
});

describe("stale health day values", () => {
  it("drops a larger snapshot's days that a fresher smaller snapshot no longer has", () => {
    const steps = (days: { date: string; value: number }[]) => [
      { metric: "steps", days },
      { metric: "heart_rate", days: days.map((d) => ({ date: d.date, value: d.value / 100 })) },
    ];
    const history = buildOverviewHistory({
      periodType: "month",
      periodKey: "2026-10",
      today: "2026-11-10",
      rows: [
        row({
          periodType: "year",
          periodKey: "2026",
          healthMetrics: steps([
            { date: "2026-10-03", value: 9000 },
            { date: "2026-10-04", value: 5000 },
          ]) as HistorySnapshotRow["healthMetrics"],
        }),
        // The month was recomputed after 10/4's (bad) record was removed.
        row({
          periodType: "month",
          periodKey: "2026-10",
          healthMetrics: steps([
            { date: "2026-10-03", value: 9000 },
          ]) as HistorySnapshotRow["healthMetrics"],
        }),
      ],
    });
    const oct = history.series.at(-1);
    expect(oct?.steps).toEqual({ total: 9000, days: 1 });
    expect(oct?.heartRate).toBe(90);
  });
});

describe("getOverviewHistory", () => {
  it("rejects recent and non-canonical keys", async () => {
    const store = { findHistorySnapshots: vi.fn(async () => []) };
    await expect(getOverviewHistory(store, "u", "recent", "2026-11-10")).rejects.toMatchObject({
      status: 400,
    });
    await expect(getOverviewHistory(store, "u", "month", "2026-13")).rejects.toMatchObject({
      status: 400,
    });
    expect(store.findHistorySnapshots).not.toHaveBeenCalled();
  });

  it("reads the planned snapshots for the caller only", async () => {
    const store = { findHistorySnapshots: vi.fn(async () => []) };
    const result = await getOverviewHistory(
      store,
      "user-1",
      "week",
      "2026-W45",
      new Date("2026-11-10T03:00:00Z")
    );
    expect(store.findHistorySnapshots).toHaveBeenCalledWith("user-1", expect.any(Array));
    expect(result.series).toHaveLength(10);
    expect(result.series.at(-1)?.periodKey).toBe("2026-W45");
  });
});
