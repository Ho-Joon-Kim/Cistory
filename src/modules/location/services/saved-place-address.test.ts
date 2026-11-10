import { describe, expect, it } from "vitest";
import { isKoreanAddress } from "./saved-place-address";

describe("isKoreanAddress", () => {
  it("accepts Hangul addresses, with digits and short Latin tokens", () => {
    expect(isKoreanAddress("서울 강남구 논현동 123")).toBe(true);
    expect(isKoreanAddress("대전 중구 목척7길 B1")).toBe(true);
  });

  it("rejects romanized, mixed and empty addresses", () => {
    expect(isKoreanAddress("Nonhyeon-dong, 06112, Gangnam-gu, Seoul")).toBe(false);
    expect(isKoreanAddress("목척7길 Jung-gu, Daejeon, South Korea")).toBe(false);
    expect(isKoreanAddress("123")).toBe(false);
    expect(isKoreanAddress("")).toBe(false);
    expect(isKoreanAddress(null)).toBe(false);
    expect(isKoreanAddress(undefined)).toBe(false);
  });
});
