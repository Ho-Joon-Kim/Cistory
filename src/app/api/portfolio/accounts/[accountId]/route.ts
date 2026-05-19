import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brokerageAccounts, getDb } from "@/db";
import { ApiError, withAuth, withValidation } from "@/lib/api-handler";

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

const PatchBody = z.object({
  label: z.string().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
  // ISO YYYY-MM-DD. Empty string clears the value.
  openedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$|^$/, "openedAt must be YYYY-MM-DD or empty")
    .optional(),
});

export const PATCH = withValidation<typeof PatchBody, RouteParams>(
  PatchBody,
  async ({ user, body }, { params }) => {
    const { accountId } = await params;
    const db = getDb();

    // If openedAt is being changed, reset the backfill watermarks so the
    // next backfill run re-walks from the new (potentially earlier) date.
    const updates: Partial<typeof brokerageAccounts.$inferInsert> = {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.openedAt !== undefined
        ? {
            openedAt: body.openedAt === "" ? null : body.openedAt,
            executionsBackfilledFrom: null,
            pnlBackfilledFrom: null,
          }
        : {}),
      updatedAt: new Date(),
    };

    const result = await db
      .update(brokerageAccounts)
      .set(updates)
      .where(and(eq(brokerageAccounts.id, accountId), eq(brokerageAccounts.userId, user.id)))
      .returning({ id: brokerageAccounts.id });

    if (result.length === 0) {
      throw new ApiError(404, "계좌를 찾을 수 없습니다", "NOT_FOUND");
    }

    return NextResponse.json({ ok: true });
  }
);

export const DELETE = withAuth<RouteParams>(async ({ user }, { params }) => {
  const { accountId } = await params;
  const db = getDb();

  const result = await db
    .delete(brokerageAccounts)
    .where(and(eq(brokerageAccounts.id, accountId), eq(brokerageAccounts.userId, user.id)))
    .returning({ id: brokerageAccounts.id });

  if (result.length === 0) {
    throw new ApiError(404, "계좌를 찾을 수 없습니다", "NOT_FOUND");
  }

  return NextResponse.json({ ok: true });
});
