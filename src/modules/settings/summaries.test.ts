import { describe, expect, it } from "vitest";
import { completionText } from "./summaries";

describe("completionText", () => {
  it("keeps one decimal and never shows 100% while anything is unfinished", () => {
    expect(completionText(12581, 12597)).toBe("99.8%");
    expect(completionText(12597, 12597)).toBe("100.0%");
    expect(completionText(1, 3)).toBe("33.3%");
    expect(completionText(0, 0)).toBe("0%");
  });
});
