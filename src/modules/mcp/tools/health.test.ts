import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURATED_METRICS } from "@/modules/health/metrics-meta";
import { toolsForScopes } from "../server";
import {
  filterHealthMetricRows,
  HEALTH_TOOLS,
  healthRhythmTool,
  healthTool,
  MCP_HEALTH_METRICS,
  SENSITIVE_HEALTH_METRICS,
} from "./health";
import { callTool, toolContext } from "./test-context";

const mocks = vi.hoisted(() => ({
  getHealthSummary: vi.fn(),
  listBodyMeasurements: vi.fn(),
}));
vi.mock("@/modules/health/summary", () => ({ getHealthSummary: mocks.getHealthSummary }));
vi.mock("./data", () => ({ listBodyMeasurements: mocks.listBodyMeasurements }));

const point = (day: string, avg: number) => ({ day, avg, min: avg, max: avg, sum: null, count: 1 });

function summary() {
  return {
    rhythm: {
      ecg: [{ start: "2026-11-10T00:00:00.000Z", classification: "SINUS_RHYTHM", bpm: 70 }],
      irn: [{ start: "2026-11-10T00:00:00.000Z", end: null, positiveWindows: 0, windows: 3 }],
    },
    hasConnection: true,
    status: "active",
    backfillCompletedAt: null,
    lastSyncedAt: "2026-11-13T00:00:00.000Z",
    hasAnyHistory: true,
    metrics: [
      {
        key: "steps",
        label: "걸음 수",
        unit: "걸음",
        agg: "sum",
        scale: null,
        decimals: 0,
        points: [point("2026-11-12", 9000)],
      },
      // A service regression that leaked rhythm metrics must still be filtered.
      {
        key: "ecg",
        label: "ECG",
        unit: "bpm",
        agg: "avg",
        scale: null,
        decimals: 0,
        points: [point("2026-11-12", 70)],
      },
      {
        key: "irn",
        label: "IRN",
        unit: "",
        agg: "sum",
        scale: null,
        decimals: 0,
        points: [point("2026-11-12", 1)],
      },
    ],
    workouts: [{ start: "2026-11-12T01:00:00.000Z", minutes: 30, name: "걷기", type: "WALKING" }],
    sleepSessions: [
      {
        start: "2026-11-11T14:00:00.000Z",
        minutes: 420,
        stages: null,
        segments: [{ x: 1 }],
        nap: false,
      },
    ],
  };
}

beforeEach(() => {
  mocks.getHealthSummary.mockResolvedValue(summary());
  mocks.listBodyMeasurements.mockResolvedValue([]);
});

describe("health metric allowlist", () => {
  it("never contains the sensitive rhythm metrics", () => {
    for (const key of SENSITIVE_HEALTH_METRICS) {
      expect(MCP_HEALTH_METRICS as readonly string[]).not.toContain(key);
    }
  });

  it("covers every curated /health card plus exercise, and nothing else", () => {
    expect([...MCP_HEALTH_METRICS].sort()).toEqual(
      [...CURATED_METRICS.map((m) => m.key), "exercise"].sort()
    );
  });

  it("filters trip-style metric rows", () => {
    expect(
      filterHealthMetricRows([{ metric: "steps" }, { metric: "ecg" }, { metric: "irn" }])
    ).toEqual([{ metric: "steps" }]);
  });
});

describe("health tool", () => {
  it("returns allowlisted metrics only — no ecg/irn even with sensitive-read", async () => {
    const out = await callTool(
      healthTool,
      { from: "2026-11-01", to: "2026-11-13" },
      toolContext(["read", "sensitive-read"])
    );
    const text = JSON.stringify(out.structured);
    expect((out.structured.metrics as { key: string }[]).map((m) => m.key)).toEqual(["steps"]);
    expect(text).not.toMatch(/ecg|irn|SINUS_RHYTHM|rhythm/i);
    expect(mocks.getHealthSummary.mock.calls[0][1]).toEqual({
      period: { from: "2026-11-01", to: "2026-11-13" },
    });
  });

  it("renders KST times and omits sleep segments unless asked", async () => {
    const out = await callTool(healthTool, {});
    const sleep = (out.structured.sleepSessions as Record<string, unknown>[])[0];
    expect(sleep.start).toBe("2026-11-11T23:00:00+09:00");
    expect(sleep).not.toHaveProperty("segments");
    const withSegments = await callTool(healthTool, { includeSleepSegments: true });
    expect(
      (withSegments.structured.sleepSessions as Record<string, unknown>[])[0].segments
    ).toEqual([{ x: 1 }]);
  });

  it("reports a capped workout/sleep list with its total and a Korean hint", async () => {
    mocks.getHealthSummary.mockResolvedValue({
      ...summary(),
      periodListTotals: {
        workouts: { total: 140, truncated: true },
        sleepSessions: { total: 1, truncated: false },
      },
    });
    const out = await callTool(healthTool, {});
    expect(out.structured.lists).toEqual({
      workouts: { total: 140, truncated: true },
      sleepSessions: { total: 1, truncated: false },
    });
    expect(out.structured.message).toMatch(/운동 기록은 기간 안 140건 중 최근 1건.*기간을 좁혀/);
  });

  it("reports complete lists without a message", async () => {
    const out = await callTool(healthTool, {});
    expect(out.structured.lists).toMatchObject({ workouts: { truncated: false } });
    expect(out.structured.message).toBeNull();
  });

  it("bounds the range by how many metrics are requested", async () => {
    await expect(callTool(healthTool, { from: "2026-07-01", to: "2026-11-13" })).rejects.toThrow(
      /최대 84일.*metrics로 지표를 줄이면/
    );
    await callTool(healthTool, { from: "2025-11-14", to: "2026-11-13", metrics: ["steps"] });
    await callTool(healthTool, {
      from: "2025-11-14",
      to: "2026-11-13",
      metrics: ["steps", "heart_rate", "hrv"],
    });
    await expect(
      callTool(healthTool, { from: "2026-10-01", to: "2026-11-13", includeSleepSegments: true })
    ).rejects.toThrow(/31일/);
  });

  it("rejects the rhythm metrics as a requested filter", () => {
    expect(healthTool.inputSchema.safeParse({ metrics: ["ecg"] }).success).toBe(false);
  });
});

describe("health_rhythm tool", () => {
  it("requires sensitive-read, so a read token never gets it", () => {
    expect(healthRhythmTool.scope).toBe("sensitive-read");
    expect(toolsForScopes(HEALTH_TOOLS, ["read"]).map((t) => t.name)).toEqual(["health"]);
  });

  it("returns the device classifications with KST times", async () => {
    const out = await callTool(healthRhythmTool, {}, toolContext(["sensitive-read"]));
    expect(out.structured.ecg).toEqual([
      { start: "2026-11-10T09:00:00+09:00", classification: "SINUS_RHYTHM", bpm: 70 },
    ]);
    expect(out.structured.granted).toEqual({ ecg: true, irn: true });
  });
});
