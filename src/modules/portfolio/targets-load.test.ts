import { describe, expect, it, vi } from "vitest";
import { type AccountTargets, canEditTargets, fetchAccountTargets, fetchTargets } from "./hooks";

const stored = [{ ticker: "005930", name: "삼성전자", targetWeight: 1 }];

describe("loading target allocations", () => {
  it("throws on a non-OK response instead of reading it as no targets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(fetchAccountTargets("acc-1")).rejects.toThrow();
  });

  it("flags only the failed account and never turns it into empty, editable targets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("acc-1")
        ? Response.json({ targets: stored, updatedAt: "2026-11-01T00:00:00.000Z" })
        : new Response("oops", { status: 503 })
    );
    const result = await fetchTargets(["acc-1", "acc-2"]);
    expect(result["acc-1"]).toEqual({
      targets: stored,
      updatedAt: "2026-11-01T00:00:00.000Z",
      loadFailed: false,
    });
    expect(result["acc-2"]).toEqual({ targets: [], updatedAt: null, loadFailed: true });
    expect(canEditTargets(result["acc-1"])).toBe(true);
    expect(canEditTargets(result["acc-2"])).toBe(false);
  });

  it("keeps the last loaded targets (flagged) when a refresh fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const previous: Record<string, AccountTargets> = {
      "acc-1": { targets: stored, updatedAt: null, loadFailed: false },
    };
    const result = await fetchTargets(["acc-1"], previous);
    expect(result["acc-1"]).toEqual({ targets: stored, updatedAt: null, loadFailed: true });
    expect(canEditTargets(result["acc-1"])).toBe(false);
  });
});
