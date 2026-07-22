import { describe, expect, it, vi } from "vitest";
import {
  OVERVIEW_PRECOMPUTE_INTERVAL_MINUTES,
  OVERVIEW_PRECOMPUTE_SCHEDULE,
  registerOverviewPrecomputeTask,
} from "./cron";

const m = vi.hoisted(() => ({
  runOverviewPrecompute: vi.fn(),
  processAutoBatch: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: vi.fn(() => ({ id: "db", execute: m.execute })) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("./precompute", () => ({ runOverviewPrecompute: m.runOverviewPrecompute }));
vi.mock("./narrative", () => ({
  createDatabaseNarrativeStore: vi.fn(),
  createNarrativeService: vi.fn(() => ({ processAutoBatch: m.processAutoBatch })),
}));
vi.mock("@/lib/adapters/ai/claude", () => ({ createClaudeAdapter: vi.fn() }));

describe("overview cron", () => {
  it("keeps the worker cadence below the UI's ten-minute polling window", () => {
    expect(OVERVIEW_PRECOMPUTE_INTERVAL_MINUTES).toBe(5);
    expect(OVERVIEW_PRECOMPUTE_INTERVAL_MINUTES).toBeLessThan(10);
    expect(OVERVIEW_PRECOMPUTE_SCHEDULE).toBe("*/5 * * * *");
  });

  it("registers a dedicated tick in KST and preserves the ended-period gate", async () => {
    const task = { stop: vi.fn() };
    const schedule = vi.fn(() => task);
    m.runOverviewPrecompute.mockResolvedValue({
      skipped: false,
      published: 0,
      failed: 0,
    });
    m.processAutoBatch.mockResolvedValue({ claimed: 0, generated: 0, failed: 0 });
    m.execute.mockResolvedValue({
      rows: [{ userId: "user-1", completedThrough: "2026-07-21" }],
    });

    expect(registerOverviewPrecomputeTask(schedule as never, "Asia/Seoul")).toBe(task);
    expect(schedule).toHaveBeenCalledWith("*/5 * * * *", expect.any(Function), {
      timezone: "Asia/Seoul",
      name: "overview-precompute",
    });

    const callback = schedule.mock.calls[0]?.[1] as (() => void) | undefined;
    callback?.();
    await vi.waitFor(() => {
      expect(m.runOverviewPrecompute).toHaveBeenCalledWith(expect.anything(), {
        completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-07-21" }],
      });
    });
  });
});
