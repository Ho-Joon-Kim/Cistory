import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ persist: vi.fn(), update: vi.fn() }));
vi.mock("@/db", () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ onConflictDoNothing: mocks.persist }) }),
    update: () => ({ set: () => ({ where: mocks.update }) }),
  }),
}));
vi.mock("@/lib/api-auth", () => ({
  checkBodySize: () => ({ ok: true }),
  bodyExceedsLimit: () => false,
  enforceRateLimit: () => ({ allowed: true }),
  verifyApiKey: vi.fn(),
  logIngestionFailure: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/data-status/telemetry", () => ({ recordSourceSuccess: vi.fn() }));

import { verifyApiKey } from "@/lib/api-auth";
import { recordSourceSuccess } from "@/modules/data-status/telemetry";
import { POST } from "./route";

const request = (
  body = JSON.stringify({ _type: "location", lat: 37, lon: 127, tst: 1788750000 })
) => new NextRequest("http://localhost/api/owntracks?apikey=fixture", { method: "POST", body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.persist.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  vi.mocked(verifyApiKey).mockResolvedValue({ id: "u1", tossMyName: null });
});
describe("OwnTracks receipt telemetry", () => {
  it("records location success after persistence while retaining the empty-array protocol", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(recordSourceSuccess).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "location",
      expect.any(Date)
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(recordSourceSuccess).mock.invocationCallOrder[0]
    );
  });
  it("does not record auth failures, invalid JSON, or non-location messages", async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce(null);
    expect(await (await POST(request())).json()).toEqual([]);
    expect(await (await POST(request("{"))).json()).toEqual([]);
    expect(await (await POST(request('{"_type":"status"}'))).json()).toEqual([]);
    expect(recordSourceSuccess).not.toHaveBeenCalled();
  });
  it("does not label a persistence failure as success", async () => {
    mocks.persist.mockRejectedValueOnce(new Error("fixture failure"));
    expect(await (await POST(request())).json()).toEqual([]);
    expect(recordSourceSuccess).not.toHaveBeenCalled();
  });
});
