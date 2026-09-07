import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  dataRecoveryJobs,
  healthConnections,
  periodNarratives,
  periodSnapshots,
  users,
  withingsConnections,
} from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { shiftDateKey } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { getPeriodKey } from "@/modules/overview/period";
import { validateStatusRange } from "./model";
import { serializeRecoveryJob } from "./service";
import { RECOVERABLE_SOURCES, type RecoverableSource } from "./types";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
export type RecoveryClaim = typeof dataRecoveryJobs.$inferSelect & { leaseToken: string };

export async function enqueueRecovery(
  db: Database,
  userId: string,
  source: string,
  from: string,
  to: string,
  now = new Date()
) {
  if (!RECOVERABLE_SOURCES.includes(source as RecoverableSource))
    throw new ApiError(400, "이 소스는 서버에서 기간 재수집을 지원하지 않습니다.");
  if (!validateStatusRange(from, to, now))
    throw new ApiError(400, "오늘까지 최대 31일의 유효한 기간을 선택해 주세요.");
  return db.transaction(async (tx) => {
    // Serialize enqueues for the same user/source, without a process-local lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recovery:${userId}:${source}`}, 0))`
    );
    const active = await tx
      .select()
      .from(dataRecoveryJobs)
      .where(
        and(
          eq(dataRecoveryJobs.userId, userId),
          eq(dataRecoveryJobs.source, source),
          or(eq(dataRecoveryJobs.status, "pending"), eq(dataRecoveryJobs.status, "running"))
        )
      )
      .limit(1);
    if (active[0])
      throw new ApiError(409, "이 소스의 재수집이 이미 진행 중입니다.", "RECOVERY_ACTIVE");
    let connected = false;
    if (source === "wakatime") {
      const [user] = await tx
        .select({ key: users.wakatimeApiKey })
        .from(users)
        .where(eq(users.id, userId));
      connected = !!user?.key;
    } else if (source === "withings") {
      const [row] = await tx
        .select({ status: withingsConnections.status })
        .from(withingsConnections)
        .where(eq(withingsConnections.userId, userId));
      connected = row?.status === "active";
    } else {
      const [row] = await tx
        .select({ status: healthConnections.status })
        .from(healthConnections)
        .where(eq(healthConnections.userId, userId));
      connected = row?.status === "active";
    }
    if (!connected) throw new ApiError(409, "먼저 이 소스를 연결하거나 재인증해 주세요.");
    const [job] = await tx
      .insert(dataRecoveryJobs)
      .values({
        userId,
        source,
        fromDate: from,
        toDate: to,
        nextDate: from,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return serializeRecoveryJob(job);
  });
}

type RecoveryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Also fence in-flight computations and revive exhausted retries after partial writes. */
async function invalidateRecoveredPeriods(
  tx: RecoveryTransaction,
  userId: string,
  fromDate: string,
  toDate: string,
  now: Date
) {
  const firstWeek = getPeriodKey("week", new Date(`${fromDate}T12:00:00+09:00`));
  const lastWeek = getPeriodKey("week", new Date(`${toDate}T12:00:00+09:00`));
  const affected = sql`(
        (period_type = 'recent' AND period_key BETWEEN ${fromDate} AND ${shiftDateKey(toDate, 13)}) OR
        (period_type = 'week' AND period_key BETWEEN ${firstWeek} AND ${lastWeek}) OR
        (period_type = 'month' AND period_key BETWEEN ${fromDate.slice(0, 7)} AND ${toDate.slice(0, 7)}) OR
        (period_type = 'year' AND period_key BETWEEN ${fromDate.slice(0, 4)} AND ${toDate.slice(0, 4)})
      )`;
  await tx
    .update(periodSnapshots)
    .set({
      status: "pending",
      computeStartedAt: null,
      attemptCount: 0,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(periodSnapshots.userId, userId), affected));
  await tx
    .update(periodNarratives)
    .set({
      status: "pending",
      generationStartedAt: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      content: null,
      updatedAt: now,
    })
    .where(and(eq(periodNarratives.userId, userId), affected));
}

export async function claimRecoveryDay(
  db: Database,
  now = new Date()
): Promise<RecoveryClaim | null> {
  return db.transaction(async (tx) => {
    const abandoned = await tx
      .update(dataRecoveryJobs)
      .set({
        status: "failed",
        error: "작업이 반복해서 중단되었습니다. 다시 요청해 주세요.",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(dataRecoveryJobs.status, "running"),
          lte(dataRecoveryJobs.leaseExpiresAt, now),
          gte(dataRecoveryJobs.attempts, MAX_ATTEMPTS)
        )
      )
      .returning();
    for (const job of abandoned) {
      await invalidateRecoveredPeriods(tx, job.userId, job.fromDate, job.nextDate, now);
    }
    const [job] = await tx
      .select()
      .from(dataRecoveryJobs)
      .where(
        and(
          lt(dataRecoveryJobs.attempts, MAX_ATTEMPTS),
          or(
            eq(dataRecoveryJobs.status, "pending"),
            and(eq(dataRecoveryJobs.status, "running"), lte(dataRecoveryJobs.leaseExpiresAt, now))
          )
        )
      )
      .orderBy(asc(dataRecoveryJobs.updatedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(dataRecoveryJobs)
      .set({
        status: "running",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: job.attempts + 1,
        updatedAt: now,
      })
      .where(eq(dataRecoveryJobs.id, job.id))
      .returning();
    return { ...claimed, leaseToken };
  });
}

function claimIdentity(claim: RecoveryClaim) {
  return and(
    eq(dataRecoveryJobs.id, claim.id),
    eq(dataRecoveryJobs.userId, claim.userId),
    eq(dataRecoveryJobs.status, "running"),
    eq(dataRecoveryJobs.leaseToken, claim.leaseToken)
  );
}

export async function finishRecoveryDay(
  db: Database,
  claim: RecoveryClaim,
  error: string | null,
  now = new Date()
): Promise<boolean> {
  const nextDate = error ? claim.nextDate : shiftDateKey(claim.nextDate, 1);
  const completed = !error && nextDate > claim.toDate;
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(dataRecoveryJobs)
      .set({
        nextDate,
        status: error ? "failed" : completed ? "completed" : "pending",
        attempts: error ? claim.attempts : 0,
        leaseToken: null,
        leaseExpiresAt: null,
        error,
        updatedAt: now,
        completedAt: completed ? now : null,
      })
      .where(claimIdentity(claim))
      .returning({ id: dataRecoveryJobs.id });
    if (!changed.length) return false;
    if (completed || error) {
      await invalidateRecoveredPeriods(tx, claim.userId, claim.fromDate, claim.nextDate, now);
    }
    return true;
  });
}

async function defaultRecover(db: Database, claim: RecoveryClaim): Promise<void> {
  if (claim.source === "wakatime") {
    const [user] = await db
      .select({ key: users.wakatimeApiKey })
      .from(users)
      .where(eq(users.id, claim.userId));
    if (!user?.key) throw new Error("Source disconnected");
    const { createWakaTimeSyncService } = await import("@/modules/wakatime/service");
    await createWakaTimeSyncService(db, user.key).recoverDay(claim.userId, claim.nextDate);
  } else if (claim.source === "withings") {
    const { createWithingsSyncService } = await import("@/modules/withings/service");
    await createWithingsSyncService(db).recoverDay(claim.userId, claim.nextDate);
  } else if (claim.source === "health") {
    const { createHealthSyncService } = await import("@/modules/health/service");
    await createHealthSyncService(db).recoverDay(claim.userId, claim.nextDate);
  } else throw new Error("Unsupported source");
}

/** Process bounded work; durable cursor survives a cron/web restart. */
export async function processRecoveryQueue(
  db: Database,
  recover: (claim: RecoveryClaim) => Promise<void> = (claim) => defaultRecover(db, claim),
  maxDays = 3
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxDays; i++) {
    const claim = await claimRecoveryDay(db);
    if (!claim) break;
    let lost = false;
    let heartbeat: Promise<void> = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat
        .then(async () => {
          const changed = await db
            .update(dataRecoveryJobs)
            .set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
            .where(claimIdentity(claim))
            .returning({ id: dataRecoveryJobs.id });
          if (!changed.length) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, 30_000);
    timer.unref?.();
    let error: string | null = null;
    try {
      await recover(claim);
    } catch {
      error =
        "해당 날짜를 다시 가져오지 못했습니다. 제공자의 보관 기간과 연동 상태를 확인한 뒤 다시 요청해 주세요.";
      logger.warn("[Recovery] source/day failed", { jobId: claim.id, source: claim.source });
    } finally {
      clearInterval(timer);
      await heartbeat;
    }
    if (!lost && (await finishRecoveryDay(db, claim, error))) processed++;
  }
  return processed;
}
