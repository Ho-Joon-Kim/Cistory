import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  sameErrorCopy,
  userErrorMessage,
} from "./user-error";

describe("userErrorMessage", () => {
  it("keeps a Korean message", () => {
    expect(userErrorMessage(new Error("재계산 요청이 너무 많아요"))).toBe(
      "재계산 요청이 너무 많아요"
    );
    expect(userErrorMessage("여행을 찾지 못했어요")).toBe("여행을 찾지 못했어요");
  });

  it("maps a fetch TypeError to the network copy, never the raw host", () => {
    expect(userErrorMessage(new TypeError("Failed to fetch (127.0.0.1:3500)"))).toBe(
      NETWORK_ERROR_MESSAGE
    );
  });

  it("replaces English, status codes and non-errors with the fallback", () => {
    expect(userErrorMessage(new Error("HTTP 500"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userErrorMessage(new SyntaxError("Unexpected token <"), "다시 시도")).toBe("다시 시도");
    expect(userErrorMessage("rate limited", "다시 시도")).toBe("다시 시도");
    expect(userErrorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(userErrorMessage({ message: "서버 오류예요" })).toBe("서버 오류예요");
  });
});

describe("sameErrorCopy", () => {
  it("ignores trailing punctuation and spacing", () => {
    expect(sameErrorCopy("불러오지 못했어요.", "불러오지 못했어요")).toBe(true);
    expect(sameErrorCopy("불러오지 못했어요", "잠시 후 다시 시도해 주세요.")).toBe(false);
  });
});
