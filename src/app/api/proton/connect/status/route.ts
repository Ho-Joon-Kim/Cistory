import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ApiError, withAuth } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { ProtonConnectionService } from "@/modules/proton/connection";
import { PROTON_ERRORS } from "@/modules/proton/types";

/** GET /api/proton/connect/status — polls the pending fork once per call. */
export const GET = withAuth(async ({ user }) => {
  try {
    return NextResponse.json(await new ProtonConnectionService(getDb()).checkConnect(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    logger.error("[Proton] connect status failed", {
      userId: user.id,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new ApiError(502, PROTON_ERRORS.connectFailed, "PROTON_UNAVAILABLE");
  }
});
