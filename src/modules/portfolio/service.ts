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
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const TOKEN_REFRESH_GRACE_MS = 60_000;

/**
 * Cached KIS access tokens are stored AES-GCM encrypted like the app
 * key/secret — a DB dump must not yield a live trading-API credential, even
 * a 24h one. Legacy plaintext rows (or rows written under a rotated
 * KIS_ENCRYPTION_KEY) fail decryption and are treated as absent, which just
 * triggers one re-issuance under the advisory lock below.
 */
function decryptTokenOrNull(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

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

function isoToYmd(iso: string): string {
  // "YYYY-MM-DD" → "YYYYMMDD". Stored openedAt / *BackfilledFrom use ISO.
  return iso.replaceAll("-", "");
}

function ymdToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function addDaysYmdStr(ymdStr: string, days: number): string {
  const y = Number(ymdStr.slice(0, 4));
  const m = Number(ymdStr.slice(4, 6));
  const d = Number(ymdStr.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(date.getUTCDate()).padStart(2, "0");
  return `${ny}${nm}${nd}`;
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

export interface AccountBackfillResult {
  accountId: string;
  label: string;
  executionsInserted: number;
  pnlUpserted: number;
  fromDate: string; // ISO YYYY-MM-DD
  toDate: string; // ISO YYYY-MM-DD
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
    const cachedToken = decryptTokenOrNull(account.accessToken);
    if (
      cachedToken &&
      account.accessTokenExpiresAt &&
      account.accessTokenExpiresAt.getTime() > now + TOKEN_REFRESH_GRACE_MS
    ) {
      return cachedToken;
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
      const freshToken = decryptTokenOrNull(fresh.accessToken);
      if (
        freshToken &&
        fresh.accessTokenExpiresAt &&
        fresh.accessTokenExpiresAt.getTime() > tNow + TOKEN_REFRESH_GRACE_MS
      ) {
        return freshToken;
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
          accessToken: encryptSecret(accessToken),
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

    // Snapshot upsert + position replace must be atomic, and concurrent
    // writers (cron + manual sync) must be serialized per account — otherwise
    // an interleaved delete/insert can leave duplicated or missing position
    // rows under the same snapshot, skewing rebalancing weights. Same advisory
    // lock idiom as token issuance above.
    const snapshotId = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kis-snapshot:${accountId}`}, 0))`
      );

      const snapshotRow = await tx
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

      const id = snapshotRow[0].id;

      // Replace positions for this snapshot (cascade delete via FK)
      await tx.delete(holdingPositions).where(eq(holdingPositions.snapshotId, id));

      if (parsed.positions.length > 0) {
        await tx.insert(holdingPositions).values(
          parsed.positions.map((p) => ({
            snapshotId: id,
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

      return id;
    });

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

    // Single multi-row upsert instead of one round-trip per trade date
    // (a 90-day window meant up to ~90 sequential queries).
    const upserted = await this.db
      .insert(brokerageDailyPnl)
      .values(
        rows.map((r) => ({
          accountId,
          tradeDate: r.tradeDate,
          buyAmount: String(r.buyAmount),
          sellAmount: String(r.sellAmount),
          realizedPnl: String(r.realizedPnl),
          fee: String(r.fee),
          tax: String(r.tax),
        }))
      )
      .onConflictDoUpdate({
        target: [brokerageDailyPnl.accountId, brokerageDailyPnl.tradeDate],
        set: {
          buyAmount: sql`excluded.buy_amount`,
          sellAmount: sql`excluded.sell_amount`,
          realizedPnl: sql`excluded.realized_pnl`,
          fee: sql`excluded.fee`,
          tax: sql`excluded.tax`,
        },
      })
      .returning({ id: brokerageDailyPnl.id });

    return { upserted: upserted.length };
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

  /**
   * Backfill executions + daily-pnl from `openedAt` up to the existing
   * watermark (or today). Idempotent: rows hit ON CONFLICT DO NOTHING /
   * DO UPDATE. KIS silently truncates execution queries to ~3 months, so
   * we use the adapter's slicing helper.
   *
   * After success, advances `executionsBackfilledFrom` / `pnlBackfilledFrom`
   * to the earliest date we attempted. Subsequent calls then become no-ops
   * unless `openedAt` moved earlier.
   */
  async backfillAccount(accountId: string): Promise<AccountBackfillResult> {
    const account = await this.getAccount(accountId);
    if (!account) {
      return {
        accountId,
        label: "(unknown)",
        executionsInserted: 0,
        pnlUpserted: 0,
        fromDate: "",
        toDate: "",
        error: "Account not found",
      };
    }

    const result: AccountBackfillResult = {
      accountId,
      label: account.label,
      executionsInserted: 0,
      pnlUpserted: 0,
      fromDate: "",
      toDate: "",
      error: null,
    };

    if (!account.openedAt) {
      result.error = "openedAt not set — set the account open date first";
      return result;
    }

    const openedIso = account.openedAt;
    const openedYmd = isoToYmd(openedIso);
    const todayYmd = ymd(new Date());

    result.fromDate = openedIso;
    result.toDate = ymdToIso(todayYmd);

    try {
      const adapter = this.getAdapter(account);
      const token = await this.getValidToken(account);

      // Executions: walk from today back to openedAt in 3-month windows.
      // The watermark tracks "what we've already covered" — if it's already
      // at or before openedAt, this is a no-op (no API calls needed).
      const execWatermarkYmd = account.executionsBackfilledFrom
        ? isoToYmd(account.executionsBackfilledFrom)
        : null;

      let execInserted = 0;
      if (!execWatermarkYmd || execWatermarkYmd > openedYmd) {
        // Pull range [openedYmd, execWatermarkYmd ?? today]. If watermark
        // exists we stop one day before it; the incremental syncExecutions
        // already covers [watermark, today].
        const execEnd = execWatermarkYmd ? addDaysYmdStr(execWatermarkYmd, -1) : todayYmd;
        if (execEnd >= openedYmd) {
          const executions = await adapter.inquireDailyCcldLongRange(
            token,
            account.cano,
            account.acntPrdtCd,
            openedYmd,
            execEnd
          );

          if (executions.length > 0) {
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
            execInserted = inserted.length;
          }
        }
      }
      result.executionsInserted = execInserted;

      // Daily P&L: single call covers the full range (KIS doesn't truncate
      // this TR). Same watermark logic.
      const pnlWatermarkYmd = account.pnlBackfilledFrom
        ? isoToYmd(account.pnlBackfilledFrom)
        : null;

      let pnlUpserted = 0;
      if (!pnlWatermarkYmd || pnlWatermarkYmd > openedYmd) {
        const pnlEnd = pnlWatermarkYmd ? addDaysYmdStr(pnlWatermarkYmd, -1) : todayYmd;
        if (pnlEnd >= openedYmd) {
          const rows = await adapter.inquirePeriodProfit(
            token,
            account.cano,
            account.acntPrdtCd,
            openedYmd,
            pnlEnd
          );

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
            pnlUpserted++;
          }
        }
      }
      result.pnlUpserted = pnlUpserted;

      await this.db
        .update(brokerageAccounts)
        .set({
          executionsBackfilledFrom: openedIso,
          pnlBackfilledFrom: openedIso,
          updatedAt: new Date(),
        })
        .where(eq(brokerageAccounts.id, accountId));

      logger.info("[Portfolio] Account backfilled", { ...result });
    } catch (err) {
      const code = err instanceof KISAuthError ? err.code : "BACKFILL_ERROR";
      const message = err instanceof Error ? err.message : String(err);
      result.error = `${code}: ${message}`;
      logger.error("[Portfolio] Account backfill failed", {
        accountId,
        label: account.label,
        error: result.error,
      });
    }

    return result;
  }

  /**
   * Find accounts owned by `userId` that have `openedAt` set but whose
   * backfill watermark hasn't caught up (or has never been set), then run
   * `backfillAccount` on each. Cron calls this after the regular sync so
   * a freshly-added open date triggers historical fetch on the next tick
   * without needing a manual button press.
   */
  async backfillPendingAccounts(userId: string): Promise<AccountBackfillResult[]> {
    const candidates = await this.db
      .select({
        id: brokerageAccounts.id,
        openedAt: brokerageAccounts.openedAt,
        executionsBackfilledFrom: brokerageAccounts.executionsBackfilledFrom,
        pnlBackfilledFrom: brokerageAccounts.pnlBackfilledFrom,
      })
      .from(brokerageAccounts)
      .where(and(eq(brokerageAccounts.userId, userId), eq(brokerageAccounts.isActive, true)));

    const pending = candidates.filter((a) => {
      if (!a.openedAt) return false;
      const execStale = !a.executionsBackfilledFrom || a.executionsBackfilledFrom > a.openedAt;
      const pnlStale = !a.pnlBackfilledFrom || a.pnlBackfilledFrom > a.openedAt;
      return execStale || pnlStale;
    });

    const results: AccountBackfillResult[] = [];
    for (const acc of pending) {
      results.push(await this.backfillAccount(acc.id));
    }
    return results;
  }

  /**
   * Sync all active accounts for a user.
   *
   * `skipIfSyncedWithinMs` implements the documented daily cadence for the
   * cron path: accounts synced more recently than the window are skipped, so
   * the 10-minute cron doesn't hammer KIS with ~144 sync rounds per day.
   * Manual sync routes omit it and always run.
   */
  async syncUserAccounts(
    userId: string,
    opts: { skipIfSyncedWithinMs?: number } = {}
  ): Promise<AccountSyncResult[]> {
    const accounts = await this.db
      .select()
      .from(brokerageAccounts)
      .where(and(eq(brokerageAccounts.userId, userId), eq(brokerageAccounts.isActive, true)));

    const cutoff = opts.skipIfSyncedWithinMs;
    const due = cutoff
      ? accounts.filter(
          (acc) => !acc.lastSyncedAt || Date.now() - acc.lastSyncedAt.getTime() >= cutoff
        )
      : accounts;

    const results: AccountSyncResult[] = [];
    for (const acc of due) {
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
