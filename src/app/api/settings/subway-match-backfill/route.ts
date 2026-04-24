/**
 * POST /api/settings/subway-match-backfill
 *
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 * Re-runs the subway matcher + session grouper for each day in the range
 * for the authenticated user. Returns a JSON summary.
 *
 * Used after weight calibration (`config.ts` updates) to relabel historical
 * matches with the tuned weights.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { from, to } = (body ?? {}) as { from?: unknown; to?: unknown };
  if (typeof from !== "string" || typeof to !== "string" || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from/to required, format YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (fromDate.getTime() > toDate.getTime()) {
    return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  }
  const dayCount = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `range too large (max ${MAX_RANGE_DAYS} days)` },
      { status: 400 }
    );
  }

  try {
    const { backfillSubwayMatches } = await import(
      "@/modules/location/services/subway-match/backfill"
    );
    const summary = await backfillSubwayMatches(user.id, from, to);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("subway-match-backfill failed:", err);
    return NextResponse.json(
      { error: "subway match backfill failed" },
      { status: 500 }
    );
  }
}
