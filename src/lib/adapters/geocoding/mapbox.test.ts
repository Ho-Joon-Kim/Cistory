// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.MAPBOX_ACCESS_TOKEN = "test-token";

import { MapboxGeocodingAdapter } from "./mapbox";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapboxGeocodingAdapter region/country", () => {
  it("lifts region and country out of context instead of only joining them into the address", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        features: [
          {
            properties: {
              name: "Central",
              full_address: "Central, Hong Kong Island, Hong Kong",
              feature_type: "poi",
              context: {
                place: { name: "Hong Kong Island" },
                region: { name: "Hong Kong Island" },
                country: { name: "Hong Kong" },
              },
            },
          },
        ],
      })
    );

    const result = await new MapboxGeocodingAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.region).toBe("Hong Kong Island");
    expect(result?.country).toBe("Hong Kong");
  });

  it("returns null region/country when context is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ features: [{ properties: { name: "Somewhere", full_address: "Somewhere" } }] })
    );

    const result = await new MapboxGeocodingAdapter().reverseGeocode(0, 0);

    expect(result?.region).toBeNull();
    expect(result?.country).toBeNull();
  });
});
