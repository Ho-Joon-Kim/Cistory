import { logger } from "@/lib/logger";
import { parseDateLocal, toLocalDateString } from "@/lib/utils";
import { matchSubwayTrips } from "./matcher";
import { groupMatchesIntoSessions } from "./session-grouper";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Iterate days [from..to] inclusive (YYYY-MM-DD) and re-run matcher + grouper
 * for the user. Used by the backfill API endpoint and the calibration script.
 */
export async function backfillSubwayMatches(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  daysProcessed: number;
  totalLegs: number;
  totalSessions: number;
}> {
  const start = DATE_ONLY.test(fromDate) ? parseDateLocal(fromDate) : null;
  const end = DATE_ONLY.test(toDate) ? parseDateLocal(toDate) : null;
  if (!start || !end) {
    throw new Error("Invalid date range");
  }
  if (start.getTime() > end.getTime()) {
    throw new Error("from must be <= to");
  }

  let daysProcessed = 0;
  let totalLegs = 0;
  let totalSessions = 0;

  for (
    const cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateStr = toLocalDateString(cursor);
    try {
      const matchResult = await matchSubwayTrips(userId, dateStr);
      const groupResult = await groupMatchesIntoSessions(userId, dateStr);
      daysProcessed++;
      totalLegs += matchResult.legsInserted;
      totalSessions += groupResult.sessions;
    } catch (err) {
      logger.error("subway backfill day failed", {
        userId,
        dateStr,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { daysProcessed, totalLegs, totalSessions };
}
