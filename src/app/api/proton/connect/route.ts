import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { checkSameOrigin } from "@/lib/api-auth";
import { ApiError, withAuth } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { ProtonConnectionService } from "@/modules/proton/connection";
import { PROTON_ERRORS } from "@/modules/proton/types";

/** POST /api/proton/connect — start a session fork; returns `{ signInUrl, expiresAt }`. */
export const POST = withAuth(async ({ user, request }) => {
  if (!checkSameOrigin(request).ok) {
    throw new ApiError(403, PROTON_ERRORS.invalidOrigin, "INVALID_ORIGIN");
  }
  try {
    return NextResponse.json(await new ProtonConnectionService(getDb()).startConnect(user.id));
  } catch (error) {
    // Never echo a Proton payload, not even into the log line withAuth would write.
    logger.error("[Proton] connect start failed", {
      userId: user.id,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new ApiError(502, PROTON_ERRORS.connectFailed, "PROTON_UNAVAILABLE");
  }
});
