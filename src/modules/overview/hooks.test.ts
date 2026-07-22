process.env.TZ = "Asia/Seoul";

import { describe, expect, it, vi } from "vitest";
import {
  adjacentOverviewPeriod,
  loadNarrativeUntilSettled,
  loadOverviewUntilSettled,
  recomputeResponseJson,
  resolveOverviewPeriod,
} from "./hooks";

const NOW = new Date("2026-07-21T15:30:00.000Z"); // 2026-07-22 00:30 KST

describe("overview period state", () => {
  it("defaults to a 14-day recent window using the KST calendar day", () => {
    expect(resolveOverviewPeriod(null, null, NOW)).toEqual({
      periodType: "recent",
      periodKey: "2026-07-22",
    });
  });

  it.each([
    ["week", "2026-W30"],
    ["month", "2026-07"],
    ["year", "2026"],
  ])("preserves canonical %s URL state", (periodType, periodKey) => {
    expect(resolveOverviewPeriod(periodType, periodKey, NOW)).toEqual({ periodType, periodKey });
  });

  it("canonicalizes malformed or future URL state to the current period", () => {
    expect(resolveOverviewPeriod("month", "2026-7", NOW)).toEqual({
      periodType: "month",
      periodKey: "2026-07",
    });
    expect(resolveOverviewPeriod("year", "2027", NOW)).toEqual({
      periodType: "year",
      periodKey: "2026",
    });
  });

  it("moves through non-overlapping recent windows and disables future navigation", () => {
    expect(adjacentOverviewPeriod("recent", "2026-07-22", -1, NOW)).toMatchObject({
      periodKey: "2026-07-08",
      isFuture: false,
    });
    expect(adjacentOverviewPeriod("recent", "2026-07-22", 1, NOW)).toMatchObject({
      periodKey: "2026-08-05",
      isFuture: true,
    });
  });

  it.each([
    ["week", "2026-W30", "2026-W29"],
    ["month", "2026-07", "2026-06"],
    ["year", "2026", "2025"],
  ] as const)("moves %s periods with canonical keys", (periodType, periodKey, previousKey) => {
    expect(adjacentOverviewPeriod(periodType, periodKey, -1, NOW).periodKey).toBe(previousKey);
  });
});

describe("overview polling controller", () => {
  it("enqueues a missing period once and stops when ready", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: "missing", periodType: "month", periodKey: "2026-07" })
      .mockResolvedValueOnce({ status: "computing", periodType: "month", periodKey: "2026-07" })
      .mockResolvedValueOnce({
        status: "ready",
        periodType: "month",
        periodKey: "2026-07",
        computedAt: NOW.toISOString(),
        domains: {},
      });
    const enqueue = vi.fn().mockResolvedValue({
      status: "pending",
      periodType: "month",
      periodKey: "2026-07",
    });
    const updates = vi.fn();

    const result = await loadOverviewUntilSettled({
      get,
      enqueue,
      wait: vi.fn(async () => undefined),
      isVisible: () => true,
      enqueued: new Set(),
      periodType: "month",
      periodKey: "2026-07",
      maxPolls: 5,
      signal: new AbortController().signal,
      onUpdate: updates,
    });

    expect(result.status).toBe("ready");
    expect(enqueue).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(3);
    expect(updates.mock.calls.map(([state]) => state.status)).toEqual([
      "missing",
      "pending",
      "computing",
      "ready",
    ]);
  });

  it("does not poll while the tab is hidden", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "computing",
      periodType: "month",
      periodKey: "2026-07",
    });

    await loadOverviewUntilSettled({
      get,
      enqueue: vi.fn(),
      wait: vi.fn(async () => undefined),
      isVisible: () => false,
      enqueued: new Set(),
      periodType: "month",
      periodKey: "2026-07",
      maxPolls: 5,
      signal: new AbortController().signal,
      onUpdate: vi.fn(),
    });

    expect(get).toHaveBeenCalledOnce();
  });

  it("stops on failed and never enqueues", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "failed",
      periodType: "month",
      periodKey: "2026-07",
      computedAt: NOW.toISOString(),
      domains: {},
    });
    const enqueue = vi.fn();

    const result = await loadOverviewUntilSettled({
      get,
      enqueue,
      wait: vi.fn(async () => undefined),
      isVisible: () => true,
      enqueued: new Set(),
      periodType: "month",
      periodKey: "2026-07",
      maxPolls: 5,
      signal: new AbortController().signal,
      onUpdate: vi.fn(),
    });

    expect(result.status).toBe("failed");
    expect(get).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("bounds polling attempts", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "pending",
      periodType: "week",
      periodKey: "2026-W30",
    });

    await expect(
      loadOverviewUntilSettled({
        get,
        enqueue: vi.fn(),
        wait: vi.fn(async () => undefined),
        isVisible: () => true,
        enqueued: new Set(),
        periodType: "week",
        periodKey: "2026-W30",
        maxPolls: 3,
        signal: new AbortController().signal,
        onUpdate: vi.fn(),
      })
    ).rejects.toThrow("계산 대기 시간이 초과");

    expect(get).toHaveBeenCalledTimes(4);
  });

  it("does not remember a failed enqueue as successful", async () => {
    const enqueued = new Set<string>();
    await expect(
      loadOverviewUntilSettled({
        get: vi.fn(async () => ({
          status: "missing",
          periodType: "month",
          periodKey: "2026-07",
        })),
        enqueue: vi.fn(async () => {
          throw new Error("rate limited");
        }),
        wait: vi.fn(async () => undefined),
        isVisible: () => true,
        enqueued,
        periodType: "month",
        periodKey: "2026-07",
        maxPolls: 1,
        signal: new AbortController().signal,
        onUpdate: vi.fn(),
      })
    ).rejects.toThrow("rate limited");
    expect(enqueued.size).toBe(0);
  });

  it("treats an enqueue race with an active worker as computing", async () => {
    const response = new Response(
      JSON.stringify({ error: "이미 계산 중", code: "PERIOD_COMPUTING" }),
      { status: 409, headers: { "content-type": "application/json" } }
    );

    await expect(recomputeResponseJson(response, "month", "2026-07")).resolves.toEqual({
      status: "computing",
      periodType: "month",
      periodKey: "2026-07",
    });
  });

  it("stops an obsolete period request when aborted", async () => {
    const controller = new AbortController();
    const get = vi.fn(async () => ({
      status: "pending" as const,
      periodType: "month" as const,
      periodKey: "2026-07",
    }));

    await expect(
      loadOverviewUntilSettled({
        get,
        enqueue: vi.fn(),
        wait: vi.fn(async () => {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }),
        isVisible: () => true,
        enqueued: new Set(),
        periodType: "month",
        periodKey: "2026-07",
        maxPolls: 5,
        signal: controller.signal,
        onUpdate: vi.fn(),
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(get).toHaveBeenCalledOnce();
  });
});

describe("narrative polling controller", () => {
  it("polls pending narratives until they become ready", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "generating" })
      .mockResolvedValueOnce({ status: "ready", content: "완성된 회고" });
    const updates = vi.fn();

    const result = await loadNarrativeUntilSettled({
      get,
      wait: vi.fn(async () => undefined),
      isVisible: () => true,
      maxPolls: 5,
      signal: new AbortController().signal,
      onUpdate: updates,
    });

    expect(result).toEqual({ status: "ready", content: "완성된 회고" });
    expect(get).toHaveBeenCalledTimes(3);
    expect(updates.mock.calls.map(([state]) => state.status)).toEqual([
      "pending",
      "generating",
      "ready",
    ]);
  });
});
