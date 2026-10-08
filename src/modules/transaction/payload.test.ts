import { describe, expect, it } from "vitest";
import { decodeNotificationPayload } from "./payload";

describe("decodeNotificationPayload", () => {
  it("decodes a payload whose text carries a raw newline", () => {
    const raw = '{"title": "162,500원 결제", "text": "토스뱅크 체크카드 | 가게\n잔액 49,034원"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(decodeNotificationPayload(raw)).toEqual({
      title: "162,500원 결제",
      text: "토스뱅크 체크카드 | 가게\n잔액 49,034원",
    });
  });

  it("defaults missing or non-string fields to empty strings", () => {
    expect(decodeNotificationPayload('{"title": 3}')).toEqual({ title: "", text: "" });
  });

  it("throws on JSON that stays invalid after sanitizing", () => {
    expect(() => decodeNotificationPayload("{not json")).toThrow();
  });
});
