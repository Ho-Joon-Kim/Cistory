import type { ScheduledTask } from "node-cron";
import { describe, expect, it, vi } from "vitest";

const processQueue = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./webhook-queue", () => ({ processHealthWebhookQueue: processQueue }));

import { healthWebhooksEnabled, registerHealthWebhookTask } from "./webhook-cron";

describe("registerHealthWebhookTask", () => {
  it("is gated by GOOGLE_HEALTH_WEBHOOKS_ENABLED=true", () => {
    const schedule = vi.fn();
    expect(registerHealthWebhookTask(schedule, "Asia/Seoul", {})).toBeNull();
    expect(
      registerHealthWebhookTask(schedule, "Asia/Seoul", { GOOGLE_HEALTH_WEBHOOKS_ENABLED: "1" })
    ).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
    expect(healthWebhooksEnabled({ GOOGLE_HEALTH_WEBHOOKS_ENABLED: "true" })).toBe(true);
  });

  it("schedules every minute in Asia/Seoul and never overlaps ticks", async () => {
    let tick: () => void = () => {};
    const schedule = vi.fn((_expr: string, cb: () => void) => {
      tick = cb;
      return {} as ScheduledTask;
    });
    let release: () => void = () => {};
    processQueue.mockImplementation(() => new Promise<void>((r) => (release = r)));
    registerHealthWebhookTask(schedule, "Asia/Seoul", { GOOGLE_HEALTH_WEBHOOKS_ENABLED: "true" });
    expect(schedule).toHaveBeenCalledWith("* * * * *", expect.any(Function), {
      timezone: "Asia/Seoul",
      name: "health-webhook",
    });
    tick();
    await vi.waitFor(() => expect(processQueue).toHaveBeenCalledTimes(1));
    tick(); // still running → skipped
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(processQueue).toHaveBeenCalledTimes(1);
    tick();
    await vi.waitFor(() => expect(processQueue).toHaveBeenCalledTimes(2));
  });
});
