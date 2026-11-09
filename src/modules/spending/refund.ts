import { sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * Refunds inside income.
 *
 * Toss reports a refund as an ordinary deposit from the merchant (한국철도공사
 * returning a cancelled KTX ticket, 쿠팡이츠 refunding an order), so it lands in
 * the `income` bucket next to money friends send. Buckets stay as they are — a
 * refund is still not spending — but the spending page nets refunds out of
 * spending ("순지출") and shows the rest as "받은 돈".
 *
 * A deposit is a refund when its payer is a merchant the user has paid for a
 * categorized purchase. People (transfers, 경조·선물) and financial payees are
 * excluded: money back from a friend you once sent a gift to is not a refund.
 */

/** Categories whose payees are people or institutions rather than shops. */
export const NON_PURCHASE_CATEGORIES = ["gift", "finance"] as const;

/**
 * The payer name without Toss's `_suffix` ("한국철도공사_토스 원클릭결제" and
 * "한국철도공사_" are both "한국철도공사").
 */
export function merchantBase(merchant: string): string {
  return merchant.split("_")[0].trim();
}

export interface RefundCandidate {
  type: string;
  bucket: string;
  merchant: string;
}

/** In-memory mirror of {@link refundSql} given the user's purchase payees. */
export function isRefundDeposit(tx: RefundCandidate, purchaseMerchants: Set<string>): boolean {
  if (tx.type !== "deposit" || tx.bucket !== "income") return false;
  const base = merchantBase(tx.merchant);
  return base !== "" && purchaseMerchants.has(base);
}

/**
 * Boolean SQL for "this row is a refund". `bucket` is the row's bucketSql()
 * expression (the query must LEFT JOIN account_roles). Correlates on the
 * enclosing unaliased `transactions`, like the classify.ts predicates.
 */
export function refundSql(bucket: ReturnType<typeof sql>) {
  const excluded = sql.join(
    NON_PURCHASE_CATEGORIES.map((c) => sql`${c}`),
    sql`, `
  );
  return sql<boolean>`(${transactions.type} = 'deposit' AND ${bucket} = 'income' AND EXISTS (
    SELECT 1 FROM ${transactions} AS purchase
    WHERE purchase.user_id = ${transactions.userId}
      AND purchase.type = 'withdrawal'
      AND purchase.category IS NOT NULL
      AND purchase.category NOT IN (${excluded})
      AND btrim(split_part(purchase.merchant, '_', 1)) = btrim(split_part(${transactions.merchant}, '_', 1))
      AND btrim(split_part(${transactions.merchant}, '_', 1)) <> ''
  ))`;
}

export interface IncomeGroupRow {
  isRefund: boolean;
  merchant: string;
  accountName: string;
  total: number;
  count: number;
}

export interface IncomeFlow {
  refundTotal: number;
  refundCount: number;
  /** The payer behind most refunded money ("한국철도공사"), null without refunds. */
  refundTopMerchant: string | null;
  /** Income that is not a refund: "받은 돈". */
  inflowTotal: number;
  inflowCount: number;
  /** The account most of that money arrived in, null without any. */
  inflowTopAccount: string | null;
}

function topKey(totals: Map<string, number>): string | null {
  let best: string | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const [key, value] of totals) {
    if (value > bestValue || (value === bestValue && best !== null && key < best)) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

/** Folds income rows grouped by (isRefund, merchant, account) into the cash-flow split. */
export function summarizeIncomeFlow(rows: IncomeGroupRow[]): IncomeFlow {
  const refundByMerchant = new Map<string, number>();
  const inflowByAccount = new Map<string, number>();
  const flow: IncomeFlow = {
    refundTotal: 0,
    refundCount: 0,
    refundTopMerchant: null,
    inflowTotal: 0,
    inflowCount: 0,
    inflowTopAccount: null,
  };
  for (const row of rows) {
    const total = Number(row.total);
    const count = Number(row.count);
    if (row.isRefund) {
      flow.refundTotal += total;
      flow.refundCount += count;
      const base = merchantBase(row.merchant);
      refundByMerchant.set(base, (refundByMerchant.get(base) ?? 0) + total);
    } else {
      flow.inflowTotal += total;
      flow.inflowCount += count;
      inflowByAccount.set(row.accountName, (inflowByAccount.get(row.accountName) ?? 0) + total);
    }
  }
  flow.refundTopMerchant = topKey(refundByMerchant);
  flow.inflowTopAccount = topKey(inflowByAccount);
  return flow;
}
