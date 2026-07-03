/**
 * Sync Jobs History API Route
 *
 * GET /api/sync/jobs - 동기화 작업 이력 조회
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { syncJobs } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const status = searchParams.get("status"); // completed, failed, all
    const syncType = searchParams.get("syncType"); // events, search, initial
    const days = parseInt(searchParams.get("days") || "7", 10); // 기본 7일

    // 기간 필터
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);

    // 쿼리 조건 구성
    const conditions = [eq(syncJobs.userId, user.id), gte(syncJobs.createdAt, daysAgo)];

    const validStatuses = ["completed", "failed", "fetching", "summarizing"] as const;
    if (status && status !== "all") {
      if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}, all` },
          { status: 400 }
        );
      }
      conditions.push(eq(syncJobs.status, status as (typeof validStatuses)[number]));
    }

    if (syncType) {
      conditions.push(eq(syncJobs.syncType, syncType));
    }

    // 작업 목록 조회
    const jobs = await db
      .select({
        id: syncJobs.id,
        syncType: syncJobs.syncType,
        status: syncJobs.status,
        triggerType: syncJobs.triggerType,
        totalCommits: syncJobs.totalCommits,
        processedCommits: syncJobs.processedCommits,
        errorMessage: syncJobs.errorMessage,
        startedAt: syncJobs.startedAt,
        completedAt: syncJobs.completedAt,
        createdAt: syncJobs.createdAt,
      })
      .from(syncJobs)
      .where(and(...conditions))
      .orderBy(desc(syncJobs.createdAt))
      .limit(limit)
      .offset(offset);

    // 총 개수 조회
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncJobs)
      .where(and(...conditions));

    const total = countResult[0]?.count || 0;

    // 통계 계산
    const statsResult = await db
      .select({
        status: syncJobs.status,
        count: sql<number>`count(*)`,
        totalCommits: sql<number>`sum(${syncJobs.totalCommits})`,
      })
      .from(syncJobs)
      .where(and(eq(syncJobs.userId, user.id), gte(syncJobs.createdAt, daysAgo)))
      .groupBy(syncJobs.status);

    const stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      totalCommitsSynced: 0,
    };

    for (const row of statsResult) {
      stats.total += Number(row.count);
      if (row.status === "completed") {
        stats.completed = Number(row.count);
        stats.totalCommitsSynced = Number(row.totalCommits) || 0;
      } else if (row.status === "failed") {
        stats.failed = Number(row.count);
      } else if (row.status === "fetching" || row.status === "summarizing") {
        stats.inProgress += Number(row.count);
      }
    }

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        ...job,
        duration:
          job.startedAt && job.completedAt
            ? Math.round(
                (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
              )
            : null,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + jobs.length < total,
      },
      stats,
      period: {
        days,
        since: daysAgo.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Get sync jobs error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "동기화 기록 조회에 실패했습니다" }, { status: 500 });
  }
}
