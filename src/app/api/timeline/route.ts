import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { parseDateLocal, parseDateLocalEnd } from "@/lib/utils";
import { listCommits } from "@/modules/timeline/work-queries";

/** One busy day fits in a single page, so the dashboard never chains requests. */
const MAX_PER_PAGE = 200;

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    // Query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const perPage = Math.min(parseInt(searchParams.get("per_page") ?? "20", 10), MAX_PER_PAGE);
    const reposParam = searchParams.get("repos"); // Filter by multiple repos (comma-separated)
    const afterDate = searchParams.get("after");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const repos = reposParam ? reposParam.split(",").filter(Boolean) : [];
    let after: Date | null = null;
    let from: Date | null = null;
    let to: Date | null = null;

    if (afterDate) {
      const parsed = parseDateLocal(afterDate);
      if (!parsed) {
        return NextResponse.json(
          { error: "'after' 날짜 형식이 유효하지 않습니다" },
          { status: 400 }
        );
      }
      after = parsed;
    }

    if (fromDate) {
      const parsed = parseDateLocal(fromDate);
      if (!parsed) {
        return NextResponse.json(
          { error: "'from' 날짜 형식이 유효하지 않습니다" },
          { status: 400 }
        );
      }
      from = parsed;
    }

    if (toDate) {
      const parsed = parseDateLocalEnd(toDate);
      if (!parsed) {
        return NextResponse.json({ error: "'to' 날짜 형식이 유효하지 않습니다" }, { status: 400 });
      }
      // Include the entire "to" day (date-only → end of that local day)
      to = parsed;
    }

    const result = await listCommits(user.id, { page, perPage, repos, after, from, to });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Get timeline error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "타임라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
