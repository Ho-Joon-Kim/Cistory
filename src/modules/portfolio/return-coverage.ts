import type { ReturnSnapshot } from "./returns";

export interface ReturnCoverage {
  accountCount: number;
  completeDates: number;
  excludedDates: string[];
}

interface AccountSnapshot {
  accountId: string;
  asOfDate: string;
  totalEvalAmount: string | number;
  deposit: string | number;
  totalPurchaseAmount: string | number;
}

/**
 * Compare the same selected accounts at both endpoints. Missing snapshots are
 * unknown valuations, never zero or a price carried forward from another day.
 * This can shorten the reported range; the API and UI expose that explicitly.
 */
export function aggregateReturnSnapshots(rows: AccountSnapshot[], accountIds: string[]) {
  const expected = new Set(accountIds);
  const byDate = new Map<string, Map<string, AccountSnapshot>>();
  for (const row of rows) {
    if (!expected.has(row.accountId)) continue;
    const accounts = byDate.get(row.asOfDate) ?? new Map<string, AccountSnapshot>();
    accounts.set(row.accountId, row);
    byDate.set(row.asOfDate, accounts);
  }
  const snapshots: ReturnSnapshot[] = [];
  const excludedDates: string[] = [];
  for (const [asOfDate, accounts] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    if (accounts.size !== expected.size) {
      excludedDates.push(asOfDate);
      continue;
    }
    const snapshot: ReturnSnapshot = {
      asOfDate,
      totalEvalAmount: 0,
      deposit: 0,
      totalPurchaseAmount: 0,
    };
    for (const row of accounts.values()) {
      snapshot.totalEvalAmount += Number(row.totalEvalAmount);
      snapshot.deposit += Number(row.deposit);
      snapshot.totalPurchaseAmount += Number(row.totalPurchaseAmount);
    }
    snapshots.push(snapshot);
  }
  const coverage: ReturnCoverage = {
    accountCount: expected.size,
    completeDates: snapshots.length,
    excludedDates,
  };
  return { snapshots, coverage };
}
