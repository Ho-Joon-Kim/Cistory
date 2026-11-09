// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.MAPBOX_ACCESS_TOKEN = "test-token";

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import { MapboxGeocodingAdapter } from "./mapbox";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe("MapboxGeocodingAdapter request", () => {
  it("requests only types Geocoding v6 accepts (no poi)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ features: [] }));

    await new MapboxGeocodingAdapter().reverseGeocode(35.68, 139.76);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    const types = url.searchParams.get("types")?.split(",") ?? [];
    expect(types).not.toContain("poi");
    const v6Types = [
      "country",
      "region",
      "postcode",
      "district",
      "place",
      "locality",
      "neighborhood",
      "street",
      "address",
    ];
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(v6Types).toContain(t);
    expect(types[0]).toBe("address");
    expect(url.searchParams.get("longitude")).toBe("139.76");
    expect(url.searchParams.get("latitude")).toBe("35.68");
  });

  it("logs status and body on a non-OK response without leaking the token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'Type "poi" is not a known type.' }, 422)
    );

    const result = await new MapboxGeocodingAdapter().reverseGeocode(35.68, 139.76);

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[Mapbox] reverse geocode failed",
      expect.objectContaining({ status: 422, body: expect.stringContaining("not a known type") })
    );
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain("test-token");
  });
});

beforeEach(() => {
  fetchMock.mockReset();
  loggerMock.warn.mockReset();
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
              feature_type: "address",
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
