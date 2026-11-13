/**
 * Health read tools: `health` (read) and `health_rhythm` (sensitive-read).
 *
 * `health` exposes only the metrics in MCP_HEALTH_METRICS — an explicit
 * allowlist, like overview's OVERVIEW_HEALTH_METRICS — so ECG / irregular
 * rhythm results (`ecg`, `irn`) can never reach a read-only token even if a
 * shared service starts returning them. They are served only by
 * `health_rhythm`, which requires `sensitive-read`.
 */

import { z } from "zod";
import { getHealthSummary } from "@/modules/health/summary";
import { McpInputError } from "../errors";
import { defineTool, type McpTool } from "../server";
import { toKstIso } from "../time";
import {
  dayRangeFields,
  kstIso,
  NO_RECORDS,
  parseDayRange,
  RANGE_ARG_RULES,
  READ_ANNOTATIONS,
} from "./common";
import { listBodyMeasurements } from "./data";

/** The only health metric keys any read-scope tool may emit. Never add `ecg` / `irn`. */
export const MCP_HEALTH_METRICS = [
  "steps",
  "distance",
  "active_energy",
  "total_calories",
  "active_zone_minutes",
  "heart_rate",
  "resting_heart_rate",
  "hrv",
  "vo2_max",
  "spo2",
  "respiratory_rate",
  "skin_temperature",
  "exercise",
] as const;

export type McpHealthMetric = (typeof MCP_HEALTH_METRICS)[number];

/** Sensitive rhythm metrics: only `health_rhythm` (sensitive-read) may return them. */
export const SENSITIVE_HEALTH_METRICS = ["ecg", "irn"] as const;

const ALLOWED = new Set<string>(MCP_HEALTH_METRICS);

export function isMcpHealthMetric(key: string): key is McpHealthMetric {
  return ALLOWED.has(key);
}

/** Drop any `{ metric }` row (e.g. trip health summaries) outside the allowlist. */
export function filterHealthMetricRows<T extends { metric: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => isMcpHealthMetric(row.metric));
}

const HEALTH_MAX_DAYS = 366;
/**
 * Metric-days one call may return. Each day entry costs ~90 bytes, so a full
 * year of all 13 metrics (~440 KB) would hit the 200 KB result cap; measured on
 * real data, 90 days of every metric came to ~100 KB with sleep, workouts and
 * body included. 1100 allows ~84 days of everything or a year of three metrics.
 */
const HEALTH_METRIC_DAY_BUDGET = 1100;
/** Sleep stage segments cost ~850 bytes a night, so they are limited to a month. */
const HEALTH_SEGMENT_MAX_DAYS = 31;

function healthMaxDays(metricCount: number, withSegments: boolean): number {
  const byBudget = Math.floor(HEALTH_METRIC_DAY_BUDGET / Math.max(1, metricCount));
  return Math.min(HEALTH_MAX_DAYS, byBudget, withSegments ? HEALTH_SEGMENT_MAX_DAYS : Infinity);
}

function parseHealthRange(
  input: { from?: string; to?: string },
  metricCount: number,
  withSegments: boolean,
  now: Date
) {
  const maxDays = healthMaxDays(metricCount, withSegments);
  try {
    return parseDayRange(input, { now, defaultDays: Math.min(30, maxDays), maxDays });
  } catch (error) {
    if (error instanceof McpInputError && error.code === "range_too_long") {
      const hint = withSegments
        ? "수면 단계 구간(includeSleepSegments)은 최대 31일까지 받을 수 있습니다."
        : `지표 ${metricCount}개는 최대 ${maxDays}일까지 조회할 수 있습니다. metrics로 지표를 줄이면 최대 ${HEALTH_MAX_DAYS}일까지 넓힐 수 있습니다.`;
      throw new McpInputError(`${error.message} ${hint}`, "range_too_long");
    }
    throw error;
  }
}

const LIST_TRUNCATED_MESSAGE = (label: string, shown: number, total: number) =>
  `${label}은 기간 안 ${total}건 중 최근 ${shown}건만 담았습니다. 전체를 보려면 기간을 좁혀 나눠 요청하세요.`;

export const healthTool = defineTool({
  name: "health",
  kind: "read",
  scope: "read",
  title: "건강 기록",
  description:
    "기간(한국 날짜, 기본 최근 30일)의 건강 지표 일별 값(걸음 수·심박·안정시 심박·HRV·VO₂max·" +
    "산소포화도·칼로리·운동 시간 등), 운동 기록, 수면 기록(단계별 분), Withings 체중·체성분을 돌려줍니다. " +
    "최대 기간은 지표 수에 따라 다릅니다(전체 지표 약 84일, 지표 3개 이하 366일, 수면 단계 구간 포함 시 31일). " +
    "운동·수면 목록은 각각 최근 100건까지이며, 잘렸으면 truncated와 total로 알려줍니다. " +
    "심전도·불규칙 심박은 health_rhythm(민감 정보 권한)으로만 조회됩니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    ...dayRangeFields,
    metrics: z
      .array(z.enum(MCP_HEALTH_METRICS))
      .min(1)
      .optional()
      .describe("받을 지표 (기본: 전체)."),
    includeSleepSegments: z
      .boolean()
      .optional()
      .describe("수면 단계 구간 목록까지 받을지 (기본 false, 응답이 커집니다)."),
  }),
  argRules: { ...RANGE_ARG_RULES, metrics: "keep", includeSleepSegments: "keep" },
  run: async (ctx, input) => {
    const wanted = new Set<string>(input.metrics ?? MCP_HEALTH_METRICS);
    const range = parseHealthRange(
      input,
      wanted.size,
      input.includeSleepSegments === true,
      ctx.now
    );
    const [summary, body] = await Promise.all([
      getHealthSummary(ctx.userId, { period: { from: range.fromDate, to: range.toDate } }, ctx.db),
      listBodyMeasurements(ctx.db, ctx.userId, range),
    ]);

    const metrics = summary.metrics
      .filter((m) => isMcpHealthMetric(m.key) && wanted.has(m.key))
      .map((m) => ({
        key: m.key,
        label: m.label,
        unit: m.unit,
        agg: m.agg,
        // Stored values times `scale` give `unit` (e.g. distance mm → km).
        scale: m.scale,
        days: m.points.map((p) => ({
          day: p.day,
          avg: p.avg,
          min: p.min,
          max: p.max,
          sum: p.sum,
          count: p.count,
        })),
      }));

    const sleepSessions = summary.sleepSessions.map((s) => ({
      start: kstIso(s.start),
      minutes: s.minutes,
      nap: s.nap,
      stages: s.stages,
      ...(input.includeSleepSegments ? { segments: s.segments } : {}),
    }));
    const workouts = summary.workouts.map((w) => ({
      start: kstIso(w.start),
      minutes: w.minutes,
      name: w.name,
      type: w.type,
    }));
    const bodyMeasurements = body.map((b) => ({ ...b, measuredAt: toKstIso(b.measuredAt) }));
    const empty =
      metrics.every((m) => m.days.length === 0) &&
      sleepSessions.length === 0 &&
      workouts.length === 0 &&
      bodyMeasurements.length === 0;
    const totals = summary.periodListTotals;
    const lists = {
      workouts: {
        total: totals?.workouts.total ?? workouts.length,
        truncated: totals?.workouts.truncated ?? false,
      },
      sleepSessions: {
        total: totals?.sleepSessions.total ?? sleepSessions.length,
        truncated: totals?.sleepSessions.truncated ?? false,
      },
    };
    const notes = [
      lists.workouts.truncated
        ? LIST_TRUNCATED_MESSAGE("운동 기록", workouts.length, lists.workouts.total)
        : null,
      lists.sleepSessions.truncated
        ? LIST_TRUNCATED_MESSAGE("수면 기록", sleepSessions.length, lists.sleepSessions.total)
        : null,
    ].filter((n): n is string => n !== null);

    return {
      structured: {
        period: { from: range.fromDate, to: range.toDate },
        connection: {
          connected: summary.hasConnection,
          status: summary.status,
          lastSyncedAt: kstIso(summary.lastSyncedAt),
        },
        metrics,
        sleepSessions,
        workouts,
        bodyMeasurements,
        lists,
        message: empty ? NO_RECORDS : notes.length > 0 ? notes.join(" ") : null,
      },
      count:
        metrics.reduce((n, m) => n + m.days.length, 0) + sleepSessions.length + workouts.length,
    };
  },
});

export const healthRhythmTool = defineTool({
  name: "health_rhythm",
  kind: "read",
  scope: "sensitive-read",
  title: "심전도·불규칙 심박",
  description:
    "최근 심전도(ECG) 측정의 기기 분류와 평균 심박, 불규칙 심박 알림 결과를 돌려줍니다. " +
    "기기 분류를 그대로 전달할 뿐 의료 진단이 아닙니다. 민감 정보 권한(sensitive-read)이 필요합니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({}),
  argRules: {},
  run: async (ctx) => {
    const summary = await getHealthSummary(ctx.userId, {}, ctx.db);
    const rhythm = summary.rhythm;
    const ecg =
      rhythm?.ecg?.map((r) => ({
        start: kstIso(r.start),
        classification: r.classification,
        bpm: r.bpm,
      })) ?? null;
    const irn =
      rhythm?.irn?.map((r) => ({
        start: kstIso(r.start),
        end: kstIso(r.end),
        positiveWindows: r.positiveWindows,
        windows: r.windows,
      })) ?? null;
    return {
      structured: {
        granted: { ecg: ecg !== null, irn: irn !== null },
        ecg,
        irn,
        note: "기기 분류를 그대로 전달합니다. 의료 진단이 아닙니다.",
        message: !rhythm ? "심전도·불규칙 심박 권한이 연결되지 않았습니다." : null,
      },
      count: (ecg?.length ?? 0) + (irn?.length ?? 0),
    };
  },
});

export const HEALTH_TOOLS: McpTool[] = [healthTool, healthRhythmTool];
