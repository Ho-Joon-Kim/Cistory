import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { transactions, users } from "@/db/schema";
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
      ...(m.month === currentMonthKey ? { predicted: forecastResult.predictedTotal } : {}),
    }));

    // If current month is not in monthly totals (no transactions yet), add it
    if (!monthlyTotals.some((m) => m.month === currentMonthKey)) {
      monthlyBars.push({
        month: currentMonthKey.slice(5),
        total: currentMonthTotal,
        isCurrent: true,
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

    const conditions = [
      eq(transactions.userId, userId),
      eq(transactions.type, "withdrawal"),
      gte(transactions.transactedAt, cutoff),
    ];
    if (tossMyName) {
      conditions.push(ne(transactions.merchant, tossMyName));
    }

    const rows = await this.db
      .select({
        month: sql<string>`to_char(${transactions.transactedAt}, 'YYYY-MM')`.as("month"),
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM')`);

    return rows.map((r) => ({ month: r.month, total: Number(r.total) }));
  }

  private async _getCurrentMonthDaily(
    userId: string,
    tossMyName: string | null
  ): Promise<DailySpending[]> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const conditions = [
      eq(transactions.userId, userId),
      eq(transactions.type, "withdrawal"),
      gte(transactions.transactedAt, monthStart),
      lte(transactions.transactedAt, monthEnd),
    ];
    if (tossMyName) {
      conditions.push(ne(transactions.merchant, tossMyName));
    }

    const rows = await this.db
      .select({
        date: sql<string>`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`.as("date"),
        dayOfWeek: sql<number>`extract(dow from ${transactions.transactedAt})`.as("dow"),
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(
        sql`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`,
        sql`extract(dow from ${transactions.transactedAt})`
      )
      .orderBy(sql`to_char(${transactions.transactedAt}, 'YYYY-MM-DD')`);

    return rows.map((r) => ({
      date: r.date,
      dayOfWeek: Number(r.dayOfWeek),
      total: Number(r.total),
    }));
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

    for (let d = 1; d <= daysInMonth; d++) {
      if (d <= todayDay) {
        cumulative += dailyMap.get(d) || 0;
        const _pred = predMap.get(d);
        curve.push({
          day: d,
          actual: cumulative,
          mid: d === todayDay ? cumulative : null,
          upper: d === todayDay ? cumulative : null,
          lower: d === todayDay ? cumulative : null,
        });
      } else {
        const pred = predMap.get(d);
        curve.push({
          day: d,
          actual: null,
          mid: pred?.mid ?? null,
          upper: pred?.upper ?? null,
          lower: pred?.lower ?? null,
        });
      }
    }

    return curve;
  }
}

export function createSpendingTrendService(db: Database) {
  return new SpendingTrendService(db);
}
