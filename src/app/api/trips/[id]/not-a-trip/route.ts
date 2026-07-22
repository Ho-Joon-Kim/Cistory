import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  markTripNotATrip,
  TripHasNoVisitsError,
  TripNotFoundError,
} from "@/modules/travel/not-a-trip";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    return NextResponse.json(await markTripNotATrip(user.id, id));
  } catch (error) {
    if (error instanceof TripNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TripHasNoVisitsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error("Trip not-a-trip POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 제외 처리에 실패했습니다" }, { status: 500 });
  }
}
