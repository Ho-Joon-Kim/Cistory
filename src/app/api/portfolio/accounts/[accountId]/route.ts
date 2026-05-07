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
});

export const PATCH = withValidation<typeof PatchBody, RouteParams>(
  PatchBody,
  async ({ user, body }, { params }) => {
    const { accountId } = await params;
    const db = getDb();

    const result = await db
      .update(brokerageAccounts)
      .set({
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
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
