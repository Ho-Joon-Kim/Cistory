/**
 * Verification script for TWR / XIRR logic against the live dev DB.
 *
 * Usage:
 *   DATABASE_URL=postgresql://cistory:cistory@100.103.66.56:5432/cistory \
 *     npx tsx scripts/verify-returns.ts
 *
 * Prints, per account:
 *   - inferred cashflows
 *   - period-by-period TWR breakdown
 *   - final TWR (total + annualized) and XIRR
 *   - sanity checks against simple eval delta
 */

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { brokerageAccounts, brokerageExecutions, holdingSnapshots } from "../src/db/schema";
import {
  computeReturns,
  type ReturnExecution,
  type ReturnSnapshot,
} from "../src/modules/portfolio/returns";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://cistory:cistory@100.103.66.56:5432/cistory",
});
const db = drizzle(pool);

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(4)}%`;
}

function fmtKrw(v: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(v));
}

async function verifyAccount(accountId: string, label: string) {
  console.log("\n==============================");
  console.log(`Account: ${label} (${accountId})`);
  console.log("==============================");

  const rawSnapshots = await db
    .select({
      asOfDate: holdingSnapshots.asOfDate,
      totalEvalAmount: holdingSnapshots.totalEvalAmount,
      deposit: holdingSnapshots.deposit,
      totalPurchaseAmount: holdingSnapshots.totalPurchaseAmount,
    })
    .from(holdingSnapshots)
    .where(eq(holdingSnapshots.accountId, accountId))
    .orderBy(asc(holdingSnapshots.asOfDate));

  const rawExecutions = await db
    .select({
      ordDt: brokerageExecutions.ordDt,
      side: brokerageExecutions.side,
      filledAmount: brokerageExecutions.filledAmount,
      cancelled: brokerageExecutions.cancelled,
    })
    .from(brokerageExecutions)
    .where(eq(brokerageExecutions.accountId, accountId))
    .orderBy(asc(brokerageExecutions.ordDt));

  const snapshots: ReturnSnapshot[] = rawSnapshots.map((s) => ({
    asOfDate: s.asOfDate,
    totalEvalAmount: Number(s.totalEvalAmount),
    deposit: Number(s.deposit),
    totalPurchaseAmount: Number(s.totalPurchaseAmount),
  }));
  const executions: ReturnExecution[] = rawExecutions.map((e) => ({
    ordDt: e.ordDt,
    side: e.side as "buy" | "sell",
    filledAmount: Number(e.filledAmount),
    cancelled: e.cancelled,
  }));

  console.log(`Snapshots: ${snapshots.length}, Executions: ${executions.length}`);
  for (const s of snapshots) {
    console.log(
      `  ${s.asOfDate}  eval=${fmtKrw(s.totalEvalAmount)}  deposit=${fmtKrw(s.deposit)}` +
        `  purchase=${fmtKrw(s.totalPurchaseAmount)}  total=${fmtKrw(s.totalEvalAmount + s.deposit)}`
    );
  }

  const result = computeReturns({ snapshots, executions });

  console.log(`\n--- Inferred Cashflows (${result.cashflows.length}) ---`);
  for (const cf of result.cashflows) {
    console.log(
      `  ${cf.date}  ext=${fmtKrw(cf.amount)}  ` +
        `(depositΔ vs expected: ${fmtKrw(cf.inferredFrom.expectedDepositDelta)}, ` +
        `settledExec=${fmtKrw(cf.inferredFrom.settledExecutions)}, ` +
        `netExec(fill)=${fmtKrw(cf.inferredFrom.netExecutions)}, ` +
        `purchaseΔ=${fmtKrw(cf.inferredFrom.purchaseAmountDelta)})`
    );
  }
  if (result.cashflows.length === 0) console.log("  (none detected)");

  console.log(`\n--- TWR Periods ---`);
  for (const p of result.twr.periods) {
    console.log(
      `  ${p.date}  start=${fmtKrw(p.startValue)} end=${fmtKrw(p.endValue)} ` +
        `cf=${fmtKrw(p.cashflow)} r=${fmtPct(p.periodReturn)} cum=${fmtPct(p.cumulativeReturn)}`
    );
  }

  console.log(`\n--- Final Metrics ---`);
  console.log(`  Period: ${result.startDate} → ${result.endDate} (${result.twr.days.toFixed(1)}d)`);
  console.log(`  Start value: ${fmtKrw(result.startValue)}`);
  console.log(`  End value:   ${fmtKrw(result.endValue)}`);
  console.log(`  TWR total:        ${fmtPct(result.twr.totalReturn)}`);
  console.log(`  TWR annualized:   ${fmtPct(result.twr.annualizedReturn)}`);
  console.log(`  XIRR (annualized): ${fmtPct(result.xirr)}`);

  // Sanity checks
  console.log(`\n--- Sanity Checks ---`);
  if (result.startValue > 0) {
    const naiveDelta = result.endValue / result.startValue - 1;
    console.log(`  Naive eval delta (ignores cashflows): ${fmtPct(naiveDelta)}`);
    const totalCf = result.cashflows.reduce((s, c) => s + c.amount, 0);
    console.log(`  Total external cashflow:              ${fmtKrw(totalCf)}`);
    if (Math.abs(totalCf) < 1000) {
      console.log(
        `  ✓ No significant cashflows → TWR should ≈ naive delta. ` +
          `Diff: ${fmtPct((result.twr.totalReturn ?? 0) - naiveDelta)}`
      );
    } else {
      console.log(
        `  ! Cashflows present → naive delta is misleading. TWR removes cashflow effect.`
      );
      if (totalCf > 0 && (result.twr.totalReturn ?? 0) < naiveDelta) {
        console.log(`  ✓ TWR < naive delta (good: deposit inflated naive number)`);
      } else if (totalCf > 0 && (result.twr.totalReturn ?? 0) >= naiveDelta) {
        console.log(`  ⚠ TWR >= naive delta despite deposits. Investigate.`);
      }
    }
    if (result.twr.totalReturn !== null && result.xirr !== null) {
      const sameSign =
        (result.twr.totalReturn > 0 && result.xirr > 0) ||
        (result.twr.totalReturn < 0 && result.xirr < 0) ||
        (result.twr.totalReturn === 0 && result.xirr === 0);
      console.log(
        sameSign
          ? `  ✓ TWR and XIRR have the same sign`
          : `  ⚠ TWR and XIRR have different signs`
      );
    }
  }
}

async function main() {
  const accounts = await db.select().from(brokerageAccounts).orderBy(brokerageAccounts.label);
  for (const a of accounts) {
    await verifyAccount(a.id, a.label);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
