import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brokerageAccounts, getDb } from "@/db";
import { createKISAdapter, KISAuthError } from "@/lib/adapters/kis/interface";
import { ApiError, withAuth, withValidation } from "@/lib/api-handler";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { createPortfolioSyncService } from "@/modules/portfolio/service";

const ACCOUNT_TYPES = ["general", "isa_brokerage", "irp", "pension"] as const;

const CreateBody = z.object({
  label: z.string().min(1).max(60),
  cano: z.string().regex(/^\d{8}$/, "8자리 숫자"),
  acntPrdtCd: z.string().regex(/^\d{2}$/, "2자리 숫자"),
  accountType: z.enum(ACCOUNT_TYPES),
  appKey: z.string().min(20),
  appSecret: z.string().min(40),
  openedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "openedAt must be YYYY-MM-DD")
    .optional(),
});

export const GET = withAuth(async ({ user }) => {
  const db = getDb();
  const rows = await db
    .select({
      id: brokerageAccounts.id,
      label: brokerageAccounts.label,
      broker: brokerageAccounts.broker,
      cano: brokerageAccounts.cano,
      acntPrdtCd: brokerageAccounts.acntPrdtCd,
      accountType: brokerageAccounts.accountType,
      appKeyEnc: brokerageAccounts.appKeyEnc,
      isActive: brokerageAccounts.isActive,
      lastSyncedAt: brokerageAccounts.lastSyncedAt,
      lastSyncError: brokerageAccounts.lastSyncError,
      openedAt: brokerageAccounts.openedAt,
      executionsBackfilledFrom: brokerageAccounts.executionsBackfilledFrom,
      pnlBackfilledFrom: brokerageAccounts.pnlBackfilledFrom,
      createdAt: brokerageAccounts.createdAt,
    })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id))
    .orderBy(brokerageAccounts.createdAt);

  return NextResponse.json({
    accounts: rows.map((r) => ({
      id: r.id,
      label: r.label,
      broker: r.broker,
      cano: r.cano,
      acntPrdtCd: r.acntPrdtCd,
      accountType: r.accountType,
      appKeyMasked: maskAppKey(r.appKeyEnc),
      isActive: r.isActive,
      lastSyncedAt: r.lastSyncedAt,
      lastSyncError: r.lastSyncError,
      openedAt: r.openedAt,
      executionsBackfilledFrom: r.executionsBackfilledFrom,
      pnlBackfilledFrom: r.pnlBackfilledFrom,
      createdAt: r.createdAt,
    })),
  });
});

function maskAppKey(enc: string): string {
  // We don't decrypt for masking — just show enc length. Use a stable masked form.
  // Actual key prefix is shown after successful verify in POST flow.
  return `••••${enc.slice(-4)}`;
}

function friendlyAuthMessage(code: string, fallback: string): string {
  if (code === "OPSQ2000") return "이 키는 입력한 계좌와 매칭되지 않습니다";
  if (code === "APBK1271") return "계좌번호 또는 상품코드가 올바르지 않습니다";
  if (code === "APAC0489") return "이 계좌 유형은 일반 잔고조회를 지원하지 않습니다";
  return fallback;
}

async function verifyKisCredentials(
  appKey: string,
  appSecret: string,
  cano: string,
  acntPrdtCd: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const adapter = createKISAdapter(appKey, appSecret);

  let accessToken: string;
  let expiresAt: Date;
  try {
    const t = await adapter.issueToken();
    accessToken = t.accessToken;
    expiresAt = t.expiresAt;
  } catch (err) {
    if (err instanceof KISAuthError) {
      throw new ApiError(401, `키 검증 실패: ${err.message}`, err.code);
    }
    throw new ApiError(500, "토큰 발급 실패", "TOKEN_FAILED");
  }

  try {
    await adapter.inquireBalance(accessToken, cano, acntPrdtCd);
  } catch (err) {
    if (err instanceof KISAuthError) {
      throw new ApiError(400, friendlyAuthMessage(err.code, err.message), err.code);
    }
    throw new ApiError(500, "잔고 조회 검증 실패", "VERIFY_FAILED");
  }

  return { accessToken, expiresAt };
}

export const POST = withValidation(CreateBody, async ({ user, body }) => {
  const db = getDb();

  const existing = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(
      and(
        eq(brokerageAccounts.userId, user.id),
        eq(brokerageAccounts.cano, body.cano),
        eq(brokerageAccounts.acntPrdtCd, body.acntPrdtCd)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    throw new ApiError(409, "이미 등록된 계좌입니다", "DUPLICATE_ACCOUNT");
  }

  const { accessToken, expiresAt } = await verifyKisCredentials(
    body.appKey,
    body.appSecret,
    body.cano,
    body.acntPrdtCd
  );

  const inserted = await db
    .insert(brokerageAccounts)
    .values({
      userId: user.id,
      label: body.label,
      broker: "kis",
      cano: body.cano,
      acntPrdtCd: body.acntPrdtCd,
      accountType: body.accountType,
      appKeyEnc: encryptSecret(body.appKey),
      appSecretEnc: encryptSecret(body.appSecret),
      accessToken,
      accessTokenExpiresAt: expiresAt,
      isActive: true,
      openedAt: body.openedAt ?? null,
    })
    .returning({ id: brokerageAccounts.id });

  const accountId = inserted[0].id;

  // Fire-and-forget initial sync
  const sync = createPortfolioSyncService(db);
  sync.syncAccount(accountId).catch(() => undefined);

  return NextResponse.json({
    id: accountId,
    label: body.label,
    cano: body.cano,
    acntPrdtCd: body.acntPrdtCd,
    accountType: body.accountType,
    appKeyMasked: maskSecret(body.appKey, 8),
  });
});
