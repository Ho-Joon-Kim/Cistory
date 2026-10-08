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
    expect(parseTossNotification("13,900원 결제", "토스페이머니 | 주식회사 우아한형제들")).toEqual({
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

  // Characterization: parser.ts:62 requires exactly one '→' (parts.length !== 2).
  // A body with two or more arrows — e.g. a merchant name containing '→' — is
  // silently dropped as null rather than parsed or reported.
  it("silently returns null when a withdrawal body contains two or more '→'", () => {
    expect(parseTossNotification("6,900원 출금", "내 토스뱅크 통장 → 상점A → 지점B")).toBeNull();
  });

  // Same shape for Pattern 3: a merchant name containing '|' splits into 3 parts.
  it("silently returns null when a payment body contains two or more '|'", () => {
    expect(parseTossNotification("13,900원 결제", "토스페이머니 | 회사 | 지점")).toBeNull();
  });

  it("returns null for an empty title", () => {
    expect(parseTossNotification("", "내 토스뱅크 통장 → 쿠팡")).toBeNull();
  });

  it("parses a million-scale amount with multiple comma groups", () => {
    expect(parseTossNotification("1,234,567원 출금", "내 토스뱅크 통장 → 자동차딜러")).toEqual({
      type: "withdrawal",
      amount: 1234567,
      merchant: "자동차딜러",
      accountName: "내 토스뱅크 통장",
      isSelfTransfer: false,
    });
  });

  it("returns null when the arrow destination is empty", () => {
    expect(parseTossNotification("6,900원 출금", "내 토스뱅크 통장 → ")).toBeNull();
  });

  it("parses a bill auto-payment titled 요금납부", () => {
    expect(parseTossNotification("요금납부 31,980원 출금", "내 토스뱅크 통장 → 9월전기료")).toEqual(
      {
        type: "withdrawal",
        amount: 31980,
        merchant: "9월전기료",
        accountName: "내 토스뱅크 통장",
        isSelfTransfer: false,
      }
    );
  });

  it("strips the trailing balance line from a card payment merchant", () => {
    expect(
      parseTossNotification("162,500원 결제", "토스뱅크 체크카드 | 갓포아키제주도점\n잔액 49,034원")
    ).toEqual({
      type: "withdrawal",
      amount: 162500,
      merchant: "갓포아키제주도점",
      accountName: "토스뱅크 체크카드",
      isSelfTransfer: false,
    });
    expect(
      parseTossNotification("49,000원 결제", "토스뱅크 체크카드 | 정기과금_카카오페이 잔액 111원")
        ?.merchant
    ).toBe("정기과금_카카오페이");
  });

  it("keeps a merchant whose own name contains 잔액", () => {
    expect(
      parseTossNotification("5,000원 결제", "토스뱅크 체크카드 | 잔액부족카페")?.merchant
    ).toBe("잔액부족카페");
  });

  it("parses a completed auto-transfer to another person as a withdrawal", () => {
    expect(
      parseTossNotification("200,000원 자동이체", "홍금숙님에게 200,000원이 자동이체되었어요.", {
        myName: "김호준",
      })
    ).toEqual({
      type: "withdrawal",
      amount: 200000,
      merchant: "홍금숙",
      accountName: "내 토스뱅크 통장",
      isSelfTransfer: false,
    });
  });

  it("keeps the (모임통장) suffix on an auto-transfer recipient", () => {
    expect(
      parseTossNotification(
        "100,000원 자동이체",
        "김지현(모임통장)님에게 100,000원이 자동이체되었어요."
      )?.merchant
    ).toBe("김지현(모임통장)");
  });

  it("flags an auto-transfer to the user's own savings account as a self-transfer", () => {
    expect(
      parseTossNotification(
        "700,000원 자동이체",
        "김호준님에게 700,000원이 자동이체되었어요. KB청년도약계좌",
        { myName: "김호준" }
      )
    ).toEqual({
      type: "withdrawal",
      amount: 700000,
      merchant: "김호준",
      accountName: "내 토스뱅크 통장",
      isSelfTransfer: true,
    });
  });

  it("ignores auto-transfer reminders and failures", () => {
    expect(
      parseTossNotification("자동이체 안내", "내일 박주성선배님에게 20,000원 보낼게요.")
    ).toBeNull();
    expect(
      parseTossNotification("자동이체 실패", "박주성선배님에게 20,000원을 자동이체하지 못했어요.")
    ).toBeNull();
    expect(parseTossNotification("200,000원 자동이체", "내일 자동이체 예정이에요")).toBeNull();
  });

  it("parses a payment cancellation as a cancel row with the balance stripped", () => {
    expect(
      parseTossNotification(
        "12,800원 결제 취소",
        "토스뱅크 체크카드 | 카카오T택시_가승인 잔액 30,100원"
      )
    ).toEqual({
      type: "cancel",
      amount: 12800,
      merchant: "카카오T택시_가승인",
      accountName: "토스뱅크 체크카드",
      isSelfTransfer: false,
    });
  });

  it("does not parse an amount-less 결제 취소 that cannot be matched to a payment", () => {
    expect(parseTossNotification("결제 취소", "계좌 | 한국철도공사_토스 원클릭결제")).toBeNull();
  });
});
