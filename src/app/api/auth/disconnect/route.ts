import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { deleteAccount } from "@/lib/account-deletion";
import { checkSameOrigin } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { ProtonConnectionService } from "@/modules/proton/connection";
import { PROTON_ERRORS } from "@/modules/proton/types";

const DELETED_MESSAGE = "GitHub 연결이 해제되고 모든 데이터가 삭제되었습니다.";

export async function DELETE(request: NextRequest) {
  try {
    // CSRF hardening: this endpoint wipes the account and all data. SameSite
    // cookies help, but a cross-origin fetch from a compromised page could
    // still reach here in some browser configs. Reject mismatched Origin.
    const origin = checkSameOrigin(request);
    if (!origin.ok) {
      logger.warn("[auth/disconnect] rejected: cross-origin request", {
        reason: origin.reason,
      });
      return NextResponse.json(
        { error: "허용되지 않은 요청입니다. 이 앱 화면에서 다시 시도해 주세요." },
        { status: 403 }
      );
    }

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Best-effort sign-out of the Proton session. Network, so it runs before
    // (never inside) the deletion transaction; the tokens are read first because
    // the cascade removes them. A failure never blocks deleting the account.
    let protonRevoked = true;
    try {
      protonRevoked = await new ProtonConnectionService(db).revokeOnly(user.id);
    } catch (error) {
      protonRevoked = false;
      logger.warn("[auth/disconnect] Proton revoke failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }

    await deleteAccount(db, user.id);

    const signOut = await auth.api.signOut({
      headers: await headers(),
      returnHeaders: true,
    });

    const response = NextResponse.json({
      success: true,
      message: protonRevoked ? DELETED_MESSAGE : `${DELETED_MESSAGE} ${PROTON_ERRORS.revokeFailed}`,
    });
    // Forward Better Auth's expirations (token, cached session and chunks),
    // including the configured secure prefix/path/domain attributes.
    for (const cookie of signOut.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  } catch (error) {
    logger.error("Disconnect error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "계정 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
