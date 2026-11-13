/**
 * GET /api/timeline/current-activity
 *
 * Returns a hint about the user's most recent subway activity, intended for
 * "now riding 2호선" badge UX. Strategy:
 *   - Look up the most recent subway_trip_match where sub_end_time is within
 *     the last 60 min (configurable via ?windowMinutes=).
 *   - If found, return line + start/end station and how long ago it ended.
 *   - Otherwise return { active: false }.
 *
 * Note: the matcher runs daily at 01:00 KST, so this endpoint is only as fresh
 * as the last batch run. Real-time inference (running matcher on the fly over
 * the last 10 minutes of location_points each request) is future work — see
 * the plan's "Realtime hint (후속 PR)" section.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getLatestSubwayRide } from "@/modules/location/queries";

const DEFAULT_WINDOW_MIN = 60;
const MAX_WINDOW_MIN = 720; // 12h cap so we don't accidentally return something stale

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  const url = new URL(request.url);
  let windowMinutes = Number(url.searchParams.get("windowMinutes") ?? DEFAULT_WINDOW_MIN);
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    windowMinutes = DEFAULT_WINDOW_MIN;
  }
  windowMinutes = Math.min(windowMinutes, MAX_WINDOW_MIN);

  const since = new Date(Date.now() - windowMinutes * 60_000);
  const ride = await getLatestSubwayRide(user.id, { since });
  if (!ride) {
    return NextResponse.json(
      { active: false, windowMinutes },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  }

  const minutesAgo = Math.max(0, Math.round((Date.now() - ride.subEndTime.getTime()) / 60_000));

  return NextResponse.json(
    {
      active: true,
      minutesAgo,
      windowMinutes,
      line: ride.line,
      startStationName: ride.startStationName,
      endStationName: ride.endStationName,
      subStartTime: ride.subStartTime.toISOString(),
      subEndTime: ride.subEndTime.toISOString(),
      totalConfidence: ride.totalConfidence,
    },
    {
      // Short cache — this endpoint is meant to be polled.
      headers: { "Cache-Control": "private, max-age=30" },
    }
  );
}
