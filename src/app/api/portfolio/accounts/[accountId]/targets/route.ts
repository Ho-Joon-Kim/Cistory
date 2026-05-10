import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brokerageAccounts, brokerageTargetAllocations, getDb } from "@/db";
import { ApiError, withAuth, withValidation } from "@/lib/api-handler";

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

async function assertAccountOwned(userId: string, accountId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(and(eq(brokerageAccounts.id, accountId), eq(brokerageAccounts.userId, userId)))
    .limit(1);
  if (rows.length === 0) {
    throw new ApiError(404, "계좌를 찾을 수 없습니다", "NOT_FOUND");
  }
}

export const GET = withAuth<RouteParams>(async ({ user }, { params }) => {
  const { accountId } = await params;
  await assertAccountOwned(user.id, accountId);

  const db = getDb();
  const rows = await db
    .select({
      ticker: brokerageTargetAllocations.ticker,
      name: brokerageTargetAllocations.name,
      targetWeight: brokerageTargetAllocations.targetWeight,
      updatedAt: brokerageTargetAllocations.updatedAt,
    })
    .from(brokerageTargetAllocations)
    .where(eq(brokerageTargetAllocations.accountId, accountId));

  const updatedAt =
    rows.length > 0
      ? rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), rows[0].updatedAt)
      : null;

  return NextResponse.json({
    targets: rows.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      targetWeight: Number(r.targetWeight),
    })),
    updatedAt: updatedAt?.toISOString() ?? null,
  });
});

const PutBody = z
  .object({
    targets: z
      .array(
        z.object({
          ticker: z.string().min(1).max(20),
          name: z.string().min(1).max(120),
          targetWeight: z.number().min(0).max(1),
        })
      )
      .min(1)
      .max(50),
  })
  .refine((b) => Math.abs(b.targets.reduce((s, t) => s + t.targetWeight, 0) - 1) < 0.005, {
    message: "비중 합계가 100%가 되어야 합니다 (오차 0.5% 허용)",
  })
  .refine((b) => new Set(b.targets.map((t) => t.ticker)).size === b.targets.length, {
    message: "중복된 종목이 있습니다",
  });

export const PUT = withValidation<typeof PutBody, RouteParams>(
  PutBody,
  async ({ user, body }, { params }) => {
    const { accountId } = await params;
    await assertAccountOwned(user.id, accountId);

    const db = getDb();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(brokerageTargetAllocations)
        .where(eq(brokerageTargetAllocations.accountId, accountId));
      await tx.insert(brokerageTargetAllocations).values(
        body.targets.map((t) => ({
          accountId,
          ticker: t.ticker,
          name: t.name,
          targetWeight: String(t.targetWeight),
          createdAt: now,
          updatedAt: now,
        }))
      );
    });

    return NextResponse.json({ ok: true, count: body.targets.length });
  }
);
