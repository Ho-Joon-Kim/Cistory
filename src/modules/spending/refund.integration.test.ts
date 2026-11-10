import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accountRoles, notificationLogs, transactions } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { accountRolesJoinOn, bucketSql } from "./classify";
import { refundSql, selectIncomeGroups, summarizeIncomeFlow } from "./refund";

const ACCOUNT = "내 토스뱅크 통장";
const SAVINGS = "저축 통장";

async function insertTx(
  db: TestDb,
  userId: string,
  row: {
    type: "withdrawal" | "deposit";
    amount: number;
    merchant: string;
    category?: string | null;
    accountName?: string;
    at: string;
  }
) {
  const at = new Date(row.at);
  const [log] = await db
    .insert(notificationLogs)
    .values({ userId, rawPayload: "{}", receivedAt: at })
    .returning();
  await db.insert(transactions).values({
    userId,
    notificationLogId: log.id,
    type: row.type,
    amount: row.amount,
    merchant: row.merchant,
    accountName: row.accountName ?? ACCOUNT,
    category: row.category ?? null,
    isSelfTransfer: false,
    rawTitle: "",
    rawText: "",
    transactedAt: at,
    createdAt: at,
  });
}

describe("refundSql and the income-flow query against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("flags deposits from the user's own purchase payees only", async () => {
    const db = ctx.db();
    const me = await insertTestUser(db, { tossMyName: "나" });
    const other = await insertTestUser(db, { tossMyName: "남" });

    // My purchases: a categorized shop, a gift to a friend, a financial payee,
    // and an uncategorized payment.
    await insertTx(db, me, {
      type: "withdrawal",
      amount: 59_800,
      merchant: "한국철도공사_토스 원클릭결제",
      category: "travel",
      at: "2026-10-01T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "withdrawal",
      amount: 50_000,
      merchant: "김친구",
      category: "gift",
      at: "2026-10-02T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "withdrawal",
      amount: 300_000,
      merchant: "토스증권",
      category: "finance",
      at: "2026-10-03T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "withdrawal",
      amount: 7_000,
      merchant: "동네가게",
      category: null,
      at: "2026-10-04T01:00:00Z",
    });
    // Only the OTHER user ever paid 쿠팡이츠.
    await insertTx(db, other, {
      type: "withdrawal",
      amount: 20_000,
      merchant: "쿠팡이츠",
      category: "food",
      at: "2026-10-04T01:00:00Z",
    });

    // My deposits.
    await insertTx(db, me, {
      type: "deposit",
      amount: 59_800,
      merchant: "한국철도공사_",
      at: "2026-10-05T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "deposit",
      amount: 25_000,
      merchant: "김친구",
      at: "2026-10-06T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "deposit",
      amount: 1_000,
      merchant: "토스증권",
      accountName: SAVINGS,
      at: "2026-10-07T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "deposit",
      amount: 7_000,
      merchant: "동네가게",
      at: "2026-10-08T01:00:00Z",
    });
    await insertTx(db, me, {
      type: "deposit",
      amount: 20_000,
      merchant: "쿠팡이츠",
      at: "2026-10-09T01:00:00Z",
    });
    // The other user's refund from their own purchase payee.
    await insertTx(db, other, {
      type: "deposit",
      amount: 20_000,
      merchant: "쿠팡이츠",
      at: "2026-10-09T01:00:00Z",
    });

    const bucket = bucketSql("나");
    const rows = await db
      .select({
        type: transactions.type,
        merchant: transactions.merchant,
        isRefund: refundSql(bucket).as("is_refund"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(eq(transactions.userId, me))
      .orderBy(asc(transactions.transactedAt));
    expect(rows.map((r) => `${r.type}:${r.merchant}:${r.isRefund}`)).toEqual([
      // A purchase is never a refund.
      "withdrawal:한국철도공사_토스 원클릭결제:false",
      "withdrawal:김친구:false",
      "withdrawal:토스증권:false",
      "withdrawal:동네가게:false",
      // Same base payer as a categorized purchase (Toss suffix ignored).
      "deposit:한국철도공사_:true",
      // Gift and finance payees are people/institutions, not shops.
      "deposit:김친구:false",
      "deposit:토스증권:false",
      // An uncategorized purchase doesn't qualify the payee.
      "deposit:동네가게:false",
      // Another user's purchase never makes my deposit a refund.
      "deposit:쿠팡이츠:false",
    ]);

    const groups = await selectIncomeGroups(db, eq(transactions.userId, me), bucket);
    expect(summarizeIncomeFlow(groups)).toEqual({
      refundTotal: 59_800,
      refundCount: 1,
      refundTopMerchant: "한국철도공사",
      inflowTotal: 25_000 + 1_000 + 7_000 + 20_000,
      inflowCount: 4,
      inflowTopAccount: ACCOUNT,
    });

    const otherGroups = await selectIncomeGroups(
      db,
      eq(transactions.userId, other),
      bucketSql("남")
    );
    expect(summarizeIncomeFlow(otherGroups)).toMatchObject({
      refundTotal: 20_000,
      refundCount: 1,
      refundTopMerchant: "쿠팡이츠",
      inflowTotal: 0,
    });
  });
});
