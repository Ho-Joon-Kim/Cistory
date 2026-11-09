import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { createWakaTimeSyncServiceForUser, WakaTimeSyncService } from "./service";

const getDurations = vi.fn();
const source = { getDurations, getSummaries: vi.fn() };

describe("WakaTime day recovery", () => {
  it("fetches durations and summary only for requested day without changing watermark", async () => {
    const db = { update: vi.fn() };
    const service = new WakaTimeSyncService(db as unknown as Database, source);
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
      source
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

  it("rejects invalid dates", async () => {
    const service = new WakaTimeSyncService({} as unknown as Database, source);
    await expect(service.recoverDay("u", "2026-02-30")).rejects.toThrow("날짜");
  });
});

describe("createWakaTimeSyncServiceForUser", () => {
  const dbWith = (rows: unknown[]) =>
    ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    }) as unknown as Database;

  it("returns null without an OAuth connection, even if a legacy API key exists", async () => {
    expect(await createWakaTimeSyncServiceForUser(dbWith([]), "u")).toBeNull();
  });

  it("returns null when the connection needs re-authentication", async () => {
    expect(
      await createWakaTimeSyncServiceForUser(dbWith([{ status: "needs_reauth" }]), "u")
    ).toBeNull();
  });

  it("builds a service over an active connection", async () => {
    expect(
      await createWakaTimeSyncServiceForUser(dbWith([{ status: "active" }]), "u")
    ).toBeInstanceOf(WakaTimeSyncService);
  });
});
