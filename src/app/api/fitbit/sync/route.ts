import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createHealthSyncService } from "@/modules/health/service";

/** POST /api/fitbit/sync — manually trigger a Google Health (Fitbit) sync for the
 *  signed-in user (mirrors /api/portfolio/sync). Runs the incremental forward sync
 *  with no skip gate (so it always does work when triggered), then advances any
 *  historical backfill. Agent-native parity with the cron job. */
export const POST = withAuth(
  async ({ user }) => {
    const health = createHealthSyncService(getDb());
    const sync = await health.syncUser(user.id);
    const backfill = sync.skipped
      ? { skipped: true, samplesUpserted: 0 }
      : await health.backfillPendingConnections(user.id);
    return NextResponse.json({ sync, backfill });
  },
  { errorMessage: "동기화에 실패했습니다" }
);
