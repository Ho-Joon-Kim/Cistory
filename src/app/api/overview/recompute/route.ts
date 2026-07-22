import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { checkSameOrigin } from "@/lib/api-auth";
import { ApiError, withValidation } from "@/lib/api-handler";
import { createDatabaseOverviewStore, createOverviewService } from "@/modules/overview/service";

const RecomputeBody = z.object({
  periodType: z.string(),
  periodKey: z.string(),
});

export const POST = withValidation(RecomputeBody, async ({ user, request, body }) => {
  const origin = checkSameOrigin(request);
  if (!origin.ok) {
    throw new ApiError(403, "허용되지 않은 요청입니다", "INVALID_ORIGIN");
  }

  const service = createOverviewService(createDatabaseOverviewStore(getDb()));
  const response = await service.requestRecompute(user.id, body.periodType, body.periodKey);
  return NextResponse.json(response, { status: 202 });
});
