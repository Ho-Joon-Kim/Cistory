import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  createSavedPlace,
  listSavedPlaces,
  parseSavedPlaceCreate,
} from "@/modules/location/saved-places";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    return NextResponse.json({ places: await listSavedPlaces(user.id) });
  } catch (error) {
    logger.error("Saved places GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "저장된 장소를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const parsed = parseSavedPlaceCreate(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const place = await createSavedPlace(user.id, parsed.value);

    return NextResponse.json({ place }, { status: 201 });
  } catch (error) {
    logger.error("Saved places POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "장소를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
