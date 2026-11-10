import { describe, expect, it } from "vitest";
import { visitRegion } from "./service";

describe("visitRegion", () => {
  it.each([
    ["서울 강남구 논현동 193-4", "서울 강남구 논현동"],
    ["대전광역시 중구 목척7길 10", "대전광역시 중구 목척7길"],
    ["전북특별자치도 익산시 익산대로 153", "전북특별자치도 익산시 익산대로"],
    ["서울", "서울"],
    ["Hong Kong · Hong Kong", "Hong Kong · Hong Kong"],
  ])("trims lot numbers from %s", (input, expected) => {
    expect(visitRegion(input)).toBe(expected);
  });
});
