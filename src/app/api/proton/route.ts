import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { checkSameOrigin } from "@/lib/api-auth";
import { ApiError, withAuth } from "@/lib/api-handler";
import { ProtonConnectionService } from "@/modules/proton/connection";
import { getProtonSummary } from "@/modules/proton/summary";
import { PROTON_ERRORS } from "@/modules/proton/types";

/** GET /api/proton — connection card summary (counts only exposed photos). */
export const GET = withAuth(
  async ({ user }) => NextResponse.json(await getProtonSummary(getDb(), user.id)),
  { errorMessage: PROTON_ERRORS.summaryFailed }
);

/**
 * DELETE /api/proton — delete the connection and the photo library, then
 * best-effort sign the Proton session out. An unconfirmed sign-out still
 * succeeds, with a fixed notice telling the user to remove the session by hand.
 */
export const DELETE = withAuth(
  async ({ user, request }) => {
    if (!checkSameOrigin(request).ok) {
      throw new ApiError(403, PROTON_ERRORS.invalidOrigin, "INVALID_ORIGIN");
    }
    const { revoked } = await new ProtonConnectionService(getDb()).disconnect(user.id);
    return NextResponse.json(
      revoked
        ? { success: true, revoked }
        : { success: true, revoked, notice: PROTON_ERRORS.revokeFailed }
    );
  },
  { errorMessage: PROTON_ERRORS.disconnectFailed }
);
