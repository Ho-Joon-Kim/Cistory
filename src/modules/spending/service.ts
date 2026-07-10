import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { accountRoles, transactions, users } from "@/db/schema";
import type { CategoryTotals, SpendingCategoryKey } from "./categories";
import { accountRolesJoinOn, bucketSql } from "./classify";
import { forecastMonthEnd } from "./forecast";
import type {
  CumulativeDataPoint,
  DailySpending,
  MonthlyBarDataPoint,
  MonthlyTotal,
  SpendingTrendResponse,
} from "./types";

export class SpendingTrendService {
  constructor(private db: Database) {}

  async getSpendingTrend(userId: string): Promise<SpendingTrendResponse> {
    // Get user's tossMyName for self-transfer exclusion
    const [userRow] = await this.db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const tossMyName = userRow?.tossMyName ?? null;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const todayDayNumber = now.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Current month key
    const currentMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    // Run queries in parallel. Historical daily spending query was dropped
    // along with the Tier 3/4 forecast tiers in commit 8.2.
    const [monthlyTotals, currentMonthDaily] = await Promise.all([
      this._getMonthlyTotals(userId, tossMyName, 12),
      this._getCurrentMonthDaily(userId, tossMyName),
    ]);

    // Separate current month from history for forecast
    const historyOnly = monthlyTotals.filter((m) => m.month !== currentMonthKey);
    const currentMonthTotal = currentMonthDaily.reduce((s, d) => s + d.total, 0);

    // Run forecast (simple proportional + stddev band)
    const forecastResult = forecastMonthEnd({
      monthlyHistory: historyOnly,
      currentMonthDays: currentMonthDaily,
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
      total: m.total,
      isCurrent: m.month === currentMonthKey,
      categories: m.categories ?? {},
      ...(m.month === currentMonthKey ? { predicted: forecastResult.predictedTotal } : {}),
    }));

    // If current month is not in monthly totals (no transactions yet), add it
    if (!monthlyTotals.some((m) => m.month === currentMonthKey)) {
      monthlyBars.push({
        month: currentMonthKey.slice(5),
        total: currentMonthTotal,
        isCurrent: true,
        categories: {},
        predicted: forecastResult.predictedTotal,
      });
    }

    return {
      cumulativeCurve,
      monthlyBars,
      forecast: {
        predictedTotal: forecastResult.predictedTotal,
        upperBound: forecastResult.upperBound,
        lowerBound: forecastResult.lowerBound,
        todayDayNumber,
        daysInMonth,
        currentMonthActualTotal: currentMonthTotal,
      },
    };
  }

  private async _getMonthlyTotals(
    userId: string,
    tossMyName: string | null,
    months: number
  ): Promise<MonthlyTotal[]> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);

    const bucket = bucketSql(tossMyName);
    const rows = await this.db
      .select({
        month: sql<string>`to_char(${transactions.transactedAt}, 'YYYY-MM')`.as("month"),
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
      .groupBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM')`, transactions.category)
      .orderBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM')`);

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
    tossMyName: string | null
  ): Promise<DailySpending[]> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const bucket = bucketSql(tossMyName);
    const rows = await this.db
      .select({
        date: sql<string>`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`.as("date"),
        dayOfWeek: sql<number>`extract(dow from ${transactions.transactedAt})`.as("dow"),
        category: transactions.category,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, monthStart),
          lte(transactions.transactedAt, monthEnd),
          sql`${bucket} = 'spending'`
        )
      )
      .groupBy(
        sql`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`,
        sql`extract(dow from ${transactions.transactedAt})`,
        transactions.category
      )
      .orderBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`);

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

export function createSpendingTrendService(db: Database) {
  return new SpendingTrendService(db);
}
