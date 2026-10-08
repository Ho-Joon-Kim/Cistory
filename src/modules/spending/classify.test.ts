import { describe, expect, it } from "vitest";
import { type AccountRole, classify } from "./classify";

const POOL = "가족통장 모임통장";
const roles = new Map<string, AccountRole>([[POOL, "spending"]]);
const deposit = {
  type: "deposit",
  amount: 100_000,
  accountName: POOL,
  spendingOverride: null,
};

describe("classify — spending-role (pooled) accounts", () => {
  it("counts the user's own deposit as spending", () => {
    expect(
      classify({ ...deposit, merchant: "김호준", isSelfTransfer: true }, roles, "김호준")
    ).toBe("spending");
    // Rows ingested before tossMyName was set carry no self flag.
    expect(
      classify({ ...deposit, merchant: "김호준", isSelfTransfer: false }, roles, "김호준")
    ).toBe("spending");
  });

  it("ignores other members' contributions and interest", () => {
    expect(
      classify({ ...deposit, merchant: "김지은", isSelfTransfer: false }, roles, "김호준")
    ).toBe("ignore");
    expect(
      classify({ ...deposit, merchant: "1.4% 이자", isSelfTransfer: false }, roles, "김호준")
    ).toBe("ignore");
  });

  it("ignores an own deposit already counted as a withdrawal at its source", () => {
    expect(
      classify(
        { ...deposit, merchant: "김호준", isSelfTransfer: true, mirroredByWithdrawal: true },
        roles,
        "김호준"
      )
    ).toBe("ignore");
  });

  it("still ignores withdrawals out of the pool", () => {
    expect(
      classify(
        { ...deposit, type: "withdrawal", merchant: "김지은", isSelfTransfer: false },
        roles,
        "김호준"
      )
    ).toBe("ignore");
  });

  it("lets an explicit include override win", () => {
    expect(
      classify(
        { ...deposit, merchant: "김지은", isSelfTransfer: false, spendingOverride: "include" },
        roles,
        "김호준"
      )
    ).toBe("spending");
  });
});

describe("classify — payment cancellations", () => {
  const payment = {
    type: "withdrawal",
    amount: 12_800,
    merchant: "카카오T택시_가승인",
    accountName: "토스뱅크 체크카드",
    isSelfTransfer: false,
    spendingOverride: null,
  };

  it("drops a cancelled withdrawal and the cancel row itself", () => {
    expect(classify({ ...payment, cancelled: true }, new Map(), null)).toBe("ignore");
    expect(classify({ ...payment, type: "cancel" }, new Map(), null)).toBe("ignore");
  });

  it("keeps an uncancelled withdrawal as spending", () => {
    expect(classify(payment, new Map(), null)).toBe("spending");
  });
});
