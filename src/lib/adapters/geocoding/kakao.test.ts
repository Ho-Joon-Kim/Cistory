// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KAKAO_REST_API_KEY = "test-key";

import { KakaoGeocodingAdapter } from "./kakao";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

/** coord2address 응답 1건 + 카테고리 검색 6건(모두 빈 결과)을 순서대로 준다. */
function mockKakao(addressPayload: unknown) {
  fetchMock.mockResolvedValueOnce(jsonResponse(addressPayload));
  for (let i = 0; i < 6; i++) fetchMock.mockResolvedValueOnce(jsonResponse({ documents: [] }));
}

/**
 * coord2address 응답 + 카테고리 검색: poiIndex 번째만 POI를 반환하고 나머지는 빈 결과
 * @param addressPayload - address/road_address 응답
 * @param poiIndex - POI를 반환할 카테고리 검색의 인덱스 (0-5)
 * @param poi - 반환할 POI 데이터
 */
function mockKakaoWithPoi(
  addressPayload: unknown,
  poiIndex: number,
  poi: {
    place_name: string;
    address_name: string;
    category_group_name: string;
    distance: string;
  }
) {
  fetchMock.mockResolvedValueOnce(jsonResponse(addressPayload));
  for (let i = 0; i < 6; i++) {
    if (i === poiIndex) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ documents: [poi] }));
    } else {
      fetchMock.mockResolvedValueOnce(jsonResponse({ documents: [] }));
    }
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KakaoGeocodingAdapter region/country", () => {
  it("reads region_1depth_name from the address object", async () => {
    mockKakao({
      documents: [
        {
          address: {
            address_name: "서울 강남구 역삼동 123",
            region_1depth_name: "서울",
            region_2depth_name: "강남구",
            region_3depth_name: "역삼동",
          },
          road_address: { address_name: "서울 강남구 테헤란로 1", building_name: "테스트빌딩" },
        },
      ],
    });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.5, 127.0);

    expect(result?.region).toBe("서울");
    expect(result?.country).toBe("대한민국");
  });

  it("falls back to road_address's region when address has none", async () => {
    mockKakao({
      documents: [
        {
          road_address: { address_name: "경기 성남시 분당구 판교로 1", region_1depth_name: "경기" },
        },
      ],
    });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.4, 127.1);

    expect(result?.region).toBe("경기");
  });

  it("returns null region when the response carries none — never guesses from the address string", async () => {
    mockKakao({ documents: [{ address: { address_name: "서울 강남구 역삼동 123" } }] });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.5, 127.0);

    expect(result?.region).toBeNull();
    expect(result?.country).toBe("대한민국");
  });

  it("exercises POI branch: returns region/country when POI is found", async () => {
    mockKakaoWithPoi(
      {
        documents: [
          {
            address: {
              address_name: "서울 강남구 역삼동 123",
              region_1depth_name: "서울",
              region_2depth_name: "강남구",
              region_3depth_name: "역삼동",
            },
            road_address: { address_name: "서울 강남구 테헤란로 1", building_name: "테스트빌딩" },
          },
        ],
      },
      0, // First category search returns POI
      {
        place_name: "스타벅스 강남R점",
        address_name: "서울 강남구 역삼동 123",
        category_group_name: "카페",
        distance: "42",
      }
    );

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.5, 127.0);

    // placeName proves this took the POI branch, not the fallback
    expect(result?.placeName).toBe("스타벅스 강남R점");
    expect(result?.region).toBe("서울");
    expect(result?.country).toBe("대한민국");
  });
});
