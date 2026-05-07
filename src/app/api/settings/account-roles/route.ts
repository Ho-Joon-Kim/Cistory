/**
 * Account Roles API (session-authenticated)
 *
 * GET  /api/settings/account-roles
 *   Returns every distinct accountName seen in this user's transactions
 *   alongside its currently configured role (default if unset).
 *
 * PUT  /api/settings/account-roles
 *   Body: { roles: { accountName: string, role: 'spending'|'default'|'ignore' }[] }
 *   Upserts the role for each given accountName. Sending role='default'
 *   removes the row.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { accountRoles, transactions } from "@/db/schema";
import { withAuth, withValidation } from "@/lib/api-handler";

const ROLES = ["spending", "default", "ignore"] as const;
type RoleValue = (typeof ROLES)[number];

const Body = z.object({
  roles: z
    .array(
      z.object({
        accountName: z.string().min(1).max(200),
        role: z.enum(ROLES),
      })
    )
    .max(200),
});

export const GET = withAuth(async ({ user }) => {
  const db = getDb();

  const [accounts, roles] = await Promise.all([
    db
      .select({
        accountName: transactions.accountName,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .groupBy(transactions.accountName)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        accountName: accountRoles.accountName,
        role: accountRoles.role,
      })
      .from(accountRoles)
      .where(eq(accountRoles.userId, user.id)),
  ]);

  const roleMap = new Map(roles.map((r) => [r.accountName, r.role as RoleValue]));

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      accountName: a.accountName,
      transactionCount: Number(a.count),
      role: roleMap.get(a.accountName) ?? "default",
    })),
  });
});

export const PUT = withValidation(Body, async ({ user, body }) => {
  const db = getDb();
  const now = new Date();

  const toDelete = body.roles
    .filter((r) => r.role === "default")
    .map((r) => r.accountName);
  const toUpsert = body.roles.filter((r) => r.role !== "default");

  await db.transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx
        .delete(accountRoles)
        .where(
          and(eq(accountRoles.userId, user.id), inArray(accountRoles.accountName, toDelete))
        );
    }

    for (const r of toUpsert) {
      await tx
        .insert(accountRoles)
        .values({
          userId: user.id,
          accountName: r.accountName,
          role: r.role,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [accountRoles.userId, accountRoles.accountName],
          set: { role: r.role },
        });
    }
  });

  return NextResponse.json({ success: true, updated: body.roles.length });
});
