import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

const ECG_SCOPE = "https://www.googleapis.com/auth/googlehealth.ecg.readonly";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T03:00:00Z"));
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});
afterEach(() => vi.useRealTimers());

const call = () => GET(new NextRequest("http://localhost/api/fitbit/summary"), undefined);

describe("GET /api/fitbit/summary", () => {
  it("returns empty state without a connection", async () => {
    // connection, daily summaries, fallback samples, exercise, sleep
    const fake = createMockDb([[], [], [], [], []]);
    mocks.getDb.mockReturnValue(fake.db);
    const body = await (await call()).json();
    expect(body).toMatchObject({
      rhythm: null,
      hasConnection: false,
      status: null,
      backfillCompletedAt: null,
      lastSyncedAt: null,
      hasAnyHistory: false,
      workouts: [],
      sleepSessions: [],
    });
    expect(body.metrics.every((m: { points: unknown[] }) => m.points.length === 0)).toBe(true);
    expect(fake.remaining()).toBe(0);
    for (const params of fake.whereParams()) expect(params).toContain("user-1");
    // default trend window: 30 KST days back
    expect(fake.whereParams()[1]).toContain("2026-10-14");
  });

  it("pins the populated response shape", async () => {
    const fake = createMockDb([
      [
        {
          userId: "user-1",
          status: "active",
          scope: ECG_SCOPE,
          backfillCompletedAt: new Date("2026-11-01T00:00:00Z"),
          lastSyncedAt: new Date("2026-11-12T00:00:00Z"),
        },
      ],
      [
        {
          metric: "steps",
          day: "2026-11-12",
          valueAvg: null,
          valueMin: null,
          valueMax: null,
          valueSum: 8000,
          count: 10,
        },
      ],
      [
        {
          metric: "resting_heart_rate",
          sampleAt: new Date("2026-11-12T00:00:00Z"),
          value: 60,
          valueJson: null,
        },
        {
          metric: "resting_heart_rate",
          sampleAt: new Date("2026-11-12T01:00:00Z"),
          value: 62,
          valueJson: null,
        },
      ],
      [
        {
          sampleAt: new Date("2026-11-11T10:00:00Z"),
          source: "FITBIT",
          value: 30.4,
          valueJson: { displayName: "달리기", exerciseType: "RUNNING" },
        },
      ],
      [
        {
          sampleAt: new Date("2026-11-11T15:00:00Z"),
          source: "FITBIT",
          minutes: 420,
          valueJson: null,
        },
      ],
      [
        {
          metric: "ecg",
          sampleAt: new Date("2026-11-10T00:00:00Z"),
          source: "FITBIT",
          value: 70,
          valueJson: { resultClassification: "NORMAL_SINUS_RHYTHM" },
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    const body = await (await call()).json();

    expect(fake.remaining()).toBe(0);
    expect(body.hasConnection).toBe(true);
    expect(body.status).toBe("active");
    expect(body.backfillCompletedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(body.lastSyncedAt).toBe("2026-11-12T00:00:00.000Z");
    expect(body.hasAnyHistory).toBe(true);
    expect(body.metrics.find((m: { key: string }) => m.key === "steps").points).toEqual([
      { day: "2026-11-12", avg: null, min: null, max: null, sum: 8000, count: 10 },
    ]);
    expect(
      body.metrics.find((m: { key: string }) => m.key === "resting_heart_rate").points
    ).toEqual([{ day: "2026-11-12", avg: 61, min: 60, max: 62, sum: null, count: 2 }]);
    expect(body.metrics.at(-1)).toEqual({
      key: "exercise",
      label: "운동 시간",
      unit: "분",
      agg: "sum",
      scale: null,
      decimals: 0,
      points: [{ day: "2026-11-11", avg: null, min: null, max: null, sum: 30.4, count: null }],
    });
    expect(body.workouts).toEqual([
      { start: "2026-11-11T10:00:00.000Z", minutes: 30, name: "달리기", type: "RUNNING" },
    ]);
    expect(body.sleepSessions).toHaveLength(1);
    expect(body.sleepSessions[0]).toMatchObject({
      start: "2026-11-11T15:00:00.000Z",
      minutes: 420,
    });
    expect(body.rhythm).toEqual({
      ecg: [{ start: "2026-11-10T00:00:00.000Z", classification: "NORMAL_SINUS_RHYTHM", bpm: 70 }],
      irn: null,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "backfillCompletedAt",
        "hasAnyHistory",
        "hasConnection",
        "lastSyncedAt",
        "metrics",
        "rhythm",
        "sleepSessions",
        "status",
        "workouts",
      ].sort()
    );
  });
});
