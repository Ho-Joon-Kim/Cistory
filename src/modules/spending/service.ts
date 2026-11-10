import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { accountRoles, transactions, users } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { toKstCalendarDate } from "@/lib/date-key";
import type { CategoryTotals, SpendingCategoryKey } from "./categories";
import { accountRolesJoinOn, bucketSql } from "./classify";
import { forecastMonthEnd } from "./forecast";
import { buildReferenceCurves, REFERENCE_AVERAGE_MONTHS } from "./reference";
import type {
  CumulativeDataPoint,
  DailySpending,
  MonthlyBarDataPoint,
  MonthlyTotal,
  SpendingTrendResponse,
} from "./types";

export class SpendingTrendService {
  constructor(private db: Database) {}

  async getSpendingTrend(userId: string, now = new Date()): Promise<SpendingTrendResponse> {
    // Get user's tossMyName for self-transfer exclusion
    const [userRow] = await this.db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const tossMyName = userRow?.tossMyName ?? null;

    // Calendar fields in KST regardless of the process TZ.
    const [year, monthNumber, todayDayNumber] = toKstCalendarDate(now).split("-").map(Number);
    const month = monthNumber - 1; // 0-indexed
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Current month key
    const currentMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    // Run queries in parallel. Historical daily spending query was dropped
    // along with the Tier 3/4 forecast tiers in commit 8.2.
    const monthStart = kstMidnight(year, month, 1);
    const nextMonthStart = kstMidnight(year, month + 1, 1);
    const [monthlyTotals, currentMonthDaily, currentMonthAmounts, referenceDaily] =
      await Promise.all([
        this._getMonthlyTotals(userId, tossMyName, kstMidnight(year, month - 12, 1)),
        this._getCurrentMonthDaily(userId, tossMyName, monthStart, nextMonthStart),
        this._getCurrentMonthAmounts(userId, tossMyName, monthStart, nextMonthStart),
        // Same daily grouping over the settled months the chart's reference lines use.
        this._getCurrentMonthDaily(
          userId,
          tossMyName,
          kstMidnight(year, month - REFERENCE_AVERAGE_MONTHS, 1),
          monthStart
        ),
      ]);

    // Separate current month from history for forecast
    const historyOnly = monthlyTotals.filter((m) => m.month !== currentMonthKey);
    const currentMonthTotal = currentMonthDaily.reduce((s, d) => s + d.total, 0);

    // Run forecast (simple proportional + stddev band)
    const forecastResult = forecastMonthEnd({
      monthlyHistory: historyOnly,
      currentMonthDays: currentMonthDaily,
      currentMonthAmounts,
      daysInMonth,
      todayDayNumber,
    });

    // Build cumulative curve
    const cumulativeCurve = this._buildCumulativeCurve(
      currentMonthDaily,
      forecastResult.dailyPredictions,
      todayDayNumber,
      daysInMonth
    );

    // Build monthly bars (include current month)
    const monthlyBars: MonthlyBarDataPoint[] = monthlyTotals.map((m) => ({
      month: m.month.slice(5), // "MM"
      key: m.month,
      total: m.total,
      isCurrent: m.month === currentMonthKey,
      categories: m.categories ?? {},
      ...(m.month === currentMonthKey ? { predicted: forecastResult.predictedTotal } : {}),
    }));

    // If current month is not in monthly totals (no transactions yet), add it
    if (!monthlyTotals.some((m) => m.month === currentMonthKey)) {
      monthlyBars.push({
        month: currentMonthKey.slice(5),
        key: currentMonthKey,
        total: currentMonthTotal,
        isCurrent: true,
        categories: {},
        predicted: forecastResult.predictedTotal,
      });
    }

    return {
      cumulativeCurve,
      references: buildReferenceCurves(referenceDaily, currentMonthKey, daysInMonth),
      monthlyBars,
      forecast: {
        predictedTotal: forecastResult.predictedTotal,
        upperBound: forecastResult.upperBound,
        lowerBound: forecastResult.lowerBound,
        todayDayNumber,
        daysInMonth,
        currentMonthActualTotal: currentMonthTotal,
        oneOffTotal: forecastResult.oneOffTotal,
        oneOffCount: forecastResult.oneOffCount,
        oneOffThreshold: forecastResult.oneOffThreshold,
      },
    };
  }

  private async _getMonthlyTotals(
    userId: string,
    tossMyName: string | null,
    cutoff: Date
  ): Promise<MonthlyTotal[]> {
    const bucket = bucketSql(tossMyName);
    const monthKey = sql<string>`to_char(${localDaySql(transactions.transactedAt)}, 'YYYY-MM')`;
    const rows = await this.db
      .select({
        month: monthKey.as("month"),
        category: transactions.category,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, cutoff),
          sql`${bucket} = 'spending'`
        )
      )
      .groupBy(monthKey, transactions.category)
      .orderBy(monthKey);

    const byMonth = new Map<string, MonthlyTotal>();
    for (const row of rows) {
      const current = byMonth.get(row.month) ?? { month: row.month, total: 0, categories: {} };
      const total = Number(row.total);
      const category = (row.category ?? "uncategorized") as SpendingCategoryKey;
      current.total += total;
      current.categories = { ...current.categories, [category]: total };
      byMonth.set(row.month, current);
    }
    return Array.from(byMonth.values());
  }

  private async _getCurrentMonthDaily(
    userId: string,
    tossMyName: string | null,
    monthStart: Date,
    nextMonthStart: Date
  ): Promise<DailySpending[]> {
    const bucket = bucketSql(tossMyName);
    // Group by KST calendar day: transacted_at is UTC wall time, so a bare
    // to_char/extract would put 00:00–09:00 KST spending on the previous day.
    const kstDay = localDaySql(transactions.transactedAt);
    const dateKey = sql<string>`to_char(${kstDay}, 'YYYY-MM-DD')`;
    const dow = sql<number>`extract(dow from ${kstDay})`;
    const rows = await this.db
      .select({
        date: dateKey.as("date"),
        dayOfWeek: dow.as("dow"),
        category: transactions.category,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, monthStart),
          lt(transactions.transactedAt, nextMonthStart),
          sql`${bucket} = 'spending'`
        )
      )
      .groupBy(dateKey, dow, transactions.category)
      .orderBy(dateKey);

    const byDate = new Map<string, DailySpending>();
    for (const row of rows) {
      const current = byDate.get(row.date) ?? {
        date: row.date,
        dayOfWeek: Number(row.dayOfWeek),
        total: 0,
        categories: {},
      };
      const total = Number(row.total);
      const category = (row.category ?? "uncategorized") as SpendingCategoryKey;
      current.total += total;
      current.categories = { ...current.categories, [category]: total };
      byDate.set(row.date, current);
    }
    return Array.from(byDate.values());
  }

  /** Individual spending amounts this month, for the forecast's one-off detection. */
  private async _getCurrentMonthAmounts(
    userId: string,
    tossMyName: string | null,
    monthStart: Date,
    nextMonthStart: Date
  ): Promise<number[]> {
    const rows = await this.db
      .select({ amount: transactions.amount })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, monthStart),
          lt(transactions.transactedAt, nextMonthStart),
          sql`${bucketSql(tossMyName)} = 'spending'`
        )
      );
    return rows.map((r) => Number(r.amount));
  }

  private _buildCumulativeCurve(
    dailySpending: DailySpending[],
    predictions: { day: number; mid: number; upper: number; lower: number }[],
    todayDay: number,
    daysInMonth: number
  ): CumulativeDataPoint[] {
    // Build a map of day → daily total
    const dailyMap = new Map<number, number>();
    for (const d of dailySpending) {
      const dayNum = Number(d.date.split("-")[2]);
      dailyMap.set(dayNum, d.total);
    }

    // Build prediction map
    const predMap = new Map<number, { mid: number; upper: number; lower: number }>();
    for (const p of predictions) {
      predMap.set(p.day, p);
    }

    const curve: CumulativeDataPoint[] = [];
    let cumulative = 0;
    const categoryCumulative: CategoryTotals = {};

    for (let d = 1; d <= daysInMonth; d++) {
      if (d <= todayDay) {
        const daily = dailySpending.find((item) => Number(item.date.split("-")[2]) === d);
        cumulative += dailyMap.get(d) || 0;
        for (const [category, total] of Object.entries(daily?.categories ?? {})) {
          const key = category as SpendingCategoryKey;
          categoryCumulative[key] = (categoryCumulative[key] ?? 0) + (total ?? 0);
        }
        const _pred = predMap.get(d);
        curve.push({
          day: d,
          actual: cumulative,
          mid: d === todayDay ? cumulative : null,
          upper: d === todayDay ? cumulative : null,
          lower: d === todayDay ? cumulative : null,
          categories: { ...categoryCumulative },
        });
      } else {
        const pred = predMap.get(d);
        curve.push({
          day: d,
          actual: null,
          mid: pred?.mid ?? null,
          upper: pred?.upper ?? null,
          lower: pred?.lower ?? null,
          categories: {},
        });
      }
    }

    return curve;
  }
}

/** The instant of 00:00 KST on the given calendar day (month may over/underflow). */
function kstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - KST_OFFSET_MS);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function createSpendingTrendService(db: Database) {
  return new SpendingTrendService(db);
}
