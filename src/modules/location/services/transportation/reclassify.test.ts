import { describe, expect, it, vi } from "vitest";
import { reclassifyTransportationRange, TransportationReclassificationError } from "./reclassify";

describe("reclassifyTransportationRange", () => {
  it("re-runs the existing track pipeline for every requested day and authenticated user", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ trackCount: 2, segmentCount: 3 })
      .mockResolvedValueOnce({ trackCount: 1, segmentCount: 4 });

    await expect(
      reclassifyTransportationRange("user-1", "2026-07-21", "2026-07-22", detect)
    ).resolves.toEqual({
      from: "2026-07-21",
      to: "2026-07-22",
      daysProcessed: 2,
      trackCount: 3,
      segmentCount: 7,
    });
    expect(detect).toHaveBeenNthCalledWith(1, "user-1", "2026-07-21");
    expect(detect).toHaveBeenNthCalledWith(2, "user-1", "2026-07-22");
  });

  it.each([
    ["", "2026-07-01", "2026-07-02"],
    ["user-1", "2026-02-30", "2026-03-01"],
    ["user-1", "2026-07-03", "2026-07-02"],
    ["user-1", "2025-01-01", "2026-01-02"],
  ])("rejects invalid user/date ranges before mutation", async (userId, from, to) => {
    const detect = vi.fn();

    await expect(reclassifyTransportationRange(userId, from, to, detect)).rejects.toThrow();
    expect(detect).not.toHaveBeenCalled();
  });

  it("surfaces the failed date and completed counts instead of hiding pipeline failures", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ trackCount: 2, segmentCount: 3 })
      .mockRejectedValueOnce(new Error("database unavailable"));

    const error = await reclassifyTransportationRange(
      "user-1",
      "2026-07-20",
      "2026-07-22",
      detect
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransportationReclassificationError);
    expect(error).toMatchObject({
      failedDate: "2026-07-21",
      daysProcessed: 1,
      trackCount: 2,
      segmentCount: 3,
    });
    expect((error as Error).message).toContain("database unavailable");
    expect(detect).toHaveBeenCalledTimes(2);
  });
});
