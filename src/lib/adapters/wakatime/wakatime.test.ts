import { afterEach, describe, expect, it, vi } from "vitest";
import { WakaTimeAdapter } from "./wakatime";

afterEach(() => vi.unstubAllGlobals());

describe("WakaTime calendar windows", () => {
  it("requests durations and summaries in KST regardless of account timezone", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    const adapter = new WakaTimeAdapter("key");
    await adapter.getDurations("2026-08-01");
    await adapter.getSummaries("2026-08-01", "2026-08-01");
    for (const [url] of fetch.mock.calls) {
      expect(new URL(url).searchParams.get("timezone")).toBe("Asia/Seoul");
    }
  });
});
