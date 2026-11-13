import { describe, expect, it } from "vitest";
import { accessFromScopes, MASK, sensitiveFields } from "../serialize";
import {
  maskIfPersonalTransfer,
  serializeTransactions,
  TRANSACTION_ALLOWLIST,
} from "./transaction-fields";

const at = new Date("2026-11-13T03:00:00Z");

const card = {
  id: "t-card",
  type: "withdrawal",
  amount: 13900,
  merchant: "주식회사 우아한형제들",
  accountName: "토스페이머니",
  transactedAt: at,
  category: "food",
  rawTitle: "13,900원 결제",
  rawText: "토스페이머니 | 주식회사 우아한형제들",
  isSelfTransfer: false,
};
const received = {
  id: "t-in",
  type: "deposit",
  amount: 300000,
  merchant: "김철수",
  accountName: "토스",
  transactedAt: at,
  rawTitle: "김철수님이 300,000원을 보냈어요",
  rawText: "",
  isSelfTransfer: false,
};
const autoTransfer = {
  id: "t-auto",
  type: "withdrawal",
  amount: 200000,
  merchant: "홍금숙",
  accountName: "내 토스뱅크 통장",
  transactedAt: at,
  rawTitle: "200,000원 자동이체",
  rawText: "홍금숙님에게 200,000원이 자동이체되었어요.",
  isSelfTransfer: false,
};

describe("transaction serializer (AE1, R6)", () => {
  it("read token: card merchant visible, transfer counterparties and every account masked, raw text dropped", () => {
    const [c, r, a] = serializeTransactions(
      [card, received, autoTransfer],
      accessFromScopes(["read"])
    );
    expect(c.merchant).toBe("주식회사 우아한형제들");
    expect(r.merchant).toBe(MASK);
    expect(a.merchant).toBe(MASK);
    for (const row of [c, r, a]) {
      expect(row.accountName).toBe(MASK);
      expect(row).not.toHaveProperty("rawTitle");
      expect(row).not.toHaveProperty("rawText");
    }
    expect(c.isPersonalTransfer).toBe(false);
    expect(r.isPersonalTransfer).toBe(true);
    expect(c.transactedAt).toBe("2026-11-13T12:00:00+09:00");
  });

  it("sensitive-read token sees everything", () => {
    const [c, r] = serializeTransactions(
      [card, received],
      accessFromScopes(["read", "sensitive-read"])
    );
    expect(c.accountName).toBe("토스페이머니");
    expect(r.merchant).toBe("김철수");
    expect(r.rawTitle).toBe("김철수님이 300,000원을 보냈어요");
    expect(c.rawText).toBe("토스페이머니 | 주식회사 우아한형제들");
  });

  it("pins the sensitive field list", () => {
    expect(sensitiveFields(TRANSACTION_ALLOWLIST).sort()).toEqual(
      ["accountName", "merchant", "rawText", "rawTitle"].sort()
    );
  });

  it("masks a search title for a transfer, or when evidence is missing", () => {
    const read = accessFromScopes(["read"]);
    expect(maskIfPersonalTransfer("쿠팡", card, read)).toBe("쿠팡");
    expect(maskIfPersonalTransfer("김철수", received, read)).toBe(MASK);
    expect(maskIfPersonalTransfer("누군가", undefined, read)).toBe(MASK);
    expect(maskIfPersonalTransfer("김철수", received, accessFromScopes(["sensitive-read"]))).toBe(
      "김철수"
    );
  });
});
