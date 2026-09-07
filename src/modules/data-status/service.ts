import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  bodyMeasurements,
  brokerageAccounts,
  codingSessions,
  commits,
  dataRecoveryJobs,
  healthConnections,
  healthSamples,
  holdingSnapshots,
  locationPoints,
  notificationLogs,
  sourceSyncStates,
  syncJobs,
  users,
  withingsConnections,
} from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { ApiError } from "@/lib/api-handler";
import { getKstDateWindow } from "@/lib/date-key";
import { buildSourceDays, isSourceStale, validateStatusRange } from "./model";
import { type DataStatusResponse, type RecoveryJob, SOURCE_IDS, type SourceId } from "./types";

const LABELS: Record<SourceId, string> = {
  github: "GitHub 커밋",
  location: "위치 기록",
  toss: "토스 알림",
  wakatime: "WakaTime",
  kis: "KIS 자산",
  withings: "Withings 체성분",
  health: "건강 · Google Health / Health Connect",
};
const HELP: Record<SourceId, string> = {
  github: "설정 또는 상단 동기화에서 GitHub 기록을 다시 가져올 수 있습니다.",
  location:
    "휴대폰 OwnTracks의 전송 상태를 확인하거나 설정에서 GPX·GeoJSON·Google Takeout을 가져오세요. 서버는 휴대폰의 누락된 원본 위치를 조회할 수 없습니다.",
  toss: "휴대폰 MacroDroid 알림 전송을 확인하세요. 이미 저장된 알림은 소비 화면에서 재분석할 수 있지만 수신하지 못한 알림은 서버에서 복원할 수 없습니다.",
  wakatime:
    "선택한 날짜의 세션과 일별 합계를 다시 조회합니다. 제공자의 요금제·기록 보관 기간에 따라 과거 조회가 제한될 수 있습니다.",
  kis: "과거 날짜의 보유자산 스냅샷은 재생성할 수 없습니다. 계좌 설정에서 현재 잔고 동기화와 과거 체결 가져오기를 실행하세요.",
  withings: "선택한 날짜의 체성분 측정을 다시 조회합니다.",
  health:
    "Google Health의 수치 지표를 날짜별로 다시 조회합니다. 수면·운동 및 휴대폰에만 있는 Health Connect 기록은 기존 건강 동기화·휴대폰 재전송을 사용하세요.",
};

export function serializeRecoveryJob(row: typeof dataRecoveryJobs.$inferSelect): RecoveryJob {
  return {
    id: row.id,
    source: row.source as RecoveryJob["source"],
    fromDate: row.fromDate,
    toDate: row.toDate,
    nextDate: row.nextDate,
    status: row.status as RecoveryJob["status"],
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getDataStatus(
  db: Database,
  userId: string,
  from: string,
  to: string,
  now = new Date()
): Promise<DataStatusResponse> {
  if (!validateStatusRange(from, to, now))
    throw new ApiError(400, "오늘까지 최대 31일의 유효한 기간을 선택해 주세요.");
  const [userRows, healthRows, withingsRows, accounts, states, jobRows, lastGithubJob] =
    await Promise.all([
      db
        .select({
          lastSyncedAt: users.lastSyncedAt,
          wakaLastSyncedAt: users.wakatimeLastSyncedAt,
          owntracks: sql<boolean>`${users.ownTracksApiKey} IS NOT NULL`,
          toss: sql<boolean>`${users.tossNotificationApiKey} IS NOT NULL`,
          waka: sql<boolean>`${users.wakatimeApiKey} IS NOT NULL`,
          healthImport: sql<boolean>`${users.healthImportApiKey} IS NOT NULL`,
        })
        .from(users)
        .where(eq(users.id, userId)),
      db
        .select({
          status: healthConnections.status,
          lastSyncedAt: healthConnections.lastSyncedAt,
          error: healthConnections.lastSyncError,
        })
        .from(healthConnections)
        .where(eq(healthConnections.userId, userId)),
      db
        .select({
          status: withingsConnections.status,
          lastSyncedAt: withingsConnections.lastSyncedAt,
          error: withingsConnections.lastSyncError,
        })
        .from(withingsConnections)
        .where(eq(withingsConnections.userId, userId)),
      db
        .select({
          id: brokerageAccounts.id,
          isActive: brokerageAccounts.isActive,
          lastSyncedAt: brokerageAccounts.lastSyncedAt,
          error: brokerageAccounts.lastSyncError,
        })
        .from(brokerageAccounts)
        .where(eq(brokerageAccounts.userId, userId)),
      db.select().from(sourceSyncStates).where(eq(sourceSyncStates.userId, userId)),
      db
        .select()
        .from(dataRecoveryJobs)
        .where(
          and(
            eq(dataRecoveryJobs.userId, userId),
            lte(dataRecoveryJobs.fromDate, to),
            gte(dataRecoveryJobs.toDate, from)
          )
        )
        .orderBy(desc(dataRecoveryJobs.createdAt))
        .limit(100),
      db
        .select({ status: syncJobs.status })
        .from(syncJobs)
        .where(eq(syncJobs.userId, userId))
        .orderBy(desc(syncJobs.createdAt))
        .limit(1),
    ]);
  const user = userRows[0];
  if (!user) throw new ApiError(404, "사용자를 찾을 수 없습니다.");
  const { start, end } = getKstDateWindow(from, to);
  // Timestamp columns store UTC wall time. Do not bind Date to raw SQL; use
  // ISO UTC strings with explicit timestamp casts independently of session TZ.
  const startUtc = start.toISOString();
  const endUtc = end.toISOString();
  const [github, result] = await Promise.all([
    db.execute<{ connected: boolean }>(
      sql`SELECT EXISTS(SELECT 1 FROM "account" WHERE "userId" = ${userId} AND "providerId" = 'github' AND "accessToken" IS NOT NULL) AS connected`
    ),
    db.execute<{
      source: SourceId;
      date: string;
      count: number;
      lastRecordAt: string | null;
    }>(sql`
    WITH observations AS (
      SELECT 'github' AS source, ${commits.committedAt} AS occurred FROM ${commits} WHERE ${commits.userId} = ${userId} AND ${commits.committedAt} >= ${startUtc}::timestamp AND ${commits.committedAt} < ${endUtc}::timestamp
      UNION ALL SELECT 'location', ${locationPoints.timestamp} FROM ${locationPoints} WHERE ${locationPoints.userId} = ${userId} AND ${locationPoints.timestamp} >= ${startUtc}::timestamp AND ${locationPoints.timestamp} < ${endUtc}::timestamp
      UNION ALL SELECT 'toss', ${notificationLogs.receivedAt} FROM ${notificationLogs} WHERE ${notificationLogs.userId} = ${userId} AND ${notificationLogs.source} = 'toss' AND ${notificationLogs.receivedAt} >= ${startUtc}::timestamp AND ${notificationLogs.receivedAt} < ${endUtc}::timestamp
      UNION ALL SELECT 'wakatime', ${codingSessions.startedAt} FROM ${codingSessions} WHERE ${codingSessions.userId} = ${userId} AND ${codingSessions.startedAt} >= ${startUtc}::timestamp AND ${codingSessions.startedAt} < ${endUtc}::timestamp
      UNION ALL SELECT 'withings', ${bodyMeasurements.measuredAt} FROM ${bodyMeasurements} WHERE ${bodyMeasurements.userId} = ${userId} AND ${bodyMeasurements.measuredAt} >= ${startUtc}::timestamp AND ${bodyMeasurements.measuredAt} < ${endUtc}::timestamp
      UNION ALL SELECT 'health', ${healthSamples.sampleAt} FROM ${healthSamples} WHERE ${healthSamples.userId} = ${userId} AND ${healthSamples.sampleAt} >= ${startUtc}::timestamp AND ${healthSamples.sampleAt} < ${endUtc}::timestamp
      UNION ALL SELECT 'kis', (${holdingSnapshots.asOfDate}::date::timestamp - interval '9 hours') FROM ${holdingSnapshots} INNER JOIN ${brokerageAccounts} ON ${holdingSnapshots.accountId} = ${brokerageAccounts.id} WHERE ${brokerageAccounts.userId} = ${userId} AND ${holdingSnapshots.asOfDate} >= ${from} AND ${holdingSnapshots.asOfDate} <= ${to}
    ) SELECT source, ${localDaySql(sql`occurred`)}::text AS date, count(*)::int AS count, to_char(max(occurred), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastRecordAt" FROM observations GROUP BY 1, 2 ORDER BY 2
  `),
  ]);
  const jobs = jobRows.map(serializeRecoveryJob);
  const latestDate = (values: (Date | null)[]) =>
    values
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null;
  const health = healthRows[0];
  const withings = withingsRows[0];
  const connections: Record<SourceId, boolean> = {
    github: github.rows[0]?.connected ?? false,
    location: user.owntracks,
    toss: user.toss,
    wakatime: user.waka,
    kis: accounts.some((a) => a.isActive),
    withings: !!withings,
    health: !!health || user.healthImport,
  };
  const success: Partial<Record<SourceId, string | null>> = {
    github: user.lastSyncedAt?.toISOString(),
    wakatime: user.wakaLastSyncedAt?.toISOString(),
    withings: withings?.lastSyncedAt?.toISOString(),
    health: health?.lastSyncedAt?.toISOString(),
    kis: latestDate(accounts.map((a) => a.lastSyncedAt)),
  };
  const existingErrors: Partial<Record<SourceId, boolean>> = {
    github: lastGithubJob[0]?.status === "failed",
    withings: !!withings?.error,
    health: !!health?.error,
    kis: accounts.some((a) => !!a.error),
  };
  const recoveryAvailability: Partial<Record<SourceId, boolean>> = {
    wakatime: user.waka,
    withings: withings?.status === "active",
    health: health?.status === "active",
  };
  return {
    from,
    to,
    timeZone: "Asia/Seoul",
    jobs,
    sources: SOURCE_IDS.map((id) => {
      const rows = result.rows.filter((r) => r.source === id);
      const state = states.find((s) => s.source === id);
      const lastSuccessAt = latestDate([
        state?.lastSuccessAt ?? null,
        success[id] ? new Date(success[id]!) : null,
      ]);
      const needsReauth =
        id === "health"
          ? health?.status === "needs_reauth"
          : id === "withings"
            ? withings?.status === "needs_reauth"
            : false;
      return {
        id,
        label: LABELS[id],
        connected: connections[id],
        needsReauth,
        lastSuccessAt,
        lastRecordAt: rows.at(-1)?.lastRecordAt ?? null,
        error:
          state?.error ??
          (existingErrors[id]
            ? "최근 동기화에서 오류가 기록되었습니다. 연동 상태를 확인해 주세요."
            : null),
        stale:
          !["location", "toss"].includes(id) && isSourceStale(connections[id], lastSuccessAt, now),
        canRecover: recoveryAvailability[id] ?? false,
        recoveryHelp: HELP[id],
        days: buildSourceDays(
          id,
          from,
          to,
          new Map(rows.map((r) => [r.date, Number(r.count)])),
          jobs
        ),
      };
    }),
  };
}
