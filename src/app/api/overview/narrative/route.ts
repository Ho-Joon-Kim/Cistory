import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { checkSameOrigin } from "@/lib/api-auth";
import { ApiError, withAuth, withValidation } from "@/lib/api-handler";
import { createDatabaseNarrativeStore, createNarrativeService } from "@/modules/overview/narrative";

const NarrativeBody = z.object({
  periodType: z.string(),
  periodKey: z.string(),
});

export const GET = withAuth(async ({ user, request }) => {
  const periodType = request.nextUrl.searchParams.get("periodType") ?? "";
  const periodKey = request.nextUrl.searchParams.get("periodKey") ?? "";
  const service = createNarrativeService(createDatabaseNarrativeStore(getDb()), null);
  return NextResponse.json(await service.get(user.id, periodType, periodKey));
});

export const POST = withValidation(NarrativeBody, async ({ user, request, body }) => {
  const origin = checkSameOrigin(request);
  if (!origin.ok) {
    throw new ApiError(403, "허용되지 않은 요청입니다", "INVALID_ORIGIN");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ApiError(503, "회고문 생성이 설정되지 않았습니다", "AI_NOT_CONFIGURED");
  const service = createNarrativeService(
    createDatabaseNarrativeStore(getDb()),
    createClaudeAdapter(apiKey)
  );
  return NextResponse.json(await service.regenerate(user.id, body.periodType, body.periodKey), {
    status: 200,
  });
});
