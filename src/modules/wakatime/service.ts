/**
 * WakaTime Sync Service
 *
 * Syncs coding session durations and daily summaries from WakaTime.
 */

import type { Database } from "@/db";
import { codingSessions, codingDailyStats, users } from "@/db/schema";
import { createWakaTimeAdapter } from "@/lib/adapters/wakatime/wakatime";
import type { WakaTimeAdapter } from "@/lib/adapters/wakatime/interface";
import { eq, and } from "drizzle-orm";
import { logger } from "@/lib/logger";

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

    const now = new Date();
    let inserted = 0;

    for (const d of durations) {
      const result = await this.db
        .insert(codingSessions)
        .values({
          userId,
          project: d.project,
          startedAt: new Date(d.time * 1000),
          durationSeconds: Math.round(d.duration),
          humanAdditions: d.humanAdditions,
          humanDeletions: d.humanDeletions,
          aiAdditions: d.aiAdditions,
          aiDeletions: d.aiDeletions,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [codingSessions.userId, codingSessions.startedAt, codingSessions.project],
        })
        .returning({ id: codingSessions.id });

      if (result.length > 0) inserted++;
    }

    return inserted;
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
          totalSeconds: s.grandTotalSeconds,
          projects: JSON.stringify(s.projects),
          languages: JSON.stringify(s.languages),
          editors: JSON.stringify(s.editors),
          categories: JSON.stringify(s.categories),
          calculatedAt: now,
        })
        .onConflictDoUpdate({
          target: [codingDailyStats.userId, codingDailyStats.date],
          set: {
            totalSeconds: s.grandTotalSeconds,
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

  async syncUser(userId: string): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);

    // Sync durations for yesterday and today
    const insertedYesterday = await this.syncDurations(userId, dateStr);
    const insertedToday = await this.syncDurations(userId, today);

    // Sync summaries for yesterday and today
    const summaryCount = await this.syncSummaries(userId, dateStr, today);

    logger.info("[WakaTime] Sync completed", {
      userId,
      durationsInserted: insertedYesterday + insertedToday,
      summariesUpserted: summaryCount,
    });

    // Update last synced timestamp
    await this.db
      .update(users)
      .set({ wakatimeLastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async verifyApiKey(): Promise<boolean> {
    return this.adapter.verifyApiKey();
  }

  async getCurrentUser() {
    return this.adapter.getCurrentUser();
  }
}

export function createWakaTimeSyncService(db: Database, apiKey: string): WakaTimeSyncService {
  return new WakaTimeSyncService(db, apiKey);
}
