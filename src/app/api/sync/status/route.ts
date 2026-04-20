/**
 * Sync Status SSE API Route
 *
 * GET /api/sync/status - SSE 스트림으로 동기화 상태 전달
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { type Database, getDb } from "@/db";
import { syncJobs } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

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

        // P11: adaptive polling interval. When a sync is actively running we
        // need 5s updates for the progress UI; when idle we'd be burning one
        // DB query every 5 seconds with no UI change. Switch to 30s when no
        // active job is observed. Connection still recycles every 30s so the
        // client can reconnect and pick up a freshly-started sync.
        let pollMs = 5000;
        let lastHadActive = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const tick = async () => {
          if (isClosed) return;
          try {
            const status = await getSyncStatus(db, userId);
            sendEvent("status", status);
            const hasActive = status.hasActiveSync;
            // If we *just* finished a sync, stay on the fast cadence for one
            // more tick so the UI gets the "completed" event quickly.
            pollMs = hasActive ? 5000 : lastHadActive ? 5000 : 30000;
            lastHadActive = hasActive;
          } catch (error) {
            console.error("Failed to get status:", error);
          }
          if (!isClosed) timer = setTimeout(tick, pollMs);
        };

        // Initial send + kick off the loop
        tick();

        // 연결 종료 처리
        request.signal.addEventListener("abort", () => {
          if (timer) clearTimeout(timer);
          closeController();
        });

        // 30초 후 자동 종료 (클라이언트가 재연결)
        setTimeout(() => {
          if (timer) clearTimeout(timer);
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

async function getSyncStatus(db: Database, userId: string): Promise<SyncStatus> {
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
