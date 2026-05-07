import { and, eq, sql } from "drizzle-orm";
import { accountRoles, transactions } from "@/db/schema";

export type Bucket = "spending" | "income" | "ignore";
export type AccountRole = "spending" | "default" | "ignore";

export type ClassifyInput = {
  type: string;
  amount: number;
  merchant: string;
  accountName: string;
  isSelfTransfer: boolean;
  spendingOverride: string | null;
};

export function classify(
  tx: ClassifyInput,
  roleByAccount: Map<string, AccountRole>,
  tossMyName: string | null
): Bucket {
  if (tx.spendingOverride === "include") return "spending";
  if (tx.spendingOverride === "exclude") return "ignore";

  const role = roleByAccount.get(tx.accountName) ?? "default";
  if (role === "ignore") return "ignore";
  if (role === "spending") {
    return tx.type === "deposit" ? "spending" : "ignore";
  }

  if (tx.isSelfTransfer) return "ignore";
  if (tossMyName && tx.merchant === tossMyName) return "ignore";
  return tx.type === "withdrawal" ? "spending" : "income";
}

/**
 * SQL fragment that resolves to the bucket ('spending'|'income'|'ignore') for
 * each transaction row. Requires the query to LEFT JOIN account_roles via
 * `accountRolesJoin` so that `account_roles.role` is in scope.
 */
export function bucketSql(tossMyName: string | null) {
  const myNameClause =
    tossMyName !== null ? sql`AND ${transactions.merchant} <> ${tossMyName}` : sql``;
  return sql<Bucket>`CASE
    WHEN ${transactions.spendingOverride} = 'include' THEN 'spending'
    WHEN ${transactions.spendingOverride} = 'exclude' THEN 'ignore'
    WHEN COALESCE(${accountRoles.role}, 'default') = 'ignore' THEN 'ignore'
    WHEN COALESCE(${accountRoles.role}, 'default') = 'spending' THEN
      CASE WHEN ${transactions.type} = 'deposit' THEN 'spending' ELSE 'ignore' END
    WHEN ${transactions.isSelfTransfer} = true THEN 'ignore'
    WHEN ${transactions.type} = 'withdrawal' ${myNameClause} THEN 'spending'
    WHEN ${transactions.type} = 'deposit' THEN 'income'
    ELSE 'ignore'
  END`;
}

/**
 * Join condition for use with `.leftJoin(accountRoles, accountRolesJoinOn)`.
 * Matches by (userId, accountName).
 */
export const accountRolesJoinOn = and(
  eq(accountRoles.userId, transactions.userId),
  eq(accountRoles.accountName, transactions.accountName)
);
