import { describe, expect, it } from "vitest";
import { createTripName } from "./trip-naming";

const HONG_KONG = { centerLat: 22.308, centerLon: 113.9185 };
const TOKYO = { centerLat: 35.6762, centerLon: 139.6503 };
const TAIPEI = { centerLat: 25.033, centerLon: 121.5654 };
const JEJU = { centerLat: 33.4996, centerLon: 126.5312 };

describe("createTripName", () => {
  it("uses the coordinate-derived Hong Kong name and ignores raw country text", () => {
    expect(
      createTripName([
        {
          ...HONG_KONG,
          city: "赤鱲角 Sky Plaza Rd",
          countryName: "赤鱲角國際機場1號客運大樓",
        },
      ])
    ).toEqual("홍콩 여행");
  });

  it.each([
    ["제주", "제주 여행"],
    ["제주특별자치도", "제주 여행"],
    ["제주도", "제주 여행"],
  ])("normalizes the supported Jeju region alias %s", (city, expected) => {
    expect(createTripName([{ ...JEJU, city, countryName: "대한민국" }])).toEqual(expected);
  });

  it("normalizes region names not in the alias table via suffix stripping", () => {
    expect(
      createTripName([
        { centerLat: 34.8, centerLon: 126.8, city: "전남광주통합특별시", countryName: "대한민국" },
      ])
    ).toEqual("전남광주통합 여행");
  });

  it("rejects romanised region names from fallback geocoders", () => {
    expect(
      createTripName([
        { ...JEJU, city: "Jeju-do", countryName: "대한민국" },
        { ...JEJU, city: "Gyeonggi-do", countryName: "대한민국" },
      ])
    ).toEqual("국내 여행");
  });

  it.each([
    ["서울", "서울 여행"],
    ["서울특별시", "서울 여행"],
  ])("normalizes Seoul region names %s → %s", (city, expected) => {
    expect(
      createTripName([{ centerLat: 37.5665, centerLon: 126.978, city, countryName: "대한민국" }])
    ).toEqual(expected);
  });

  it("falls back for untrusted domestic city values", () => {
    expect(
      createTripName([
        { ...JEJU, city: "목척7길", countryName: "대한민국" },
        { ...JEJU, city: "06628,", countryName: "대한민국" },
      ])
    ).toEqual("국내 여행");
  });

  it("uses the most frequent allow-listed domestic region", () => {
    expect(
      createTripName([
        { ...JEJU, city: "제주특별자치도", countryName: "대한민국" },
        { ...JEJU, city: "제주", countryName: "대한민국" },
        { centerLat: 35.1796, centerLon: 129.0756, city: "부산", countryName: "대한민국" },
      ])
    ).toEqual("제주 여행");
  });

  it("includes every coordinate-derived country in a multi-country trip", () => {
    expect(
      createTripName([
        { ...TOKYO, city: "도쿄", countryName: "untrusted-japan" },
        { ...TAIPEI, city: "타이베이", countryName: "untrusted-taiwan" },
      ])
    ).toEqual("일본 · 대만 여행");
  });

  it("falls back to a generic overseas name outside known country bounds", () => {
    expect(
      createTripName([
        {
          centerLat: -33.8688,
          centerLon: 18.6277,
          city: "untrusted-city",
          countryName: "untrusted-country",
        },
      ])
    ).toEqual("해외 여행");
  });
});
