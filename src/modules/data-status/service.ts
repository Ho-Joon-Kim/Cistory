import { and, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
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
  photos,
  sourceSyncStates,
  syncJobs,
  users,
  wakatimeConnections,
  withingsConnections,
} from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { ApiError } from "@/lib/api-handler";
import { getKstDateWindow } from "@/lib/date-key";
import { photoIsExposed } from "@/modules/proton/repository";
import { getProtonSummary } from "@/modules/proton/summary";
import { buildSourceDays, isSourceStale, validateStatusRange } from "./model";
import { currentSourceError } from "./telemetry";
import { type DataStatusResponse, type RecoveryJob, SOURCE_IDS, type SourceId } from "./types";

const LABELS: Record<SourceId, string> = {
  github: "GitHub 커밋",
  location: "위치 기록",
  toss: "Toss 알림",
  wakatime: "WakaTime",
  kis: "KIS 자산",
  withings: "Withings 체성분",
  health: "건강 · Google Health (Fitbit) / Health Connect",
  proton: "Proton Drive 사진",
};
const HELP: Record<SourceId, string> = {
  github: "타임라인 화면 상단의 동기화 버튼으로 GitHub 기록을 다시 가져올 수 있어요.",
  location:
    "휴대폰 OwnTracks의 전송 상태를 확인하거나 설정에서 GPX·GeoJSON·Google Takeout을 가져오세요. 휴대폰에서 빠진 원본 위치는 서버가 조회할 수 없어요.",
  toss: "휴대폰 MacroDroid 알림 전송을 확인하세요. 이미 저장된 알림은 소비 화면의 '알림 다시 분석'으로 다시 분석할 수 있지만 받지 못한 알림은 서버에서 복원할 수 없어요.",
  wakatime:
    "고른 날짜의 세션과 일별 합계를 다시 수집해요. 요금제·기록 보관 기간에 따라 오래된 기록은 가져오지 못할 수 있어요.",
  kis: "지난 날짜의 보유자산 스냅샷은 다시 만들 수 없어요. 계좌 설정에서 현재 잔고 동기화와 과거 체결 가져오기를 실행하세요.",
  withings: "고른 날짜의 체성분 측정을 다시 수집해요.",
  health:
    "Google Health (Fitbit)의 수치 지표를 날짜별로 다시 수집해요. 수면·운동 기록과 휴대폰에만 있는 Health Connect 기록은 기존 건강 동기화나 휴대폰 재전송을 사용하세요.",
  proton: "복구 대상이 아니에요. 이벤트 동기화가 Proton과 다시 대조해요.",
};

/**
 * Health metrics stored as one point per civil day, pinned to a 12:00 KST anchor
 * (`timeShape: "date"` in HEALTH_METRICS — kept in sync by service.test.ts). The
 * anchor is not a measurement time, so today's row sits hours in the future.
 */
export const DAY_ANCHORED_HEALTH_METRICS = [
  "resting_heart_rate",
  "daily_hrv",
  "daily_spo2",
  "respiratory_rate",
  "skin_temperature",
  "daily_vo2_max",
  "total_calories",
  "floors",
] as const;

/**
 * Health rows that are real observations: excludes server-side day rollups
 * (`rollup:<family>` sources, which carry no dataSource) and day-anchored daily
 * metrics. Counting them made "마지막 기록" read 12:00 KST at 10:20 and padded
 * the day counts with one synthetic row per metric per day.
 */
export function healthObservationSql(source: SQL = sql`source`, metric: SQL = sql`metric`): SQL {
  return sql`${source} NOT LIKE 'rollup:%' AND ${metric} NOT IN (${sql.join(
    DAY_ANCHORED_HEALTH_METRICS.map((m) => sql`${m}`),
    sql`, `
  )})`;
}

/** All-time stored rows and distinct KST days for one source. */
function retainedQuery(id: SourceId, userId: string): SQL {
  const of = (table: SQL, at: SQL, where: SQL = sql`true`) =>
    sql`SELECT count(*)::int AS count, count(DISTINCT ${localDaySql(at)})::int AS days
      FROM ${table} WHERE user_id = ${userId} AND ${where}`;
  switch (id) {
    case "github":
      return of(sql`commits`, sql`committed_at`);
    case "location":
      return of(sql`location_points`, sql`timestamp`);
    case "toss":
      return of(sql`notification_logs`, sql`received_at`, sql`source = 'toss'`);
    case "wakatime":
      return of(sql`coding_sessions`, sql`started_at`);
    case "withings":
      return of(sql`body_measurements`, sql`measured_at`);
    case "health":
      return of(sql`health_samples`, sql`sample_at`, healthObservationSql());
    case "kis":
      return sql`SELECT count(*)::int AS count, count(DISTINCT s.as_of_date)::int AS days
        FROM holding_snapshots s JOIN brokerage_accounts a ON a.id = s.account_id
        WHERE a.user_id = ${userId}`;
    case "proton":
      return of(sql`photos`, sql`captured_at`, photoIsExposed());
  }
}

/**
 * The all-time counts scan a source's whole table, and `/data-status` polls every
 * 5–30 s while a source needs attention, so each user+source result is memoized
 * in-process for {@link RETAINED_TTL_MS}. The web container runs as a single
 * replica (see CLAUDE.md), so a process-local memo is enough. Recovery jobs run
 * in the cron container, so a finished job can't clear this memo directly;
 * instead each entry remembers the source's job states (`version`) and a change
 * — e.g. a job turning `completed` — recomputes immediately.
 */
export const RETAINED_TTL_MS = 10 * 60 * 1000;
const RETAINED_MEMO_MAX = 1000;
const retainedMemo = new Map<
  string,
  { value: { count: number; days: number }; version: string; expiresAt: number }
>();

/** Test hook: drop every memoized count. */
export function clearRetainedCountsMemo() {
  retainedMemo.clear();
}

export async function retainedCounts(
  db: Database,
  userId: string,
  ids: SourceId[],
  options: { now?: number; versions?: Partial<Record<SourceId, string>> } = {}
): Promise<Partial<Record<SourceId, { count: number; days: number }>>> {
  const now = options.now ?? Date.now();
  const entries = await Promise.all(
    ids.map(async (id) => {
      const key = `${userId}:${id}`;
      const version = options.versions?.[id] ?? "";
      const hit = retainedMemo.get(key);
      if (hit && hit.expiresAt > now && hit.version === version) return [id, hit.value] as const;
      const result = await db.execute<{ count: number; days: number }>(retainedQuery(id, userId));
      const row = result.rows[0];
      const value = { count: Number(row?.count ?? 0), days: Number(row?.days ?? 0) };
      if (retainedMemo.size >= RETAINED_MEMO_MAX) {
        for (const [k, v] of retainedMemo) if (v.expiresAt <= now) retainedMemo.delete(k);
        if (retainedMemo.size >= RETAINED_MEMO_MAX) retainedMemo.clear();
      }
      retainedMemo.set(key, { value, version, expiresAt: now + RETAINED_TTL_MS });
      return [id, value] as const;
    })
  );
  return Object.fromEntries(entries);
}

/** Job errors stored before the copy moved to 해요체, in their current wording. */
const LEGACY_JOB_ERRORS: Record<string, string> = {
  "작업이 반복해서 중단되었습니다. 다시 요청해 주세요.":
    "작업이 반복해서 중단됐어요. 다시 요청해 주세요.",
  "해당 날짜를 다시 가져오지 못했습니다. 제공자의 보관 기간과 연결 상태를 확인한 뒤 다시 요청해 주세요.":
    "해당 날짜를 다시 가져오지 못했어요. 서비스의 보관 기간과 연결 상태를 확인한 뒤 다시 요청해 주세요.",
};

export function serializeRecoveryJob(row: typeof dataRecoveryJobs.$inferSelect): RecoveryJob {
  return {
    id: row.id,
    source: row.source as RecoveryJob["source"],
    fromDate: row.fromDate,
    toDate: row.toDate,
    nextDate: row.nextDate,
    status: row.status as RecoveryJob["status"],
    error: LEGACY_JOB_ERRORS[row.error ?? ""] ?? row.error,
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
  const [
    userRows,
    healthRows,
    withingsRows,
    wakaRows,
    accounts,
    states,
    jobRows,
    lastGithubJob,
    proton,
  ] = await Promise.all([
    db
      .select({
        lastSyncedAt: users.lastSyncedAt,
        wakaLastSyncedAt: users.wakatimeLastSyncedAt,
        owntracks: sql<boolean>`${users.ownTracksApiKey} IS NOT NULL`,
        toss: sql<boolean>`${users.tossNotificationApiKey} IS NOT NULL`,
        // Deprecated API key: only used to flag "reconnect via OAuth" below.
        wakaLegacyKey: sql<boolean>`${users.wakatimeApiKey} IS NOT NULL`,
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
      .select({ status: wakatimeConnections.status })
      .from(wakatimeConnections)
      .where(eq(wakatimeConnections.userId, userId)),
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
    getProtonSummary(db, userId),
  ]);
  const user = userRows[0];
  if (!user) throw new ApiError(404, "사용자를 찾을 수 없어요.");
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
      UNION ALL SELECT 'health', ${healthSamples.sampleAt} FROM ${healthSamples} WHERE ${healthSamples.userId} = ${userId} AND ${healthSamples.sampleAt} >= ${startUtc}::timestamp AND ${healthSamples.sampleAt} < ${endUtc}::timestamp AND ${healthObservationSql(sql`${healthSamples.source}`, sql`${healthSamples.metric}`)}
      UNION ALL SELECT 'proton', ${photos.capturedAt} FROM ${photos} WHERE ${photos.userId} = ${userId} AND ${photoIsExposed()} AND ${photos.capturedAt} >= ${startUtc}::timestamp AND ${photos.capturedAt} < ${endUtc}::timestamp
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
  const waka = wakaRows[0];
  // A leftover API key without an OAuth connection can no longer sync (WakaTime
  // rejects API keys for reads) — surface it as "connected, needs re-auth".
  const wakaNeedsReauth = waka ? waka.status === "needs_reauth" : user.wakaLegacyKey;
  const connections: Record<SourceId, boolean> = {
    github: github.rows[0]?.connected ?? false,
    location: user.owntracks,
    toss: user.toss,
    wakatime: !!waka || user.wakaLegacyKey,
    kis: accounts.some((a) => a.isActive),
    withings: !!withings,
    health: !!health || user.healthImport,
    proton: proton.connected,
  };
  const success: Partial<Record<SourceId, string | null>> = {
    github: user.lastSyncedAt?.toISOString(),
    wakatime: user.wakaLastSyncedAt?.toISOString(),
    withings: withings?.lastSyncedAt?.toISOString(),
    health: health?.lastSyncedAt?.toISOString(),
    kis: latestDate(accounts.map((a) => a.lastSyncedAt)),
    proton: proton.lastSyncedAt,
  };
  const existingErrors: Partial<Record<SourceId, boolean>> = {
    github: lastGithubJob[0]?.status === "failed",
    withings: !!withings?.error,
    health: !!health?.error,
    kis: accounts.some((a) => !!a.error),
    proton: !!proton.lastError,
  };
  const reauth: Partial<Record<SourceId, boolean>> = {
    health: health?.status === "needs_reauth",
    withings: withings?.status === "needs_reauth",
    wakatime: wakaNeedsReauth,
    proton: proton.status === "needs_reauth",
  };
  const protonNotes = [
    proton.detailsFailedCount > 0 ? `세부 정보 수집 실패 ${proton.detailsFailedCount}장` : null,
    proton.blockedCount > 0 ? `차단 ${proton.blockedCount}장` : null,
  ].filter((note): note is string => note !== null);
  const recoveryAvailability: Partial<Record<SourceId, boolean>> = {
    wakatime: waka?.status === "active",
    withings: withings?.status === "active",
    health: health?.status === "active",
  };
  const base = SOURCE_IDS.map((id) => {
    const state = states.find((s) => s.source === id);
    const lastSuccessAt = latestDate([
      state?.lastSuccessAt ?? null,
      success[id] ? new Date(success[id]!) : null,
    ]);
    const error =
      currentSourceError(state?.error) ??
      (existingErrors[id]
        ? "최근 동기화에서 오류가 기록됐어요. 설정에서 연결 상태를 확인해 주세요."
        : null);
    const stale =
      !["location", "toss"].includes(id) && isSourceStale(connections[id], lastSuccessAt, now);
    return { id, lastSuccessAt, error, stale, needsReauth: reauth[id] ?? false };
  });
  // Only sources that need attention get the all-time count (the focus panel's
  // "보관된 기록"): it scans the source's whole table, so healthy ones skip it.
  const retained = await retainedCounts(
    db,
    userId,
    base
      .filter((b) => connections[b.id] && (b.needsReauth || b.stale || !!b.error))
      .map((b) => b.id),
    {
      now: now.getTime(),
      // A recovery job changing state (completing, failing) invalidates the memo.
      versions: Object.fromEntries(
        SOURCE_IDS.map((id) => [
          id,
          jobs
            .filter((j) => j.source === id)
            .map((j) => `${j.id}:${j.status}`)
            .join(","),
        ])
      ),
    }
  );
  return {
    from,
    to,
    timeZone: "Asia/Seoul",
    jobs,
    sources: base.map(({ id, lastSuccessAt, error, stale, needsReauth }) => {
      const reauthReason = !needsReauth
        ? null
        : id === "wakatime" && !waka
          ? ("legacy_key" as const)
          : ("auth" as const);
      const rows = result.rows.filter((r) => r.source === id);
      return {
        id,
        label: LABELS[id],
        connected: connections[id],
        needsReauth,
        reauthReason,
        lastSuccessAt,
        lastRecordAt: rows.at(-1)?.lastRecordAt ?? null,
        error,
        stale,
        canRecover: recoveryAvailability[id] ?? false,
        recoveryHelp: HELP[id],
        ...(id === "proton" && protonNotes.length > 0 ? { notes: protonNotes } : {}),
        days: buildSourceDays(
          id,
          from,
          to,
          new Map(rows.map((r) => [r.date, Number(r.count)])),
          jobs
        ),
        retained: retained[id] ?? null,
      };
    }),
  };
}
