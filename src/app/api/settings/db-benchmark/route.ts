/**
 * DB Benchmark API Route
 *
 * POST /api/settings/db-benchmark - 벤치마크 실행 후 결과 응답
 */

import { count, desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { commitSummaries, commits, getDb, syncJobs } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

interface BenchmarkStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  p95: number;
}

interface BenchmarkResult {
  name: string;
  label: string;
  runs: number[];
  stats: BenchmarkStats;
}

const ITERATIONS = 11; // 1 warm-up + 10 measured

function calcStats(runs: number[]): BenchmarkStats {
  const sorted = [...runs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95Index = Math.ceil(n * 0.95) - 1;

  return {
    mean: Math.round((sum / n) * 100) / 100,
    median: sorted[Math.floor(n / 2)],
    min: sorted[0],
    max: sorted[n - 1],
    p95: sorted[Math.min(p95Index, n - 1)],
  };
}

async function measure(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round((performance.now() - start) * 100) / 100;
}

function extractDbHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return "unknown";
  }
}

export async function POST(request: NextRequest) {
  try {
    // Feature flag: the benchmark runs 6 query classes × 11 iterations = 66 DB
    // round-trips per call, and previously could be spammed by any authenticated
    // user. Gate behind an explicit env var so production deployments stay safe
    // while local/admin envs can still run it on demand.
    if (process.env.ENABLE_DB_BENCHMARK !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const userId = user.id;
    const dbHost = extractDbHost(process.env.DATABASE_URL ?? "");

    const benchmarks: BenchmarkResult[] = [];

    // 1. Connection (SELECT 1)
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db.execute(sql`SELECT 1`);
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1); // drop warm-up
      benchmarks.push({ name: "connection", label: "Connection", runs, stats: calcStats(runs) });
    }

    // 2. Simple Read (최근 커밋 10건)
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db
            .select()
            .from(commits)
            .where(eq(commits.userId, userId))
            .orderBy(desc(commits.committedAt))
            .limit(10);
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1);
      benchmarks.push({ name: "simpleRead", label: "단순 읽기", runs, stats: calcStats(runs) });
    }

    // 3. Count Aggregation
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db.select({ count: count() }).from(commits).where(eq(commits.userId, userId));
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1);
      benchmarks.push({
        name: "countAggregation",
        label: "COUNT 집계",
        runs,
        stats: calcStats(runs),
      });
    }

    // 4. Join Query (commits + summaries, 10건)
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db
            .select({
              sha: commits.sha,
              message: commits.message,
              summary: commitSummaries.summary,
              status: commitSummaries.status,
            })
            .from(commits)
            .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
            .where(eq(commits.userId, userId))
            .orderBy(desc(commits.committedAt))
            .limit(10);
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1);
      benchmarks.push({ name: "joinQuery", label: "JOIN 쿼리", runs, stats: calcStats(runs) });
    }

    // 5. Complex Aggregation (월간 커밋 통계 GROUP BY)
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db
            .select({
              date: sql<string>`DATE(${commits.committedAt})`,
              count: count(),
              additions: sql<number>`COALESCE(SUM(${commits.additions}), 0)`,
              deletions: sql<number>`COALESCE(SUM(${commits.deletions}), 0)`,
            })
            .from(commits)
            .where(eq(commits.userId, userId))
            .groupBy(sql`DATE(${commits.committedAt})`)
            .orderBy(desc(sql`DATE(${commits.committedAt})`))
            .limit(30);
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1);
      benchmarks.push({
        name: "complexAggregation",
        label: "복합 집계",
        runs,
        stats: calcStats(runs),
      });
    }

    // 6. Write + Delete (트랜잭션으로 안전하게)
    {
      const allRuns: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const ms = await measure(async () => {
          await db.transaction(async (tx) => {
            const testId = `__benchmark_test_${Date.now()}_${i}`;
            await tx.insert(syncJobs).values({
              id: testId,
              userId,
              syncType: "events",
              status: "pending",
              triggerType: "manual",
              createdAt: new Date(),
            });
            await tx.delete(syncJobs).where(eq(syncJobs.id, testId));
          });
        });
        allRuns.push(ms);
      }
      const runs = allRuns.slice(1);
      benchmarks.push({ name: "writeDelete", label: "쓰기/삭제", runs, stats: calcStats(runs) });
    }

    return NextResponse.json({
      dbHost,
      timestamp: new Date().toISOString(),
      benchmarks,
    });
  } catch (error) {
    console.error("DB benchmark error:", error);
    return NextResponse.json({ error: "벤치마크 실행에 실패했습니다" }, { status: 500 });
  }
}
