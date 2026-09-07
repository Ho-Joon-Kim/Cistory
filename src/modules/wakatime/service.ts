/**
 * WakaTime Sync Service
 *
 * Syncs coding session durations and daily summaries from WakaTime.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { codingDailyStats, codingSessions, commits, users } from "@/db/schema";
import { createWakaTimeAdapter, type WakaTimeAdapter } from "@/lib/adapters/wakatime/wakatime";
import { ApiError } from "@/lib/api-handler";
import { dateKeyToUtcMillis } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { sleep, toLocalDateString } from "@/lib/utils";
import { trackSourceSync } from "@/modules/data-status/telemetry";

export class WakaTimeSyncService {
  private db: Database;
  private adapter: WakaTimeAdapter;

  constructor(db: Database, apiKey: string) {
    this.db = db;
    this.adapter = createWakaTimeAdapter(apiKey);
  }

  async syncDurations(userId: string, date: string): Promise<number> {
    const durations = await this.adapter.getDurations(date);

    if (durations.length === 0) return 0;

    // Batch insert — one round-trip per day instead of N per-duration inserts.
    // Durations keep growing while coding; refresh mutable fields on the stable identity.
    const now = new Date();
    const rows = durations.map((d) => ({
      userId,
      project: d.project,
      startedAt: new Date(d.time * 1000),
      durationSeconds: Math.round(d.duration),
      humanAdditions: d.humanAdditions,
      humanDeletions: d.humanDeletions,
      aiAdditions: d.aiAdditions,
      aiDeletions: d.aiDeletions,
      createdAt: now,
    }));

    const result = await this.db
      .insert(codingSessions)
      .values(rows)
      .onConflictDoUpdate({
        target: [codingSessions.userId, codingSessions.startedAt, codingSessions.project],
        set: {
          durationSeconds: sql`excluded.duration_seconds`,
          humanAdditions: sql`excluded.human_additions`,
          humanDeletions: sql`excluded.human_deletions`,
          aiAdditions: sql`excluded.ai_additions`,
          aiDeletions: sql`excluded.ai_deletions`,
        },
      })
      .returning({ id: codingSessions.id });

    return result.length;
  }

  async syncSummaries(userId: string, start: string, end: string): Promise<number> {
    const summaries = await this.adapter.getSummaries(start, end);

    if (summaries.length === 0) return 0;

    const now = new Date();
    let upserted = 0;

    for (const s of summaries) {
      await this.db
        .insert(codingDailyStats)
        .values({
          userId,
          date: s.date,
          totalSeconds: Math.round(s.grandTotalSeconds),
          projects: JSON.stringify(s.projects),
          languages: JSON.stringify(s.languages),
          editors: JSON.stringify(s.editors),
          categories: JSON.stringify(s.categories),
          calculatedAt: now,
        })
        .onConflictDoUpdate({
          target: [codingDailyStats.userId, codingDailyStats.date],
          set: {
            totalSeconds: Math.round(s.grandTotalSeconds),
            projects: JSON.stringify(s.projects),
            languages: JSON.stringify(s.languages),
            editors: JSON.stringify(s.editors),
            categories: JSON.stringify(s.categories),
            calculatedAt: now,
          },
        });
      upserted++;
    }

    return upserted;
  }

  async recoverDay(userId: string, date: string): Promise<number> {
    if (dateKeyToUtcMillis(date) === null) throw new ApiError(400, "올바른 날짜가 아닙니다");
    const rows = await this.db
      .select({ apiKey: users.wakatimeApiKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!rows[0]?.apiKey) throw new ApiError(409, "WakaTime 연동이 필요합니다");
    const sessions = await this.syncDurations(userId, date);
    await this.syncSummaries(userId, date, date);
    return sessions;
  }

  async syncUser(userId: string) {
    return trackSourceSync(this.db, userId, "wakatime", () => this.runUserSync(userId));
  }

  private async runUserSync(
    userId: string
  ): Promise<{ syncedDays: number; totalSessions: number; totalSummaries: number }> {
    // Catch-up window: from wakatime_last_synced_at (minus 1 day overlap) to today.
    // Falls back to 7 days if never synced — initial bulk sync goes via syncAllCommitDates.
    // The overlap day re-fetches yesterday's data so late-arriving heartbeats are picked up.
    const userRow = await this.db
      .select({ lastSyncedAt: users.wakatimeLastSyncedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const lastSyncedAt = userRow[0]?.lastSyncedAt;
    const today = new Date();
    const startDate = new Date(today);
    if (lastSyncedAt) {
      startDate.setTime(lastSyncedAt.getTime());
      startDate.setDate(startDate.getDate() - 1);
    } else {
      startDate.setDate(today.getDate() - 7);
    }

    // Build the list of dates [start..today] inclusive.
    const dates: string[] = [];
    const cursor = new Date(startDate);
    while (cursor <= today) {
      dates.push(toLocalDateString(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    let totalSessions = 0;
    for (const date of dates) {
      totalSessions += await this.syncDurations(userId, date);
    }

    const totalSummaries = await this.syncSummaries(userId, dates[0], dates[dates.length - 1]);

    logger.info("[WakaTime] Sync completed", {
      userId,
      windowStart: dates[0],
      windowEnd: dates[dates.length - 1],
      syncedDays: dates.length,
      durationsInserted: totalSessions,
      summariesUpserted: totalSummaries,
    });

    await this.db
      .update(users)
      .set({ wakatimeLastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { syncedDays: dates.length, totalSessions, totalSummaries };
  }

  async syncAllCommitDates(
    userId: string
  ): Promise<{ syncedDays: number; totalSessions: number; totalSummaries: number }> {
    // Get distinct commit dates for user
    const commitDates = await this.db
      .selectDistinct({
        date: sql<string>`date(${commits.committedAt})`.as("date"),
      })
      .from(commits)
      .where(eq(commits.userId, userId));

    const allDates = commitDates.map((r) => r.date).filter(Boolean);

    if (allDates.length === 0) {
      return { syncedDays: 0, totalSessions: 0, totalSummaries: 0 };
    }

    // Get dates already in coding_daily_stats
    const existingDates = await this.db
      .select({ date: codingDailyStats.date })
      .from(codingDailyStats)
      .where(eq(codingDailyStats.userId, userId));

    const existingSet = new Set(existingDates.map((r) => r.date));
    const unsyncedDates = allDates.filter((d) => !existingSet.has(d));

    if (unsyncedDates.length === 0) {
      return { syncedDays: 0, totalSessions: 0, totalSummaries: 0 };
    }

    logger.info("[WakaTime] Starting initial sync", {
      userId,
      totalDates: unsyncedDates.length,
    });

    let totalSessions = 0;
    let totalSummaries = 0;
    let syncedDays = 0;

    for (const date of unsyncedDates) {
      try {
        const sessions = await this.syncDurations(userId, date);
        const summaries = await this.syncSummaries(userId, date, date);
        totalSessions += sessions;
        totalSummaries += summaries;
        syncedDays++;
      } catch (error) {
        logger.warn("[WakaTime] Failed to sync date", {
          userId,
          date,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Rate limit: 200ms between dates
      await sleep(200);
    }

    // Update last synced timestamp
    await this.db
      .update(users)
      .set({ wakatimeLastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));

    logger.info("[WakaTime] Initial sync completed", {
      userId,
      syncedDays,
      totalSessions,
      totalSummaries,
    });

    return { syncedDays, totalSessions, totalSummaries };
  }
}

export function createWakaTimeSyncService(db: Database, apiKey: string): WakaTimeSyncService {
  return new WakaTimeSyncService(db, apiKey);
}
