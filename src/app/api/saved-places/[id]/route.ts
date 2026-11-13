import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  deleteSavedPlace,
  parseSavedPlaceUpdate,
  updateSavedPlace,
} from "@/modules/location/saved-places";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseSavedPlaceUpdate(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const place = await updateSavedPlace(user.id, id, parsed.value);

    if (!place) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ place });
  } catch (error) {
    logger.error("Saved places PUT error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "장소를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const deleted = await deleteSavedPlace(user.id, id);

    if (!deleted) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Saved places DELETE error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "장소를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
