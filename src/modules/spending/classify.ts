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
  /**
   * A withdrawal of the same amount from another account landed within
   * ±MIRROR_WINDOW of this row — i.e. this deposit is the receiving side of a
   * transfer already recorded as spending at its source. SQL derives it with
   * `mirrorWithdrawalExistsSql`; in-memory callers pass it explicitly.
   */
  mirroredByWithdrawal?: boolean;
  /**
   * A later `cancel` row voids this withdrawal (same account, merchant and
   * amount within CANCEL_WINDOW). SQL derives it with `cancelledSql`.
   */
  cancelled?: boolean;
};

/**
 * A 'spending' account (모임통장 등) counts deposits as the user's spending,
 * but only deposits the user made: other members' contributions and interest
 * land in the same account and are not the user's money. And when the user's
 * own contribution is also visible as a withdrawal from their main account
 * (e.g. a parsed 자동이체), that withdrawal already counts — the deposit is
 * its mirror and counting both doubles it. The two notifications arrive
 * ~100 ms apart in practice; two minutes matches the ingestion dup window.
 */
const MIRROR_WINDOW = "2 minutes";

/**
 * How long after a payment its "결제 취소" may arrive. Taxi pre-authorizations
 * are voided within the hour; merchant refunds can take days.
 */
const CANCEL_WINDOW = "30 days";

function isOwnDeposit(tx: ClassifyInput, tossMyName: string | null): boolean {
  return tx.isSelfTransfer || (tossMyName !== null && tx.merchant === tossMyName);
}

export function classify(
  tx: ClassifyInput,
  roleByAccount: Map<string, AccountRole>,
  tossMyName: string | null
): Bucket {
  if (tx.spendingOverride === "include") return "spending";
  if (tx.spendingOverride === "exclude") return "ignore";
  if (tx.type === "cancel") return "ignore";
  if (tx.type === "withdrawal" && tx.cancelled) return "ignore";

  const role = roleByAccount.get(tx.accountName) ?? "default";
  if (role === "ignore") return "ignore";
  if (role === "spending") {
    return tx.type === "deposit" && isOwnDeposit(tx, tossMyName) && !tx.mirroredByWithdrawal
      ? "spending"
      : "ignore";
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
  const ownDeposit =
    tossMyName !== null
      ? sql`(${transactions.isSelfTransfer} = true OR ${transactions.merchant} = ${tossMyName})`
      : sql`${transactions.isSelfTransfer} = true`;
  return sql<Bucket>`CASE
    WHEN ${transactions.spendingOverride} = 'include' THEN 'spending'
    WHEN ${transactions.spendingOverride} = 'exclude' THEN 'ignore'
    WHEN ${transactions.type} = 'cancel' THEN 'ignore'
    WHEN ${transactions.type} = 'withdrawal' AND ${cancelledSql()} THEN 'ignore'
    WHEN COALESCE(${accountRoles.role}, 'default') = 'ignore' THEN 'ignore'
    WHEN COALESCE(${accountRoles.role}, 'default') = 'spending' THEN
      CASE
        WHEN ${transactions.type} = 'deposit' AND ${ownDeposit}
          AND NOT ${mirrorWithdrawalExistsSql()} THEN 'spending'
        ELSE 'ignore'
      END
    WHEN ${transactions.isSelfTransfer} = true THEN 'ignore'
    WHEN ${transactions.type} = 'withdrawal' ${myNameClause} THEN 'spending'
    WHEN ${transactions.type} = 'deposit' THEN 'income'
    ELSE 'ignore'
  END`;
}

/**
 * EXISTS predicate: the classified `transactions` row has a same-amount
 * withdrawal from a different account within ±MIRROR_WINDOW. Correlates on the
 * nearest enclosing unaliased `transactions`, so it works inside the travel
 * module's scalar subquery as well as top-level queries.
 */
export function mirrorWithdrawalExistsSql() {
  return sql`EXISTS (
    SELECT 1 FROM ${transactions} AS mirror
    WHERE mirror.user_id = ${transactions.userId}
      AND mirror.type = 'withdrawal'
      AND mirror.amount = ${transactions.amount}
      AND mirror.account_name <> ${transactions.accountName}
      AND mirror.transacted_at BETWEEN ${transactions.transactedAt} - interval '${sql.raw(MIRROR_WINDOW)}'
        AND ${transactions.transactedAt} + interval '${sql.raw(MIRROR_WINDOW)}'
  )`;
}

/**
 * EXISTS predicate: a `cancel` row for the classified withdrawal — same
 * account, merchant and amount, arriving within CANCEL_WINDOW after it.
 * Correlates the same way as `mirrorWithdrawalExistsSql`. Not one-to-one: one
 * cancel voids every identical payment in the window, which only matters for
 * same-amount repeat purchases at one merchant where just one was refunded.
 */
export function cancelledSql() {
  return sql`EXISTS (
    SELECT 1 FROM ${transactions} AS cancel
    WHERE cancel.user_id = ${transactions.userId}
      AND cancel.type = 'cancel'
      AND cancel.account_name = ${transactions.accountName}
      AND cancel.merchant = ${transactions.merchant}
      AND cancel.amount = ${transactions.amount}
      AND cancel.transacted_at BETWEEN ${transactions.transactedAt}
        AND ${transactions.transactedAt} + interval '${sql.raw(CANCEL_WINDOW)}'
  )`;
}

/**
 * Join condition for use with `.leftJoin(accountRoles, accountRolesJoinOn)`.
 * Matches by (userId, accountName).
 */
export const accountRolesJoinOn = and(
  eq(accountRoles.userId, transactions.userId),
  eq(accountRoles.accountName, transactions.accountName)
);
