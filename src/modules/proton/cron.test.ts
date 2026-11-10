import type { ScheduledTask } from "node-cron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  syncAll: vi.fn(),
  initRuntime: vi.fn(),
  load: vi.fn(),
  loadHeic: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logger: m.logger }));
vi.mock("./sync", () => ({ syncAllProtonPhotos: m.syncAll }));
vi.mock("@/lib/adapters/proton/runtime", () => ({ initProtonRuntime: m.initRuntime }));
vi.mock("./nsfw/nsfwjs", () => ({
  createNsfwjsClassifier: () => ({ load: m.load }),
}));
vi.mock("./original-thumbnail", () => ({ loadHeicDecoder: m.loadHeic }));

import { registerProtonPhotosTask, warmUpProtonRuntime } from "./cron";

beforeEach(() => {
  m.initRuntime.mockResolvedValue({});
  m.load.mockResolvedValue("wasm");
  m.loadHeic.mockResolvedValue(() => {});
});

describe("registerProtonPhotosTask", () => {
  it("schedules */10 in Asia/Seoul named proton-photos and never overlaps ticks", async () => {
    let tick: () => void = () => {};
    const schedule = vi.fn((_expr: string, cb: () => void) => {
      tick = cb;
      return {} as ScheduledTask;
    });
    let release: () => void = () => {};
    m.syncAll.mockImplementation(() => new Promise<void>((r) => (release = r)));

    registerProtonPhotosTask(schedule, "Asia/Seoul");

    expect(schedule).toHaveBeenCalledWith("*/10 * * * *", expect.any(Function), {
      timezone: "Asia/Seoul",
      name: "proton-photos",
    });
    tick();
    await vi.waitFor(() => expect(m.syncAll).toHaveBeenCalledTimes(1));
    tick(); // still running → skipped
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(m.syncAll).toHaveBeenCalledTimes(1);
    tick();
    await vi.waitFor(() => expect(m.syncAll).toHaveBeenCalledTimes(2));
  });

  it("a failed tick is logged by error name and frees the guard", async () => {
    let tick: () => void = () => {};
    const schedule = vi.fn((_expr: string, cb: () => void) => {
      tick = cb;
      return {} as ScheduledTask;
    });
    m.syncAll.mockRejectedValueOnce(new TypeError("private payload"));
    registerProtonPhotosTask(schedule, "Asia/Seoul");

    tick();
    await vi.waitFor(() =>
      expect(m.logger.error).toHaveBeenCalledWith("[Proton] sync tick failed", {
        error: "TypeError",
      })
    );
    m.syncAll.mockResolvedValueOnce(undefined);
    tick();
    await vi.waitFor(() => expect(m.syncAll).toHaveBeenCalledTimes(2));
  });

  it("warm-up failure is logged and does not prevent registration", async () => {
    m.load.mockRejectedValue(new Error("wasm missing"));
    const task = {} as ScheduledTask;
    const schedule = vi.fn(() => task);

    expect(registerProtonPhotosTask(schedule, "Asia/Seoul")).toBe(task);
    expect(schedule).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(m.logger.error).toHaveBeenCalledWith("[Proton] runtime warm-up failed", {
        error: "Error",
      })
    );
  });
});

describe("warmUpProtonRuntime", () => {
  it("initializes the crypto runtime, loads the classifier and logs its backend", async () => {
    await warmUpProtonRuntime();
    expect(m.initRuntime).toHaveBeenCalledTimes(1);
    expect(m.load).toHaveBeenCalledTimes(1);
    expect(m.logger.info).toHaveBeenCalledWith("[Proton] runtime ready", { backend: "wasm" });
    expect(m.loadHeic).toHaveBeenCalledTimes(1);
  });

  it("logs a HEIF decoder failure on its own, after the runtime is ready", async () => {
    m.loadHeic.mockRejectedValue(new TypeError("wasm"));
    await expect(warmUpProtonRuntime()).resolves.toBeUndefined();
    expect(m.logger.info).toHaveBeenCalledWith("[Proton] runtime ready", { backend: "wasm" });
    expect(m.logger.error).toHaveBeenCalledWith("[Proton] HEIF decoder warm-up failed", {
      error: "TypeError",
    });
  });

  it("never throws: a runtime failure is logged", async () => {
    m.initRuntime.mockRejectedValue(new RangeError("boom"));
    await expect(warmUpProtonRuntime()).resolves.toBeUndefined();
    expect(m.logger.error).toHaveBeenCalledWith("[Proton] runtime warm-up failed", {
      error: "RangeError",
    });
    expect(m.load).not.toHaveBeenCalled();
  });
});
