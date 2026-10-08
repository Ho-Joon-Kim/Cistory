import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accountRoles, notificationLogs, transactions } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { accountRolesJoinOn, bucketSql } from "./classify";

const POOL = "가족통장 모임통장";
const ME = "김호준";

async function insertTx(
  db: TestDb,
  userId: string,
  row: { type: string; amount: number; merchant: string; accountName: string; at: string }
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
    accountName: row.accountName,
    isSelfTransfer: row.merchant === ME,
    rawTitle: "",
    rawText: "",
    transactedAt: at,
    createdAt: at,
  });
}

describe("bucketSql pooled-account mirror check against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("counts only the user's own, unmirrored pool deposits and correlates per row and user", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db, { tossMyName: ME });
    const other = await insertTestUser(db, { tossMyName: "남" });
    await db.insert(accountRoles).values({
      userId: owner,
      accountName: POOL,
      role: "spending",
      createdAt: new Date(),
    });

    // Jul: the auto-transfer and its pool-side deposit arrive 100 ms apart.
    await insertTx(db, owner, {
      type: "withdrawal",
      amount: 100_000,
      merchant: "김지현(모임통장)",
      accountName: "내 토스뱅크 통장",
      at: "2026-07-20T02:35:01.253Z",
    });
    await insertTx(db, owner, {
      type: "deposit",
      amount: 100_000,
      merchant: ME,
      accountName: POOL,
      at: "2026-07-20T02:35:01.130Z",
    });
    // Sep: an own deposit with no source-side withdrawal (e.g. sent from another bank).
    await insertTx(db, owner, {
      type: "deposit",
      amount: 100_000,
      merchant: ME,
      accountName: POOL,
      at: "2026-09-20T02:00:00.000Z",
    });
    // Another user's identical withdrawal at the same instant must not mirror it.
    await insertTx(db, other, {
      type: "withdrawal",
      amount: 100_000,
      merchant: "누군가",
      accountName: "내 토스뱅크 통장",
      at: "2026-09-20T02:00:00.000Z",
    });
    // Another member's contribution.
    await insertTx(db, owner, {
      type: "deposit",
      amount: 100_000,
      merchant: "김지은",
      accountName: POOL,
      at: "2026-09-17T02:00:00.000Z",
    });

    const rows = await db
      .select({
        merchant: transactions.merchant,
        accountName: transactions.accountName,
        bucket: bucketSql(ME),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(eq(transactions.userId, owner))
      .orderBy(asc(transactions.transactedAt));

    expect(rows.map((r) => `${r.accountName}:${r.merchant}:${r.bucket}`)).toEqual([
      `${POOL}:${ME}:ignore`,
      "내 토스뱅크 통장:김지현(모임통장):spending",
      `${POOL}:김지은:ignore`,
      `${POOL}:${ME}:spending`,
    ]);

    // The travel module embeds bucketSql in a scalar subquery; the mirror
    // EXISTS must correlate to that subquery's row, not an outer one.
    const [{ total }] = await db
      .execute<{ total: string }>(sql`
      SELECT (
        SELECT coalesce(sum(${transactions.amount}), 0)
        FROM ${transactions}
        LEFT JOIN ${accountRoles} ON ${accountRolesJoinOn}
        WHERE ${and(eq(transactions.userId, owner))}
          AND ${bucketSql(ME)} = 'spending'
      ) AS total
    `)
      .then((r) => r.rows);
    expect(Number(total)).toBe(200_000);
  });

  it("voids a withdrawal only when a later matching cancel exists", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db, { tossMyName: ME });
    const card = "토스뱅크 체크카드";
    // Pre-authorization, its cancel 30 min later, and the real fare.
    await insertTx(db, owner, {
      type: "withdrawal",
      amount: 12_800,
      merchant: "카카오T택시_가승인",
      accountName: card,
      at: "2026-10-02T13:29:15Z",
    });
    await insertTx(db, owner, {
      type: "cancel",
      amount: 12_800,
      merchant: "카카오T택시_가승인",
      accountName: card,
      at: "2026-10-02T13:59:00Z",
    });
    await insertTx(db, owner, {
      type: "withdrawal",
      amount: 12_900,
      merchant: "카카오T일반택시_0",
      accountName: card,
      at: "2026-10-02T13:58:38Z",
    });
    // A cancel that predates the payment must not void it.
    await insertTx(db, owner, {
      type: "cancel",
      amount: 5_000,
      merchant: "가게",
      accountName: card,
      at: "2026-10-01T00:00:00Z",
    });
    await insertTx(db, owner, {
      type: "withdrawal",
      amount: 5_000,
      merchant: "가게",
      accountName: card,
      at: "2026-10-03T00:00:00Z",
    });

    const rows = await db
      .select({ merchant: transactions.merchant, type: transactions.type, bucket: bucketSql(ME) })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(eq(transactions.userId, owner))
      .orderBy(asc(transactions.transactedAt));

    expect(rows.map((r) => `${r.type}:${r.merchant}:${r.bucket}`)).toEqual([
      "cancel:가게:ignore",
      "withdrawal:카카오T택시_가승인:ignore",
      "withdrawal:카카오T일반택시_0:spending",
      "cancel:카카오T택시_가승인:ignore",
      "withdrawal:가게:spending",
    ]);
  });
});
