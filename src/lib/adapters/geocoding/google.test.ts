// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

import { GooglePlacesAdapter } from "./google";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

/**
 * reverseGeocode fires searchNearbyPoi (POST places:searchNearby) and
 * getAddress (GET maps/api/geocode/json) via Promise.all, so resolve by URL
 * rather than by call order — Promise.all does not guarantee which runs first.
 */
function mockGoogle(poiPayload: unknown, geocodePayload: unknown) {
  fetchMock.mockImplementation(async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    return url.includes("maps/api/geocode")
      ? jsonResponse(geocodePayload)
      : jsonResponse(poiPayload);
  });
}

const HONG_KONG_GEOCODE = {
  results: [
    {
      formatted_address: "1號1樓, 139號The L. Place F, Queen's Road Central, Hong Kong",
      address_components: [
        { long_name: "Queen's Road Central", short_name: "Queen's Rd C", types: ["route"] },
        { long_name: "Central", short_name: "Central", types: ["neighborhood", "political"] },
        {
          long_name: "Hong Kong Island",
          short_name: "Hong Kong Island",
          types: ["administrative_area_level_1", "political"],
        },
        { long_name: "Hong Kong", short_name: "HK", types: ["country", "political"] },
      ],
    },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GooglePlacesAdapter region/country", () => {
  it("reads country from address_components instead of the last comma-separated token", async () => {
    // The old string parser took the last ", "-separated token of
    // formatted_address, which is why "1號1樓" and "139號The L. Place F" ended
    // up stored as country names.
    mockGoogle({ places: [] }, HONG_KONG_GEOCODE);

    const result = await new GooglePlacesAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.country).toBe("Hong Kong");
    expect(result?.region).toBe("Hong Kong Island");
  });

  it("carries region/country through the POI branch too", async () => {
    mockGoogle(
      {
        places: [
          {
            displayName: { text: "Some Cafe" },
            formattedAddress: "Some Cafe, Central, Hong Kong",
            primaryTypeDisplayName: { text: "Cafe" },
          },
        ],
      },
      HONG_KONG_GEOCODE
    );

    const result = await new GooglePlacesAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.placeName).toBe("Some Cafe");
    expect(result?.country).toBe("Hong Kong");
    expect(result?.region).toBe("Hong Kong Island");
  });

  it("returns null region/country when the geocode response is empty", async () => {
    mockGoogle(
      {
        places: [{ displayName: { text: "Lone POI" }, formattedAddress: "Lone POI" }],
      },
      { results: [] }
    );

    const result = await new GooglePlacesAdapter().reverseGeocode(1, 1);

    expect(result?.region).toBeNull();
    expect(result?.country).toBeNull();
  });
});
