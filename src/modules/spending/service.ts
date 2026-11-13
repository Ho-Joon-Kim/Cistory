import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { accountRoles, transactions, users } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { toKstCalendarDate } from "@/lib/date-key";
import type { InTxHook, WriteOptions } from "@/lib/write-hook";
import { invalidateOverviewDays, transactionDayRange } from "@/modules/overview/write-invalidation";
import { type CategoryTotals, isExpenseCategory, type SpendingCategoryKey } from "./categories";
import { accountRolesJoinOn, type Bucket, bucketSql } from "./classify";
import { forecastMonthEnd } from "./forecast";
import { buildReferenceCurves, REFERENCE_AVERAGE_MONTHS } from "./reference";
import { refundSql, selectIncomeGroups, summarizeIncomeFlow } from "./refund";
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

// ── Period query (GET /api/spending) ────────────────────────────────────────

export interface SpendingPeriodQuery {
  /** Inclusive start day, `YYYY-MM-DD` (server-local). */
  from?: string | null;
  /** Inclusive end day, `YYYY-MM-DD` (server-local). */
  to?: string | null;
  /** Legacy raw-type filter. */
  type?: string | null;
  /** Bucket filter: spending | income | ignore. */
  bucket?: string | null;
  limit: number;
  offset: number;
}

/**
 * Transactions in a period with bucket totals, the spending category
 * breakdown and the income flow split. Each row carries its `bucket` and an
 * `isRefund` flag (see refund.ts). This is exactly the GET /api/spending body.
 */
export async function getSpendingPeriod(
  userId: string,
  query: SpendingPeriodQuery,
  database: Database = getDb()
) {
  const { from, to, type, bucket: bucketFilter, limit, offset } = query;
  const [userRow] = await database
    .select({ tossMyName: users.tossMyName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tossMyName = userRow?.tossMyName ?? null;
  const bucket = bucketSql(tossMyName);
  const isRefund = refundSql(bucket);

  const conditions = [eq(transactions.userId, userId)];
  if (from) {
    const [fy, fm, fd] = from.split("-").map(Number);
    conditions.push(gte(transactions.transactedAt, new Date(fy, fm - 1, fd)));
  }
  if (to) {
    const [ty, tm, td] = to.split("-").map(Number);
    conditions.push(lte(transactions.transactedAt, new Date(ty, tm - 1, td + 1)));
  }
  if (type === "withdrawal" || type === "deposit") {
    conditions.push(eq(transactions.type, type));
  }
  const categoryConditions = [...conditions, sql`${bucket} = 'spending'`];
  const incomeWhere = and(...conditions);
  if (bucketFilter === "spending" || bucketFilter === "income" || bucketFilter === "ignore") {
    conditions.push(sql`${bucket} = ${bucketFilter}`);
  }

  const where = and(...conditions);

  const [rows, summaryRows, categoryRows, incomeRows] = await Promise.all([
    database
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        merchant: transactions.merchant,
        accountName: transactions.accountName,
        rawTitle: transactions.rawTitle,
        rawText: transactions.rawText,
        transactedAt: transactions.transactedAt,
        spendingOverride: transactions.spendingOverride,
        overrideNote: transactions.overrideNote,
        category: transactions.category,
        categorySource: transactions.categorySource,
        categoryConfidence: transactions.categoryConfidence,
        bucket: bucket.as("bucket"),
        isRefund: isRefund.as("is_refund"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(where)
      .orderBy(desc(transactions.transactedAt))
      .limit(limit + 1)
      .offset(offset),
    database
      .select({
        bucket: bucket.as("bucket"),
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
        count: sql<number>`count(*)`.as("count"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(where)
      .groupBy(sql`"bucket"`),
    database
      .select({
        category: transactions.category,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
        count: sql<number>`count(*)`.as("count"),
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(and(...categoryConditions))
      .groupBy(transactions.category)
      .orderBy(sql`sum(${transactions.amount}) desc`),
    selectIncomeGroups(database, incomeWhere, bucket),
  ]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const summary = {
    // Bucket-based totals
    totalSpending: 0,
    totalIncome: 0,
    totalIgnored: 0,
    spendingCount: 0,
    incomeCount: 0,
    ignoredCount: 0,
    // Legacy aliases (kept so existing UI keeps rendering totals)
    totalWithdrawal: 0,
    totalDeposit: 0,
    withdrawalCount: 0,
    depositCount: 0,
    categoryBreakdown: categoryRows.map((row) => ({
      category: row.category,
      total: Number(row.total),
      count: Number(row.count),
    })),
    flow: summarizeIncomeFlow(incomeRows),
  };

  for (const row of summaryRows) {
    const b = row.bucket as Bucket;
    const total = Number(row.total);
    const count = Number(row.count);
    if (b === "spending") {
      summary.totalSpending = total;
      summary.spendingCount = count;
    } else if (b === "income") {
      summary.totalIncome = total;
      summary.incomeCount = count;
    } else {
      summary.totalIgnored = total;
      summary.ignoredCount = count;
    }
  }
  summary.totalWithdrawal = summary.totalSpending;
  summary.withdrawalCount = summary.spendingCount;
  summary.totalDeposit = summary.totalIncome;
  summary.depositCount = summary.incomeCount;

  return {
    transactions: items.map((row) => ({ ...row, isRefund: Boolean(row.isRefund) })),
    summary,
    hasMore,
    count: items.length,
    limit,
    offset,
  };
}

// ── Transaction correction (PATCH /api/spending/transactions/:id) ───────────

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionCorrection = Partial<typeof transactions.$inferInsert>;

const ALLOWED_OVERRIDES = new Set(["include", "exclude"]);

/**
 * Validates a correction body — `spendingOverride` (include | exclude | null),
 * `overrideNote` (≤500 chars) and `category` (an expense category, or null to
 * send it back to AI classification) — into the column update. An empty
 * update is an error.
 */
export function parseTransactionCorrection(body: {
  spendingOverride?: unknown;
  overrideNote?: unknown;
  category?: unknown;
}): { value: TransactionCorrection } | { error: string } {
  const update: TransactionCorrection = {};

  if ("spendingOverride" in body) {
    const v = body.spendingOverride;
    if (v === null) {
      update.spendingOverride = null;
    } else if (typeof v === "string" && ALLOWED_OVERRIDES.has(v)) {
      update.spendingOverride = v;
    } else {
      return { error: "잘못된 spendingOverride 값" };
    }
  }

  if ("overrideNote" in body) {
    const note = body.overrideNote;
    update.overrideNote = note === null || note === undefined ? null : String(note).slice(0, 500);
  }

  if ("category" in body) {
    const category = body.category;
    if (category === null) {
      update.category = null;
      update.categorySource = null;
      update.categoryConfidence = null;
      update.categoryModel = null;
      update.categoryAttempts = 0;
      update.categoryError = null;
      update.categorizedAt = null;
    } else if (isExpenseCategory(category)) {
      update.category = category;
      update.categorySource = "manual";
      update.categoryConfidence = null;
      update.categoryModel = null;
      update.categoryError = null;
      update.categorizedAt = new Date();
    } else {
      return { error: "잘못된 category 값" };
    }
  }

  if (Object.keys(update).length === 0) return { error: "변경할 필드가 없습니다" };
  return { value: update };
}

const noopTransactionHook: InTxHook<TransactionRow> = async () => {};

/**
 * Applies a parsed correction to the owner's transaction in one transaction.
 * Returns the updated row, or null when it doesn't exist (or isn't theirs).
 * Re-queues the overview snapshots of the transaction's KST day.
 */
export async function correctTransaction(
  userId: string,
  transactionId: string,
  update: TransactionCorrection,
  { inTx = noopTransactionHook, database = getDb() }: WriteOptions<TransactionRow> = {}
): Promise<TransactionRow | null> {
  return database.transaction(async (tx) => {
    const where = and(eq(transactions.id, transactionId), eq(transactions.userId, userId));
    // FOR UPDATE: a concurrent correction waits here and then reads this one's
    // committed value, so an MCP expectedCurrent check can't pass twice.
    const [before] = await tx.select().from(transactions).where(where).for("update");
    if (!before) return null;
    const [after] = await tx.update(transactions).set(update).where(where).returning();
    if (!after) return null;
    await inTx(tx, { before, after });
    // Same transaction: the correction and the overview re-queue commit together.
    await invalidateOverviewDays(tx, userId, transactionDayRange(after.transactedAt));
    return after;
  });
}
