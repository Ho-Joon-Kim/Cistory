import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { WithingsConnection } from "@/db/schema";
import { WithingsSyncService } from "./service";

function setup() {
  const values = vi.fn(() => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }));
  const tx = { insert: () => ({ values }), update: vi.fn() };
  const db = {
    transaction: async (run: (tx: unknown) => Promise<void>) => run(tx),
    update: vi.fn(),
  };
  const service = new WithingsSyncService(db as unknown as Database);
  vi.spyOn(service, "getConnection").mockResolvedValue({
    userId: "u",
    status: "active",
  } as WithingsConnection);
  const fetch = vi.spyOn(
    service as unknown as { fetchGroups: (...args: unknown[]) => Promise<unknown> },
    "fetchGroups"
  );
  return { service, fetch, values, tx, db };
}

describe("Withings day recovery", () => {
  it("upserts only the half-open KST day and preserves the forward watermark", async () => {
    const { service, fetch, values, tx, db } = setup();
    const start = new Date("2026-07-31T15:00:00Z");
    const end = new Date("2026-08-01T15:00:00Z");
    fetch.mockResolvedValue({
      updatetime: 999,
      groups: [start.getTime() - 1, start.getTime(), end.getTime() - 1, end.getTime()].map(
        (ms, i) => ({
          groupId: i,
          measuredAt: new Date(ms),
          category: 1,
          metrics: { weightKg: 70 },
          raw: [],
        })
      ),
    });
    expect(await service.recoverDay("u", "2026-08-01")).toBe(2);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ userId: "u" }), false, {
      startdate: start.getTime() / 1000,
      enddate: end.getTime() / 1000,
    });
    expect(values).toHaveBeenCalledTimes(2);
    expect(tx.update).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
  it("rejects missing connections, bad dates, and provider failures", async () => {
    const { service, fetch, values } = setup();
    await expect(service.recoverDay("u", "2026-02-30")).rejects.toThrow("날짜");
    fetch.mockRejectedValueOnce(new Error("upstream failed"));
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("upstream failed");
    vi.mocked(service.getConnection).mockResolvedValue(null);
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("연동");
    expect(values).not.toHaveBeenCalled();
  });
});
