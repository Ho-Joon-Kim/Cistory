import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import { rhrFact, sleepFact, stepsVisitsFact, weightFact, workoutFact } from "./health-facts";
import type { HealthMetricSeries, HealthSleepSession, HealthWorkout } from "./types";
import {
  activityMetric,
  activityWindow,
  buildNights,
  dayRange,
  detailRows,
  groupWorkouts,
  median,
  nightTicks,
  pearson,
  rhrView,
  sleepComparison,
  weightView,
  workoutIcon,
} from "./view-model";

const series = (
  key: string,
  pts: [string, number][],
  agg: "avg" | "sum" = "avg"
): HealthMetricSeries => ({
  key,
  label: key,
  unit: "",
  agg,
  scale: null,
  decimals: 0,
  points: pts.map(([day, v]) => ({
    day,
    avg: agg === "avg" ? v : null,
    min: v,
    max: v,
    sum: agg === "sum" ? v : null,
    count: 1,
  })),
});

const session = (
  start: string,
  minutes: number,
  stages: { deep: number; light: number; rem: number; awake: number },
  nap = false
): HealthSleepSession => ({
  start,
  minutes,
  stages,
  segments: [{ stage: "light", startMin: 0, endMin: minutes }],
  nap,
});

describe("numeric helpers", () => {
  it("median and pearson", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("dayRange is inclusive", () => {
    expect(dayRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("sleep", () => {
  const nights = buildNights([
    session("2026-11-08T17:07:00.000Z", 371, { deep: 42, light: 218, rem: 39, awake: 72 }),
    session("2026-11-08T05:00:00.000Z", 40, { deep: 0, light: 40, rem: 0, awake: 0 }, true),
    session("2026-11-07T18:04:00.000Z", 486, { deep: 61, light: 279, rem: 120, awake: 26 }),
    session("2026-11-04T15:27:00.000Z", 481, { deep: 68, light: 332, rem: 72, awake: 9 }),
    session("2026-11-03T17:24:00.000Z", 351, { deep: 46, light: 201, rem: 70, awake: 34 }),
    session("2026-10-31T15:53:00.000Z", 584, { deep: 52, light: 425, rem: 96, awake: 11 }),
  ]);

  it("drops naps and derives asleep + the KST wake day", () => {
    expect(nights).toHaveLength(5);
    expect(nights[0].asleep).toBe(299);
    expect(nights[0].wakeDay).toBe("2026-11-09");
  });

  it("ranks the night against the others", () => {
    const c = sleepComparison(nights, 0);
    expect(c?.rank).toBe("최근 5밤 중 가장 짧음");
    expect(c?.diff).toBe("중앙값 7시간 40분보다 2시간 41분 짧음");
    expect(c?.efficiency).toBe(81);
  });

  it("explains an unusually wakeful night", () => {
    const fact = sleepFact(nights, 0);
    expect(fact?.id).toBe("health.sleep.awake");
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["stage:awake"] });
    expect(renderTemplate(fact!).text).toBe(
      "깨어 있던 시간이 72분으로 다른 4밤 중앙값 19분의 3.9배예요. 효율 81%가 낮은 이유예요."
    );
    expect(sleepFact(nights, 2)).toBeNull();
  });

  it("puts KST full-hour ticks inside the night", () => {
    expect(nightTicks(nights[0]).map((t) => t.label)).toEqual([
      "03:00",
      "04:00",
      "05:00",
      "06:00",
      "07:00",
      "08:00",
    ]);
  });
});

describe("resting heart rate", () => {
  const days = dayRange("2026-10-28", "2026-11-09");
  const s = series("resting_heart_rate", [
    ["2026-10-28", 62],
    ["2026-10-29", 65],
    ["2026-10-31", 64],
    ["2026-11-02", 64],
    ["2026-11-05", 61],
    ["2026-11-08", 60],
    ["2026-11-09", 59],
  ]);
  const view = rhrView(s, days)!;

  it("finds the non-increasing run ending today", () => {
    expect(view.latest).toBe(59);
    expect(view.days[view.runStart]).toBe("2026-10-29");
    expect(view.runDays).toBe(11);
    expect(view.cmp).toBe("12일 중 최저");
    expect(view.diff).toBe("중앙값 62보다 3 낮음");
  });

  it("phrases the run", () => {
    const fact = rhrFact(view);
    expect(renderTemplate(fact!).text).toBe(
      "10월\u00A029일 65부터 한 번도 오르지 않고 11일 동안 −6bpm 내려왔어요."
    );
    expect(fact?.evidence).toEqual({
      kind: "keys",
      keys: ["2026-10-29", "2026-10-31", "2026-11-02", "2026-11-05", "2026-11-08", "2026-11-09"],
    });
  });

  it("is null without data", () => {
    expect(rhrView(undefined, days)).toBeNull();
    expect(rhrFact(null)).toBeNull();
  });
});

describe("weight", () => {
  const pts = Array.from({ length: 16 }, (_, i) => ({
    date: `2026-10-${String(i + 10).padStart(2, "0")}`,
    weight: i < 2 ? 90 : i < 9 ? 88 : 86,
  }));
  const view = weightView(pts, "2026-11-09")!;

  it("summarizes peak, low and the drop from the peak", () => {
    expect(view.peak.weight).toBe(90);
    expect(view.low.weight).toBe(86);
    expect(view.fromPeak).toBe(-4);
  });

  it("compares the last 7 weigh-ins with the 7 before", () => {
    const fact = weightFact(view);
    expect(renderTemplate(fact!).text).toBe(
      "최근 7회 평균 86.0kg, 그 전 7회보다 2.0kg 낮아요. 최고점 이후 2주째 줄고 있어요."
    );
  });

  it("drops measurements outside the window", () => {
    expect(weightView([{ date: "2025-01-01", weight: 80 }], "2026-11-09")).toBeNull();
  });
});

describe("activity", () => {
  it("treats the sync day as partial and the day before as the latest full day", () => {
    const win = activityWindow("2026-11-10", "2026-11-09T07:00:11.716Z");
    expect(win.days).toHaveLength(31);
    expect(win.partialDay).toBe("2026-11-09");
    expect(win.fullDay).toBe("2026-11-08");
    const m = activityMetric(
      { key: "steps", label: "걸음", unit: "걸음", decimals: 0 },
      series(
        "steps",
        [
          ["2026-11-06", 3000],
          ["2026-11-07", 1000],
          ["2026-11-08", 4969],
          ["2026-11-09", 1803],
        ],
        "sum"
      ),
      win
    );
    expect(m.latest).toBe(4969);
    // the partial day never feeds the median
    expect(m.median).toBe(3000);
  });

  it("defaults the partial day to today without a sync time", () => {
    expect(activityWindow("2026-11-10", null).fullDay).toBe("2026-11-09");
  });

  it("correlates steps with visits, excluding today", () => {
    const days = Array.from({ length: 8 }, (_, i) => ({
      day: `2026-11-0${i + 1}`,
      steps: (i + 1) * 1000,
      visits: i + 1,
      codingMin: null,
    }));
    const fact = stepsVisitsFact(
      [...days, { day: "2026-11-09", steps: 1, visits: 99, codingMin: null }],
      "2026-11-09"
    );
    expect(fact?.detail?.trigger).toBe("8,000걸음");
    expect(fact?.evidence).toEqual({ kind: "range", from: "2026-11-01", to: "2026-11-08" });
    expect(stepsVisitsFact(days.slice(0, 3), "2026-11-09")).toBeNull();
  });
});

describe("workouts", () => {
  const w = (start: string, minutes: number, name: string, type: string): HealthWorkout => ({
    start,
    minutes,
    name,
    type,
  });
  const list = [
    w("2026-11-08T23:45:20.000Z", 14, "전기 자전거", "ELECTRIC_BIKE"), // Mon 08:45 KST
    w("2026-11-08T03:39:52.800Z", 17, "걷기", "WALKING"),
    w("2026-11-06T08:18:32.000Z", 10, "전기 자전거", "ELECTRIC_BIKE"), // Fri 17:18
    w("2026-11-06T06:54:00.000Z", 55, "근력 운동", "STRENGTH_TRAINING"),
    w("2026-11-04T23:58:00.000Z", 14, "전기 자전거", "ELECTRIC_BIKE"), // Thu 08:58
  ];

  it("groups by name, longest first", () => {
    const g = groupWorkouts(list);
    expect(g.map((x) => [x.name, x.count, x.minutes])).toEqual([
      ["근력 운동", 1, 55],
      ["전기 자전거", 3, 38],
      ["걷기", 1, 17],
    ]);
    expect(workoutIcon("ELECTRIC_BIKE")).toBe("bike");
    expect(workoutIcon("STRENGTH_TRAINING")).toBe("lift");
    expect(workoutIcon(null)).toBe("act");
  });

  it("notices a weekday-only routine", () => {
    const fact = workoutFact(list);
    expect(renderTemplate(fact!).text).toBe("전기 자전거 3회는 모두 평일 08:45–17:18 사이였어요.");
  });
});

describe("details", () => {
  it("summarizes each metric's latest value and 30-day range", () => {
    const days = dayRange("2026-11-07", "2026-11-09");
    const rows = detailRows(
      [
        series("hrv", [
          ["2026-11-07", 70],
          ["2026-11-09", 80],
        ]),
      ],
      days
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "심박 변이도",
      latest: 80,
      median: 75,
      min: 70,
      max: 80,
    });
  });
});
