import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { WakaTimeSyncService } from "./service";

const { getDurations } = vi.hoisted(() => ({ getDurations: vi.fn() }));
vi.mock("@/lib/adapters/wakatime/wakatime", () => ({
  createWakaTimeAdapter: () => ({ getDurations }),
}));

describe("WakaTime day recovery", () => {
  it("fetches durations and summary only for requested day without changing watermark", async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ apiKey: "linked" }] }) }),
      }),
      update: vi.fn(),
    };
    const service = new WakaTimeSyncService(db as unknown as Database, "key");
    const durations = vi.spyOn(service, "syncDurations").mockResolvedValue(2);
    const summaries = vi.spyOn(service, "syncSummaries").mockResolvedValue(1);
    expect(await service.recoverDay("u", "2026-08-01")).toBe(2);
    expect(durations).toHaveBeenCalledWith("u", "2026-08-01");
    expect(summaries).toHaveBeenCalledWith("u", "2026-08-01", "2026-08-01");
    expect(db.update).not.toHaveBeenCalled();
  });
  it("updates growing sessions on their stable identity", async () => {
    getDurations.mockResolvedValue([
      {
        project: "app",
        time: 100,
        duration: 240,
        humanAdditions: 2,
        humanDeletions: 1,
        aiAdditions: 0,
        aiDeletions: 0,
      },
    ]);
    const update = vi.fn(() => ({ returning: async () => [{ id: "session" }] }));
    const values = vi.fn(() => ({ onConflictDoUpdate: update }));
    const service = new WakaTimeSyncService(
      { insert: () => ({ values }) } as unknown as Database,
      "key"
    );
    expect(await service.syncDurations("u", "2026-08-01")).toBe(1);
    expect(values).toHaveBeenCalledWith([expect.objectContaining({ durationSeconds: 240 })]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          durationSeconds: expect.anything(),
          humanAdditions: expect.anything(),
          aiDeletions: expect.anything(),
        }),
      })
    );
  });

  it("rejects invalid dates and disconnected users", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    const service = new WakaTimeSyncService(db as unknown as Database, "key");
    await expect(service.recoverDay("u", "2026-02-30")).rejects.toThrow("날짜");
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("연동");
  });
});
