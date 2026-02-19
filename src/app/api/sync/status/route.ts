/**
 * Sync Status SSE API Route
 *
 * GET /api/sync/status - SSE 스트림으로 동기화 상태 전달
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb, type Database } from "@/db";
import { syncJobs } from "@/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const userId = user.id;

    // SSE 스트림 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;

        const sendEvent = (event: string, data: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            isClosed = true;
          }
        };

        const closeController = () => {
          if (isClosed) return;
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };

        // 초기 상태 전송
        try {
          const initialStatus = await getSyncStatus(db, userId);
          sendEvent("status", initialStatus);
        } catch (error) {
          console.error("Failed to get initial status:", error);
          sendEvent("error", { message: "Failed to get status" });
        }

        // 주기적으로 상태 업데이트 (5초마다)
        const interval = setInterval(async () => {
          if (isClosed) {
            clearInterval(interval);
            return;
          }

          try {
            const status = await getSyncStatus(db, userId);
            sendEvent("status", status);
          } catch (error) {
            console.error("Failed to get status:", error);
          }
        }, 5000);

        // 연결 종료 처리
        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          closeController();
        });

        // 30초 후 자동 종료 (클라이언트가 재연결하도록)
        setTimeout(() => {
          clearInterval(interval);
          sendEvent("reconnect", { message: "Please reconnect" });
          closeController();
        }, 30000);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("SSE error:", error);
    return new Response(JSON.stringify({ error: "SSE connection failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

interface SyncStatus {
  hasActiveSync: boolean;
  activeJobs: Array<{
    id: string;
    syncType: string;
    status: string;
    progress: number;
    totalCommits: number;
    processedCommits: number;
    startedAt: string | null;
  }>;
  recentCompleted: Array<{
    id: string;
    syncType: string;
    status: string;
    totalCommits: number;
    completedAt: string | null;
  }>;
  lastSyncTime: string | null;
}

async function getSyncStatus(
  db: Database,
  userId: string
): Promise<SyncStatus> {
  // 단일 쿼리로 active + recent completed 모두 조회 (connection 점유 최소화)
  const allJobs = await db
    .select({
      id: syncJobs.id,
      syncType: syncJobs.syncType,
      status: syncJobs.status,
      totalCommits: syncJobs.totalCommits,
      processedCommits: syncJobs.processedCommits,
      startedAt: syncJobs.startedAt,
      completedAt: syncJobs.completedAt,
    })
    .from(syncJobs)
    .where(
      and(
        eq(syncJobs.userId, userId),
        inArray(syncJobs.status, ["fetching", "summarizing", "completed", "failed"])
      )
    )
    .orderBy(desc(syncJobs.createdAt))
    .limit(10);

  const activeJobsResult = allJobs.filter(
    (j) => j.status === "fetching" || j.status === "summarizing"
  );
  const recentCompletedResult = allJobs
    .filter((j) => j.status === "completed" || j.status === "failed")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    .slice(0, 5);

  // 마지막 동기화 시간
  const lastSync = recentCompletedResult[0]?.completedAt || null;

  return {
    hasActiveSync: activeJobsResult.length > 0,
    activeJobs: activeJobsResult.map((job) => ({
      id: job.id,
      syncType: job.syncType,
      status: job.status ?? "unknown",
      progress:
        (job.totalCommits ?? 0) > 0
          ? Math.round(((job.processedCommits ?? 0) / (job.totalCommits ?? 1)) * 100)
          : 0,
      totalCommits: job.totalCommits ?? 0,
      processedCommits: job.processedCommits ?? 0,
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    })),
    recentCompleted: recentCompletedResult.map((job) => ({
      id: job.id,
      syncType: job.syncType,
      status: job.status ?? "unknown",
      totalCommits: job.totalCommits ?? 0,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    })),
    lastSyncTime: lastSync ? lastSync.toISOString() : null,
  };
}
