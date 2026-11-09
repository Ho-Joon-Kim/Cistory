import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("undici", () => ({
  Agent: class {},
  fetch: fetchMock,
}));

import { OVERPASS_ENDPOINTS, OVERPASS_USER_AGENT, OverpassSubwayAdapter } from "./index";

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("Overpass endpoints", () => {
  it("no longer lists the dead kumi.systems host", () => {
    expect(OVERPASS_ENDPOINTS.some((e) => e.includes("kumi.systems"))).toBe(false);
    expect(OVERPASS_ENDPOINTS[0]).toBe("https://overpass-api.de/api/interpreter");
  });

  it("sends an identifying User-Agent and falls through to the next endpoint on failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockRejectedValueOnce(new Error("connect timeout"))
      .mockResolvedValueOnce(jsonResponse({ elements: [] }));

    const result = await new OverpassSubwayAdapter().fetchSubwayInBbox([126.8, 37.4, 127.2, 37.7]);

    expect(result).toEqual({ lines: [], stations: [] });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([...OVERPASS_ENDPOINTS]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["User-Agent"]).toBe(OVERPASS_USER_AGENT);
    }
  });

  it("throws once every endpoint has failed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 504));

    await expect(
      new OverpassSubwayAdapter().fetchSubwayInBbox([126.8, 37.4, 127.2, 37.7])
    ).rejects.toThrow(/All Overpass endpoints failed/);
    expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length);
  });
});
