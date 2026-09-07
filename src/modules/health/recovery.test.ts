import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { HealthConnection } from "@/db/schema";
import { buildTimeFilter, HEALTH_METRICS, HealthSyncService } from "./service";

// Recovery is deliberately separate from normal forward/backfill watermarks.
function setup() {
  const db = { update: vi.fn(), insert: vi.fn() };
  const service = new HealthSyncService(db as unknown as Database);
  vi.spyOn(service, "getConnection").mockResolvedValue({
    userId: "u",
    status: "active",
  } as HealthConnection);
  const internals = service as unknown as {
    fetchRecoveryWindow: (...args: unknown[]) => Promise<unknown[]>;
    replaceRecoveryWindow: (...args: unknown[]) => Promise<number>;
  };
  const fetch = vi.spyOn(internals, "fetchRecoveryWindow").mockResolvedValue([]);
  const rollup = vi.spyOn(internals, "replaceRecoveryWindow").mockResolvedValue(1);
  return { service, db, fetch, rollup };
}

describe("health day recovery", () => {
  it("fetches only scalar metrics within one KST day without advancing cursors", async () => {
    const { service, db, fetch, rollup } = setup();
    expect(await service.recoverDay("u", "2026-08-01")).toBe(HEALTH_METRICS.length);
    expect(fetch).toHaveBeenCalledTimes(HEALTH_METRICS.length);
    const start = new Date("2026-07-31T15:00:00Z");
    const end = new Date("2026-08-01T15:00:00Z");
    for (const [index, config] of HEALTH_METRICS.entries()) {
      expect(fetch.mock.calls[index].slice(1)).toEqual([config, start, end]);
    }
    expect(rollup).toHaveBeenCalledTimes(HEALTH_METRICS.length);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("does not claim success after pagination or summary failure", async () => {
    const { service, fetch, rollup } = setup();
    fetch.mockRejectedValueOnce(new Error("건강 데이터 조회가 완료되지 않았습니다"));
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("완료되지");
    rollup.mockRejectedValueOnce(new Error("rollup failed"));
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("rollup failed");
  });
  it("rejects disconnected sources and invalid dates before fetching", async () => {
    const { service, fetch } = setup();
    await expect(service.recoverDay("u", "2026-02-30")).rejects.toThrow("날짜");
    vi.mocked(service.getConnection).mockResolvedValue(null);
    await expect(service.recoverDay("u", "2026-08-01")).rejects.toThrow("연동");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps midnight upper bounds exclusive for daily metrics", () => {
    const config = HEALTH_METRICS.find((c) => c.key === "daily_hrv")!;
    expect(
      buildTimeFilter(config, new Date("2026-07-31T15:00:00Z"), new Date("2026-08-01T15:00:00Z"))
    ).toBe(
      'daily_heart_rate_variability.date >= "2026-08-01" AND daily_heart_rate_variability.date < "2026-08-02"'
    );
  });
});
