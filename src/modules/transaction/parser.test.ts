import { describe, expect, it } from "vitest";
import { parseTossNotification } from "./parser";

describe("parseTossNotification", () => {
  it("parses a basic withdrawal (계좌 → 가맹점)", () => {
    expect(parseTossNotification("6,900원 출금", "내 토스뱅크 통장 → 쿠팡")).toEqual({
      type: "withdrawal",
      amount: 6900,
      merchant: "쿠팡",
      accountName: "내 토스뱅크 통장",
      isSelfTransfer: false,
    });
  });

  it("parses a basic deposit (송금자 → 계좌)", () => {
    expect(parseTossNotification("1원 입금", "**** → 내 토스뱅크 통장")).toEqual({
      type: "deposit",
      amount: 1,
      merchant: "****",
      accountName: "내 토스뱅크 통장",
      isSelfTransfer: false,
    });
  });

  it("parses a transfer-received notification", () => {
    expect(parseTossNotification("김철수님이 300,000원을 보냈어요", "")).toEqual({
      type: "deposit",
      amount: 300000,
      merchant: "김철수",
      accountName: "토스",
      isSelfTransfer: false,
    });
  });

  it("parses a payment (토스페이머니 | 가맹점)", () => {
    expect(
      parseTossNotification("13,900원 결제", "토스페이머니 | 주식회사 우아한형제들")
    ).toEqual({
      type: "withdrawal",
      amount: 13900,
      merchant: "주식회사 우아한형제들",
      accountName: "토스페이머니",
      isSelfTransfer: false,
    });
  });

  it("flags a self-transfer when the counterparty matches myName", () => {
    const result = parseTossNotification("홍길동님이 5,000원을 보냈어요", "", { myName: "홍길동" });
    expect(result?.isSelfTransfer).toBe(true);
  });

  it("does not flag a self-transfer for a different counterparty", () => {
    const result = parseTossNotification("김철수님이 5,000원을 보냈어요", "", { myName: "홍길동" });
    expect(result?.isSelfTransfer).toBe(false);
  });

  it("returns null for an unrecognized title", () => {
    expect(parseTossNotification("토스 알림", "본문")).toBeNull();
  });

  it("returns null when a withdrawal body has no source→destination split", () => {
    expect(parseTossNotification("6,900원 출금", "화살표 없는 본문")).toBeNull();
  });

  it("returns null when a payment body has no account|merchant split", () => {
    expect(parseTossNotification("13,900원 결제", "구분자 없는 본문")).toBeNull();
  });
});
