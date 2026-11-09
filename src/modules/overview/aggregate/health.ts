import { sql } from "drizzle-orm";
import { bodyMeasurements, healthDailySummaries, healthSamples } from "@/db/schema";
import { localDaySql, timestampFromDriver, timestampParam } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";
import { dedupeSessions } from "@/modules/health/sessions";
import type { HealthAggregate, HealthMetricAggregate, PeriodAggregateInput } from "../types";
import type { LocationReadExecutor } from "./location";
import { resultRows as rows } from "./query-values";

const metricNames = ["steps", "sleep", "heart_rate", "vo2_max"] as const;

/** A night that starts this long before the period can still wake inside it. */
const SLEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minOf(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function maxOf(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

export async function aggregateHealth(
  executor: LocationReadExecutor,
  input: PeriodAggregateInput & { from: Date; toExclusive: Date }
): Promise<HealthAggregate> {
  const fromDay = toLocalDateString(input.from);
  const toDay = toLocalDateString(input.toExclusive);
  const [metricResult, bodyResult, sleepResult] = await Promise.all([
    executor.execute(sql`
      SELECT ${healthDailySummaries.day} AS day, ${healthDailySummaries.metric} AS metric,
        ${healthDailySummaries.valueAvg} AS average, ${healthDailySummaries.valueMin} AS min,
        ${healthDailySummaries.valueMax} AS max, ${healthDailySummaries.valueSum} AS total
      FROM ${healthDailySummaries}
      WHERE ${healthDailySummaries.userId} = ${input.userId}
        AND ${healthDailySummaries.day} >= ${fromDay}
        AND ${healthDailySummaries.day} < ${toDay}
        AND ${healthDailySummaries.metric} IN ('steps', 'heart_rate', 'vo2_max')
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
        AND ${bodyMeasurements.measuredAt} >= ${timestampParam(bodyMeasurements.measuredAt, input.from)}
        AND ${bodyMeasurements.measuredAt} < ${timestampParam(bodyMeasurements.measuredAt, input.toExclusive)}
      ORDER BY ${bodyMeasurements.measuredAt}
    `),
    // Sleep sessions never reach health_daily_summaries (see modules/health/sessions.ts),
    // so read them raw and dedup at read time, the same way /health does.
    executor.execute(sql`
      SELECT ${healthSamples.sampleAt} AS "sampleAt", ${healthSamples.source} AS source,
        ${healthSamples.value} AS minutes
      FROM ${healthSamples}
      WHERE ${healthSamples.userId} = ${input.userId}
        AND ${healthSamples.metric} = 'sleep'
        AND ${healthSamples.sampleAt} >= ${timestampParam(healthSamples.sampleAt, new Date(input.from.getTime() - SLEEP_LOOKBACK_MS))}
        AND ${healthSamples.sampleAt} < ${timestampParam(healthSamples.sampleAt, input.toExclusive)}
    `),
  ]);

  // Sleep minutes per KST day, attributing each night to the day it wakes on.
  const sleepByDay = new Map<string, number>();
  const sessions = dedupeSessions(
    rows(sleepResult).map((row) => ({
      sampleAt: timestampFromDriver(healthSamples.sampleAt, row.sampleAt),
      source: String(row.source),
      minutes: nullableNumber(row.minutes) ?? 0,
    }))
  );
  for (const session of sessions) {
    if (session.minutes <= 0) continue;
    const wakeDay = toLocalDateString(
      new Date(session.sampleAt.getTime() + session.minutes * 60_000)
    );
    if (wakeDay < fromDay || wakeDay >= toDay) continue;
    sleepByDay.set(wakeDay, (sleepByDay.get(wakeDay) ?? 0) + session.minutes);
  }
  const sleepRows = [...sleepByDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, minutes]) => ({ day, metric: "sleep", total: minutes }));

  const metricRows: Record<string, unknown>[] = [...rows(metricResult), ...sleepRows];
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
    // A daily summary's avg/min/max are per raw sample (one Fitbit minute of steps),
    // so a summed metric's period stats must come from its daily totals instead.
    const sumMetric = metric === "steps" || metric === "sleep";
    const perDay = sumMetric ? totals : averages;
    return {
      metric,
      total: totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) : null,
      average:
        perDay.length > 0 ? perDay.reduce((sum, value) => sum + value, 0) / perDay.length : null,
      min: minOf(sumMetric ? totals : minimums),
      max: maxOf(sumMetric ? totals : maximums),
      days: matching.map((row) => ({
        date: String(row.day),
        value: nullableNumber(sumMetric ? row.total : row.average),
      })),
    };
  });

  const bodyRows = rows(bodyResult);
  // Each Withings group arrives paired with a weight-less row at the same instant, in
  // no fixed order, so take the earliest/latest row that actually carries each value.
  const firstOf = (field: string) =>
    bodyRows.map((row) => nullableNumber(row[field])).find((v) => v !== null) ?? null;
  const latestOf = (field: string) =>
    bodyRows.map((row) => nullableNumber(row[field])).findLast((v) => v !== null) ?? null;
  const firstWeight = firstOf("weightKg");
  const last = bodyRows[bodyRows.length - 1];
  const latestWeight = latestOf("weightKg");
  const weightsByDay = new Map<string, number>();
  for (const row of bodyRows) {
    const weight = nullableNumber(row.weightKg);
    if (weight !== null) weightsByDay.set(String(row.day), weight);
  }
  return {
    metrics,
    body: {
      measurementCount: bodyRows.length,
      latestMeasuredAt: last
        ? timestampFromDriver(bodyMeasurements.measuredAt, last.measuredAt).toISOString()
        : null,
      weightKg: latestWeight,
      weightChangeKg:
        firstWeight !== null && latestWeight !== null ? latestWeight - firstWeight : null,
      fatRatioPct: latestOf("fatRatioPct"),
      muscleMassKg: latestOf("muscleMassKg"),
      weightSeries: [...weightsByDay].map(([date, weight]) => ({ date, weight })),
    },
  };
}
