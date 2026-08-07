process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { runRouteMatchPostProcessing } from "./cron-processing";

const mocks = vi.hoisted(() => ({
  matchRoutesForDay: vi.fn(),
}));

vi.mock("@/modules/location/services/route-match/matcher", () => ({
  matchRoutesForDay: mocks.matchRoutesForDay,
}));

describe("runRouteMatchPostProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.matchRoutesForDay.mockResolvedValue({});
  });

  it("swallows matcher failures and still resolves", async () => {
    mocks.matchRoutesForDay.mockRejectedValue(new Error("Valhalla unavailable"));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await expect(runRouteMatchPostProcessing("user-1", ["2026-08-06"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[Cron] Route matching failed (non-fatal)", {
      userId: "user-1",
      error: "Valhalla unavailable",
    });

    warn.mockRestore();
  });

  it("matches routes once for every completed date", async () => {
    await runRouteMatchPostProcessing("user-1", ["2026-08-05", "2026-08-06"]);

    expect(mocks.matchRoutesForDay).toHaveBeenCalledTimes(2);
    expect(mocks.matchRoutesForDay).toHaveBeenNthCalledWith(1, "user-1", "2026-08-05");
    expect(mocks.matchRoutesForDay).toHaveBeenNthCalledWith(2, "user-1", "2026-08-06");
  });

  it("single-flights overlapping post-processing runs", async () => {
    let release: (() => void) | undefined;
    mocks.matchRoutesForDay.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );

    const first = runRouteMatchPostProcessing("user-1", ["2026-08-06"]);
    await vi.waitFor(() => expect(mocks.matchRoutesForDay).toHaveBeenCalledOnce());
    await runRouteMatchPostProcessing("user-1", ["2026-08-07"]);

    expect(mocks.matchRoutesForDay).toHaveBeenCalledOnce();
    release?.();
    await first;
  });
});
