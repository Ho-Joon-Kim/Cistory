import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notificationLogs, transactions } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { reparseNotifications } from "./reparse-service";

const payment = (balance: string) =>
  // Raw newline, exactly as MacroDroid delivers multi-line receipts.
  `{"title": "800원 결제", "text": "토스뱅크 체크카드 | 자판기(1)_코세스\n잔액 ${balance}원"}`;

describe("reparseNotifications duplicate window against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("keeps back-to-back same-amount purchases but drops a verbatim retry", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    await db.insert(notificationLogs).values([
      { userId, rawPayload: payment("137,862"), receivedAt: new Date("2026-05-16T02:49:10Z") },
      { userId, rawPayload: payment("137,062"), receivedAt: new Date("2026-05-16T02:49:19Z") },
      // MacroDroid retry of the second notification.
      { userId, rawPayload: payment("137,062"), receivedAt: new Date("2026-05-16T02:49:40Z") },
    ]);

    const totals = await reparseNotifications(db, userId, { dryRun: false, tossMyName: null });

    expect(totals).toMatchObject({ total: 3, created: 2, skipped: 1, failed: 0 });
    const rows = await db
      .select({ merchant: transactions.merchant, rawText: transactions.rawText })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.transactedAt));
    expect(rows.map((r) => r.merchant)).toEqual(["자판기(1)_코세스", "자판기(1)_코세스"]);
    expect(rows.map((r) => r.rawText.split("\n")[1])).toEqual(["잔액 137,862원", "잔액 137,062원"]);
  });
});
