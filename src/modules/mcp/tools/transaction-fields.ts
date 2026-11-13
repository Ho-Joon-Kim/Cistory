/**
 * The transaction serializer every MCP tool that emits Toss transactions uses
 * (`spending`, `trip_detail`, and `search`'s spending rows).
 *
 * R6 as amended by the plan: without `sensitive-read`
 *  - `rawTitle` / `rawText` (the notification text) are omitted,
 *  - `accountName` is masked on every row,
 *  - `merchant` is masked only on personal transfers (`isPersonalTransfer`),
 *    where it holds a person's name; card-payment merchants stay visible.
 */

import { isPersonalTransfer, type TransferEvidence } from "@/modules/transaction/parser";
import { type Allowlist, MASK, type SerializeAccess, serializeRows } from "../serialize";
import { kstTime } from "./common";

export interface McpTransactionRow extends TransferEvidence {
  id: string;
  type?: string | null;
  amount: number;
  merchant: string;
  accountName: string;
  transactedAt: Date;
  category?: string | null;
  categorySource?: string | null;
  bucket?: string | null;
  isRefund?: boolean | null;
  spendingOverride?: string | null;
  overrideNote?: string | null;
}

export const TRANSACTION_ALLOWLIST: Allowlist<McpTransactionRow> = {
  id: true,
  type: true,
  amount: { map: (v) => (v == null ? null : Number(v)) },
  merchant: { sensitive: "mask", sensitiveWhen: (row) => isPersonalTransfer(row) },
  accountName: { sensitive: "mask" },
  transactedAt: kstTime,
  category: true,
  categorySource: true,
  bucket: true,
  isRefund: true,
  spendingOverride: true,
  overrideNote: true,
  isPersonalTransfer: { map: (_v, row) => isPersonalTransfer(row) },
  rawTitle: { sensitive: "omit" },
  rawText: { sensitive: "omit" },
};

export function serializeTransactions(
  rows: readonly McpTransactionRow[],
  access: SerializeAccess
): Record<string, unknown>[] {
  return serializeRows(rows, TRANSACTION_ALLOWLIST, access);
}

/** Mask a counterparty-bearing string (e.g. a search title) for a personal transfer. */
export function maskIfPersonalTransfer(
  value: string,
  evidence: TransferEvidence | undefined,
  access: SerializeAccess
): string {
  if (access.sensitive) return value;
  // No evidence (row vanished between queries): err on the side of hiding.
  if (!evidence || isPersonalTransfer(evidence)) return MASK;
  return value;
}
