/**
 * GET /api/reports/subway-usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns subway-usage aggregates (sessions, transfers, top lines/stations)
 * for the authenticated user over the given date range.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getSubwayUsage } from "@/modules/location/services/subway-match/usage";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDate(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from/to required (YYYY-MM-DD)" }, { status: 400 });
  }
  const from = parseLocalDate(fromStr);
  const to = parseLocalDate(toStr);
  if (!from || !to) {
    return NextResponse.json({ error: "invalid date format" }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  }
  // Make `to` exclusive by adding one day so the day itself is included.
  const toExclusive = new Date(to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  try {
    const usage = await getSubwayUsage(user.id, from, toExclusive);
    return NextResponse.json(usage, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("subway-usage error:", err);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
