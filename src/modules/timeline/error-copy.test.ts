import { describe, expect, it } from "vitest";
import { dayErrorMessage } from "./error-copy";

describe("dayErrorMessage", () => {
  const title = "커밋을 불러오지 못했어요.";

  it("never shows raw platform text", () => {
    expect(dayErrorMessage(new TypeError("Failed to fetch (127.0.0.1:3500)"), title)).toBe(
      "커밋을 불러오지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요."
    );
    expect(dayErrorMessage(new Error("Internal Server Error"), title)).toBe(title);
    expect(dayErrorMessage("boom", title)).toBe(title);
  });

  it("drops a reason that only repeats the title", () => {
    expect(dayErrorMessage(new Error("커밋을 불러오지 못했어요"), title)).toBe(title);
  });

  it("keeps a distinct Korean reason", () => {
    expect(dayErrorMessage(new Error("요청이 너무 많아요."), title)).toBe(
      "커밋을 불러오지 못했어요. 요청이 너무 많아요."
    );
  });
});
