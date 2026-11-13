import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brokerageTargetAllocations, getDb } from "@/db";
import { ApiError, withAuth, withValidation } from "@/lib/api-handler";
import { getTargetAllocations, isAccountOwned } from "@/modules/portfolio/queries";

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

async function assertAccountOwned(userId: string, accountId: string): Promise<void> {
  if (!(await isAccountOwned(userId, accountId))) {
    throw new ApiError(404, "계좌를 찾을 수 없어요", "NOT_FOUND");
  }
}

export const GET = withAuth<RouteParams>(async ({ user }, { params }) => {
  const { accountId } = await params;
  const result = await getTargetAllocations(user.id, accountId);
  if (!result) throw new ApiError(404, "계좌를 찾을 수 없어요", "NOT_FOUND");
  return NextResponse.json(result);
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
    message: "비중 합계가 100%가 되어야 해요 (오차 0.5% 허용)",
  })
  .refine((b) => new Set(b.targets.map((t) => t.ticker)).size === b.targets.length, {
    message: "중복된 종목이 있어요",
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
