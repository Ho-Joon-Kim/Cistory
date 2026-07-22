import { sql } from "drizzle-orm";
import { bodyMeasurements, healthDailySummaries } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";
import type { HealthAggregate, HealthMetricAggregate, PeriodAggregateInput } from "../types";
import type { LocationReadExecutor } from "./location";

const metricNames = ["steps", "sleep", "heart_rate", "vo2_max"] as const;

function rows(result: unknown): Record<string, unknown>[] {
  const value = result as { rows?: unknown[] } | null;
  return Array.isArray(value?.rows) ? (value.rows as Record<string, unknown>[]) : [];
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function aggregateHealth(
  executor: LocationReadExecutor,
  input: PeriodAggregateInput & { from: Date; toExclusive: Date }
): Promise<HealthAggregate> {
  const fromDay = toLocalDateString(input.from);
  const toDay = toLocalDateString(input.toExclusive);
  const [metricResult, bodyResult] = await Promise.all([
    executor.execute(sql`
      SELECT ${healthDailySummaries.day} AS day, ${healthDailySummaries.metric} AS metric,
        ${healthDailySummaries.valueAvg} AS average, ${healthDailySummaries.valueMin} AS min,
        ${healthDailySummaries.valueMax} AS max, ${healthDailySummaries.valueSum} AS total
      FROM ${healthDailySummaries}
      WHERE ${healthDailySummaries.userId} = ${input.userId}
        AND ${healthDailySummaries.day} >= ${fromDay}
        AND ${healthDailySummaries.day} < ${toDay}
        AND ${healthDailySummaries.metric} IN ('steps', 'sleep', 'heart_rate', 'vo2_max')
      ORDER BY ${healthDailySummaries.metric}, ${healthDailySummaries.day}
    `),
    executor.execute(sql`
      SELECT ${bodyMeasurements.measuredAt} AS "measuredAt",
        ${localDaySql(bodyMeasurements.measuredAt)}::text AS day,
        ${bodyMeasurements.weightKg} AS "weightKg",
        ${bodyMeasurements.fatRatioPct} AS "fatRatioPct",
        ${bodyMeasurements.muscleMassKg} AS "muscleMassKg"
      FROM ${bodyMeasurements}
      WHERE ${bodyMeasurements.userId} = ${input.userId}
        AND ${bodyMeasurements.measuredAt} >= ${input.from}
        AND ${bodyMeasurements.measuredAt} < ${input.toExclusive}
      ORDER BY ${bodyMeasurements.measuredAt}
    `),
  ]);

  const metricRows = rows(metricResult);
  const metrics: HealthMetricAggregate[] = metricNames.map((metric) => {
    const matching = metricRows.filter((row) => row.metric === metric);
    const totals = matching
      .map((row) => nullableNumber(row.total))
      .filter((v): v is number => v !== null);
    const averages = matching
      .map((row) => nullableNumber(row.average))
      .filter((v): v is number => v !== null);
    const minimums = matching
      .map((row) => nullableNumber(row.min))
      .filter((v): v is number => v !== null);
    const maximums = matching
      .map((row) => nullableNumber(row.max))
      .filter((v): v is number => v !== null);
    const sumMetric = metric === "steps" || metric === "sleep";
    return {
      metric,
      total: totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) : null,
      average:
        averages.length > 0
          ? averages.reduce((sum, value) => sum + value, 0) / averages.length
          : null,
      min: minimums.length > 0 ? Math.min(...minimums) : null,
      max: maximums.length > 0 ? Math.max(...maximums) : null,
      days: matching.map((row) => ({
        date: String(row.day),
        value: nullableNumber(sumMetric ? row.total : row.average),
      })),
    };
  });

  const bodyRows = rows(bodyResult);
  const firstWeight = nullableNumber(bodyRows[0]?.weightKg);
  const last = bodyRows[bodyRows.length - 1];
  const latestWeight = nullableNumber(last?.weightKg);
  const weightsByDay = new Map<string, number>();
  for (const row of bodyRows) {
    const weight = nullableNumber(row.weightKg);
    if (weight !== null) weightsByDay.set(String(row.day), weight);
  }
  return {
    metrics,
    body: {
      measurementCount: bodyRows.length,
      latestMeasuredAt: last ? new Date(last.measuredAt as string | Date).toISOString() : null,
      weightKg: latestWeight,
      weightChangeKg:
        firstWeight !== null && latestWeight !== null ? latestWeight - firstWeight : null,
      fatRatioPct: nullableNumber(last?.fatRatioPct),
      muscleMassKg: nullableNumber(last?.muscleMassKg),
      weightSeries: [...weightsByDay].map(([date, weight]) => ({ date, weight })),
    },
  };
}
