import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { createSpendingTrendService } from "./service";

async function insertWithdrawal(
  db: TestDb,
  userId: string,
  row: { amount: number; merchant: string; at: string }
) {
  const at = new Date(row.at);
  const [log] = await db
    .insert(notificationLogs)
    .values({ userId, rawPayload: "{}", receivedAt: at })
    .returning();
  await db.insert(transactions).values({
    userId,
    notificationLogId: log.id,
    type: "withdrawal",
    amount: row.amount,
    merchant: row.merchant,
    accountName: "내 토스뱅크 통장",
    isSelfTransfer: false,
    rawTitle: "",
    rawText: "",
    transactedAt: at,
    createdAt: at,
  });
}

describe("SpendingTrendService KST day grouping against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("buckets transactions by KST day and KST month, not UTC", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db, { tossMyName: "김호준" });
    // 11/3 08:54 KST — UTC day is still 11/2.
    await insertWithdrawal(db, userId, {
      amount: 5_940,
      merchant: "쿠팡",
      at: "2026-11-02T23:54:44.091Z",
    });
    // 11/1 01:00 KST — UTC month is still October.
    await insertWithdrawal(db, userId, {
      amount: 1_000,
      merchant: "편의점",
      at: "2026-10-31T16:00:00.000Z",
    });
    // 10/31 23:00 KST — belongs to October.
    await insertWithdrawal(db, userId, {
      amount: 7_000,
      merchant: "식당",
      at: "2026-10-31T14:00:00.000Z",
    });

    const service = createSpendingTrendService(db as unknown as Database);
    // 2026-11-10 12:00 KST
    const trend = await service.getSpendingTrend(userId, new Date("2026-11-10T03:00:00Z"));

    expect(trend.forecast.todayDayNumber).toBe(10);
    expect(trend.forecast.daysInMonth).toBe(30);
    expect(trend.forecast.currentMonthActualTotal).toBe(6_940);
    const actual = (d: number) => trend.cumulativeCurve.find((p) => p.day === d)?.actual;
    expect(actual(1)).toBe(1_000);
    expect(actual(2)).toBe(1_000);
    expect(actual(3)).toBe(6_940);

    const bars = Object.fromEntries(trend.monthlyBars.map((b) => [b.month, b.total]));
    expect(bars).toEqual({ "10": 7_000, "11": 6_940 });
  });
});
