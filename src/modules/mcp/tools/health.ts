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

export const healthTool = defineTool({
  name: "health",
  kind: "read",
  scope: "read",
  title: "건강 기록",
  description:
    "기간(한국 날짜, 기본 최근 30일, 최대 366일)의 건강 지표 일별 값(걸음 수·심박·안정시 심박·HRV·VO₂max·" +
    "산소포화도·칼로리·운동 시간 등), 운동 기록, 수면 기록(단계별 분), Withings 체중·체성분을 돌려줍니다. " +
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
    const range = parseDayRange(input, { now: ctx.now, defaultDays: 30, maxDays: HEALTH_MAX_DAYS });
    const wanted = new Set<string>(input.metrics ?? MCP_HEALTH_METRICS);
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
        message: empty ? NO_RECORDS : null,
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
