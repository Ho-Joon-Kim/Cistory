import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  type BrokerageAccount,
  brokerageAccounts,
  brokerageDailyPnl,
  brokerageExecutions,
  holdingPositions,
  holdingSnapshots,
} from "@/db/schema";
import { createKISAdapter, KISAuthError, type ParsedBalance } from "@/lib/adapters/kis/interface";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const TOKEN_REFRESH_GRACE_MS = 60_000;

function todayKstDateString(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function ymd(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date).replaceAll("-", "");
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

export interface AccountSyncResult {
  accountId: string;
  label: string;
  snapshotId: string | null;
  positionsCount: number;
  executionsInserted: number;
  dailyPnlUpserted: number;
  error: string | null;
}

export class PortfolioSyncService {
  constructor(private db: Database) {}

  private async getAccount(accountId: string): Promise<BrokerageAccount | null> {
    const rows = await this.db
      .select()
      .from(brokerageAccounts)
      .where(eq(brokerageAccounts.id, accountId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getValidToken(account: BrokerageAccount): Promise<string> {
    const now = Date.now();
    if (
      account.accessToken &&
      account.accessTokenExpiresAt &&
      account.accessTokenExpiresAt.getTime() > now + TOKEN_REFRESH_GRACE_MS
    ) {
      return account.accessToken;
    }

    // KIS enforces a "1 token per day" policy and rate-limits frequent
    // re-issuance. Serialize issuance per-account with a Postgres advisory
    // lock so two concurrent syncs (cron + manual, multi-worker, etc.) can't
    // each call /oauth2/tokenP. Re-read the row inside the lock so the
    // second waiter sees the freshly-issued token instead of re-issuing.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kis-token:${account.id}`}, 0))`
      );

      const fresh = (
        await tx
          .select({
            accessToken: brokerageAccounts.accessToken,
            accessTokenExpiresAt: brokerageAccounts.accessTokenExpiresAt,
            appKeyEnc: brokerageAccounts.appKeyEnc,
            appSecretEnc: brokerageAccounts.appSecretEnc,
          })
          .from(brokerageAccounts)
          .where(eq(brokerageAccounts.id, account.id))
          .limit(1)
      )[0];

      if (!fresh) {
        throw new Error(`Brokerage account ${account.id} disappeared during token refresh`);
      }

      const tNow = Date.now();
      if (
        fresh.accessToken &&
        fresh.accessTokenExpiresAt &&
        fresh.accessTokenExpiresAt.getTime() > tNow + TOKEN_REFRESH_GRACE_MS
      ) {
        return fresh.accessToken;
      }

      const appKey = decryptSecret(fresh.appKeyEnc);
      const appSecret = decryptSecret(fresh.appSecretEnc);
      const adapter = createKISAdapter(appKey, appSecret);

      const { accessToken, expiresAt } = await adapter.issueToken();

      logger.info("[KIS] Token issued", {
        accountId: account.id,
        previousExpiresAt: fresh.accessTokenExpiresAt?.toISOString() ?? null,
        newExpiresAt: expiresAt.toISOString(),
        msSincePrevious: fresh.accessTokenExpiresAt
          ? tNow - (fresh.accessTokenExpiresAt.getTime() - 24 * 60 * 60 * 1000)
          : null,
      });

      await tx
        .update(brokerageAccounts)
        .set({
          accessToken,
          accessTokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(brokerageAccounts.id, account.id));

      return accessToken;
    });
  }

  private getAdapter(account: BrokerageAccount) {
    const appKey = decryptSecret(account.appKeyEnc);
    const appSecret = decryptSecret(account.appSecretEnc);
    return createKISAdapter(appKey, appSecret);
  }

  async snapshotAccount(
    accountId: string,
    balance?: ParsedBalance,
    sharedAdapter?: ReturnType<typeof createKISAdapter>
  ): Promise<{ snapshotId: string; positionCount: number }> {
    const account = await this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    let parsed = balance;
    if (!parsed) {
      const token = await this.getValidToken(account);
      const adapter = sharedAdapter ?? this.getAdapter(account);
      parsed = await adapter.inquireBalance(token, account.cano, account.acntPrdtCd);
    }

    const asOfDate = todayKstDateString();
    const now = new Date();
    const summaryRaw = JSON.stringify(parsed.summary.raw);

    const snapshotRow = await this.db
      .insert(holdingSnapshots)
      .values({
        accountId,
        takenAt: now,
        asOfDate,
        totalEvalAmount: String(parsed.summary.totalEvalAmount),
        securitiesEvalAmount: String(parsed.summary.securitiesEvalAmount),
        deposit: String(parsed.summary.deposit),
        totalPurchaseAmount: String(parsed.summary.totalPurchaseAmount),
        totalPnl: String(parsed.summary.totalPnl),
        totalPnlRate:
          parsed.summary.totalPnlRate !== null ? String(parsed.summary.totalPnlRate) : null,
        realizedPnl:
          parsed.summary.realizedPnl !== null ? String(parsed.summary.realizedPnl) : null,
        prevDayTotalAsset:
          parsed.summary.prevDayTotalAsset !== null
            ? String(parsed.summary.prevDayTotalAsset)
            : null,
        assetIcdcAmt:
          parsed.summary.assetIcdcAmt !== null ? String(parsed.summary.assetIcdcAmt) : null,
        rawOutput2: summaryRaw,
      })
      .onConflictDoUpdate({
        target: [holdingSnapshots.accountId, holdingSnapshots.asOfDate],
        set: {
          takenAt: now,
          totalEvalAmount: String(parsed.summary.totalEvalAmount),
          securitiesEvalAmount: String(parsed.summary.securitiesEvalAmount),
          deposit: String(parsed.summary.deposit),
          totalPurchaseAmount: String(parsed.summary.totalPurchaseAmount),
          totalPnl: String(parsed.summary.totalPnl),
          totalPnlRate:
            parsed.summary.totalPnlRate !== null ? String(parsed.summary.totalPnlRate) : null,
          realizedPnl:
            parsed.summary.realizedPnl !== null ? String(parsed.summary.realizedPnl) : null,
          prevDayTotalAsset:
            parsed.summary.prevDayTotalAsset !== null
              ? String(parsed.summary.prevDayTotalAsset)
              : null,
          assetIcdcAmt:
            parsed.summary.assetIcdcAmt !== null ? String(parsed.summary.assetIcdcAmt) : null,
          rawOutput2: summaryRaw,
        },
      })
      .returning({ id: holdingSnapshots.id });

    const snapshotId = snapshotRow[0].id;

    // Replace positions for this snapshot (cascade delete via FK)
    await this.db.delete(holdingPositions).where(eq(holdingPositions.snapshotId, snapshotId));

    if (parsed.positions.length > 0) {
      await this.db.insert(holdingPositions).values(
        parsed.positions.map((p) => ({
          snapshotId,
          ticker: p.ticker,
          name: p.name,
          quantity: String(p.quantity),
          avgPrice: String(p.avgPrice),
          currentPrice: String(p.currentPrice),
          evalAmount: String(p.evalAmount),
          pnl: String(p.pnl),
          pnlRate: p.pnlRate !== null ? String(p.pnlRate) : null,
          weight: String(p.weight),
          market: p.raw.trad_dvsn_name ?? null,
          rawData: JSON.stringify(p.raw),
        }))
      );
    }

    return { snapshotId, positionCount: parsed.positions.length };
  }

  async syncExecutions(
    accountId: string,
    options: { startDt?: string; endDt?: string } = {},
    sharedAdapter?: ReturnType<typeof createKISAdapter>
  ): Promise<{ inserted: number }> {
    const account = await this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const token = await this.getValidToken(account);
    const adapter = sharedAdapter ?? this.getAdapter(account);

    const endDt = options.endDt ?? ymd(new Date());
    let startDt = options.startDt;

    if (!startDt) {
      // Incremental: pick from last stored execution date, fallback 90 days
      const last = await this.db
        .select({ ordDt: brokerageExecutions.ordDt })
        .from(brokerageExecutions)
        .where(eq(brokerageExecutions.accountId, accountId))
        .orderBy(desc(brokerageExecutions.ordDt))
        .limit(1);
      startDt = last[0]?.ordDt ?? daysAgoYmd(90);
    }

    const executions = await adapter.inquireDailyCcld(
      token,
      account.cano,
      account.acntPrdtCd,
      startDt,
      endDt
    );

    if (executions.length === 0) return { inserted: 0 };

    const inserted = await this.db
      .insert(brokerageExecutions)
      .values(
        executions.map((e) => ({
          accountId,
          odno: e.odno,
          ordDt: e.ordDt,
          ordTime: e.ordTime,
          side: e.side,
          ticker: e.ticker,
          name: e.name,
          orderQty: String(e.orderQty),
          filledQty: String(e.filledQty),
          filledAmount: String(e.filledAmount),
          avgPrice: String(e.avgPrice),
          cancelled: e.cancelled,
          rawData: JSON.stringify(e.raw),
        }))
      )
      .onConflictDoNothing({
        target: [
          brokerageExecutions.accountId,
          brokerageExecutions.odno,
          brokerageExecutions.ordDt,
        ],
      })
      .returning({ id: brokerageExecutions.id });

    return { inserted: inserted.length };
  }

  async syncDailyPnl(
    accountId: string,
    options: { startDt?: string; endDt?: string } = {},
    sharedAdapter?: ReturnType<typeof createKISAdapter>
  ): Promise<{ upserted: number }> {
    const account = await this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const token = await this.getValidToken(account);
    const adapter = sharedAdapter ?? this.getAdapter(account);

    const startDt = options.startDt ?? daysAgoYmd(90);
    const endDt = options.endDt ?? ymd(new Date());

    const rows = await adapter.inquirePeriodProfit(
      token,
      account.cano,
      account.acntPrdtCd,
      startDt,
      endDt
    );

    if (rows.length === 0) return { upserted: 0 };

    let count = 0;
    for (const r of rows) {
      await this.db
        .insert(brokerageDailyPnl)
        .values({
          accountId,
          tradeDate: r.tradeDate,
          buyAmount: String(r.buyAmount),
          sellAmount: String(r.sellAmount),
          realizedPnl: String(r.realizedPnl),
          fee: String(r.fee),
          tax: String(r.tax),
        })
        .onConflictDoUpdate({
          target: [brokerageDailyPnl.accountId, brokerageDailyPnl.tradeDate],
          set: {
            buyAmount: String(r.buyAmount),
            sellAmount: String(r.sellAmount),
            realizedPnl: String(r.realizedPnl),
            fee: String(r.fee),
            tax: String(r.tax),
          },
        });
      count++;
    }

    return { upserted: count };
  }

  async syncAccount(accountId: string): Promise<AccountSyncResult> {
    const account = await this.getAccount(accountId);
    if (!account) {
      return {
        accountId,
        label: "(unknown)",
        snapshotId: null,
        positionsCount: 0,
        executionsInserted: 0,
        dailyPnlUpserted: 0,
        error: "Account not found",
      };
    }

    const result: AccountSyncResult = {
      accountId,
      label: account.label,
      snapshotId: null,
      positionsCount: 0,
      executionsInserted: 0,
      dailyPnlUpserted: 0,
      error: null,
    };

    try {
      // Reuse one adapter across all calls for this account so its internal
      // throttle (lastCallAt) actually paces back-to-back TR requests against
      // KIS's 2-3 req/sec personal-account limit.
      const adapter = this.getAdapter(account);

      const snap = await this.snapshotAccount(accountId, undefined, adapter);
      result.snapshotId = snap.snapshotId;
      result.positionsCount = snap.positionCount;

      const ex = await this.syncExecutions(accountId, {}, adapter);
      result.executionsInserted = ex.inserted;

      const pnl = await this.syncDailyPnl(accountId, {}, adapter);
      result.dailyPnlUpserted = pnl.upserted;

      await this.db
        .update(brokerageAccounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
        .where(eq(brokerageAccounts.id, accountId));

      logger.info("[Portfolio] Account synced", { ...result });
    } catch (err) {
      const code = err instanceof KISAuthError ? err.code : "SYNC_ERROR";
      const message = err instanceof Error ? err.message : String(err);
      result.error = `${code}: ${message}`;

      await this.db
        .update(brokerageAccounts)
        .set({ lastSyncError: result.error, updatedAt: new Date() })
        .where(eq(brokerageAccounts.id, accountId));

      logger.error("[Portfolio] Account sync failed", {
        accountId,
        label: account.label,
        error: result.error,
      });
    }

    return result;
  }

  async syncUserAccounts(userId: string): Promise<AccountSyncResult[]> {
    const accounts = await this.db
      .select()
      .from(brokerageAccounts)
      .where(and(eq(brokerageAccounts.userId, userId), eq(brokerageAccounts.isActive, true)));

    const results: AccountSyncResult[] = [];
    for (const acc of accounts) {
      results.push(await this.syncAccount(acc.id));
    }
    return results;
  }

  async hasActiveAccounts(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(brokerageAccounts)
      .where(and(eq(brokerageAccounts.userId, userId), eq(brokerageAccounts.isActive, true)));
    return (rows[0]?.count ?? 0) > 0;
  }
}

export function createPortfolioSyncService(db: Database): PortfolioSyncService {
  return new PortfolioSyncService(db);
}
