import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isRefundDeposit, merchantBase, refundSql, summarizeIncomeFlow } from "./refund";

describe("merchantBase", () => {
  it("drops Toss's underscore suffix and surrounding spaces", () => {
    expect(merchantBase("한국철도공사_토스 원클릭결제")).toBe("한국철도공사");
    expect(merchantBase("한국철도공사_")).toBe("한국철도공사");
    expect(merchantBase(" 쿠팡이츠 ")).toBe("쿠팡이츠");
    expect(merchantBase("_")).toBe("");
  });
});

describe("isRefundDeposit", () => {
  const purchases = new Set(["한국철도공사", "쿠팡이츠"]);

  it("is a deposit from a merchant the user has paid", () => {
    expect(
      isRefundDeposit({ type: "deposit", bucket: "income", merchant: "한국철도공사_" }, purchases)
    ).toBe(true);
    expect(
      isRefundDeposit({ type: "deposit", bucket: "income", merchant: "쿠팡이츠" }, purchases)
    ).toBe(true);
  });

  it("is never a person's transfer, a withdrawal or an ignored deposit", () => {
    expect(
      isRefundDeposit({ type: "deposit", bucket: "income", merchant: "박주성" }, purchases)
    ).toBe(false);
    expect(
      isRefundDeposit({ type: "withdrawal", bucket: "spending", merchant: "쿠팡이츠" }, purchases)
    ).toBe(false);
    expect(
      isRefundDeposit({ type: "deposit", bucket: "ignore", merchant: "쿠팡이츠" }, purchases)
    ).toBe(false);
  });
});

describe("refundSql", () => {
  it("excludes gift and finance payees and correlates per user", () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(refundSql(sql`'income'`));
    expect(text).toContain("purchase.user_id");
    expect(text).toContain("purchase.category NOT IN");
    expect(params).toEqual(expect.arrayContaining(["gift", "finance"]));
  });
});

describe("summarizeIncomeFlow", () => {
  it("splits refunds from other money and names the biggest source of each", () => {
    const flow = summarizeIncomeFlow([
      {
        isRefund: true,
        merchant: "한국철도공사_",
        accountName: "내 토스뱅크 통장",
        total: 107_000,
        count: 3,
      },
      {
        isRefund: true,
        merchant: "한국철도공사_토스 원",
        accountName: "내 토스뱅크 통장",
        total: 65_200,
        count: 2,
      },
      {
        isRefund: false,
        merchant: "박주성",
        accountName: "내 DYB 모임통장",
        total: 30_000,
        count: 1,
      },
      {
        isRefund: false,
        merchant: "이제성",
        accountName: "내 DYB 모임통장",
        total: 30_000,
        count: 1,
      },
    ]);
    expect(flow).toEqual({
      refundTotal: 172_200,
      refundCount: 5,
      refundTopMerchant: "한국철도공사",
      inflowTotal: 60_000,
      inflowCount: 2,
      inflowTopAccount: "내 DYB 모임통장",
    });
  });

  it("is all zeros and nulls without income", () => {
    expect(summarizeIncomeFlow([])).toEqual({
      refundTotal: 0,
      refundCount: 0,
      refundTopMerchant: null,
      inflowTotal: 0,
      inflowCount: 0,
      inflowTopAccount: null,
    });
  });
});
