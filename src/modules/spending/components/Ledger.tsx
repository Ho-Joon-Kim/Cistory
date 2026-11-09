"use client";

import { useState } from "react";
import { CategoryMark, LedgerMark } from "@/components/ds";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime, formatDay, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  SPENDING_CATEGORY_LABELS,
} from "../categories";
import type { TransactionItem } from "../hooks";
import {
  type FlagContext,
  type LedgerDay,
  type LedgerRow,
  refundFlag,
  rowFlag,
  rowMark,
  rowTag,
  signedAmount,
  txTime,
} from "../view-model";
import { ActionButton } from "./parts";

export interface LedgerActions {
  onCategory: (id: string, category: ExpenseCategory) => Promise<boolean>;
  onOverride: (id: string, value: "include" | "exclude" | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

const ROW_GRID =
  "grid min-h-11 w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-0 bg-transparent px-0 py-3 text-left text-ink transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand sm:grid-cols-[52px_28px_minmax(0,1fr)_auto_140px] sm:gap-4 sm:px-2 [@media(hover:hover)]:hover:bg-sunken";

function Flag({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[22px] flex-none items-center rounded-full px-2 text-xs font-medium whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_var(--line)]">
      {label}
    </span>
  );
}

function Mark({ tx }: { tx: TransactionItem }) {
  const mark = rowMark(tx);
  return mark.kind === "category" ? (
    <CategoryMark category={mark.category} />
  ) : (
    <LedgerMark kind={mark.mark} />
  );
}

function classification(tx: TransactionItem): string {
  if (tx.type === "cancel") return "결제 취소 · 원래 결제와 함께 집계에서 빠져요";
  if (tx.isRefund) return "환불 · 순지출에서 차감";
  if (tx.spendingOverride === "exclude") return "직접 집계에서 제외";
  if (tx.bucket === "ignore") return "내 계좌 간 이체 · 집계 제외";
  if (tx.bucket === "income") return "입금";
  if (!tx.category) return "분류 중";
  const label = EXPENSE_CATEGORY_LABELS[tx.category];
  if (tx.categorySource === "manual") return `${label} · 직접 지정`;
  return tx.categoryConfidence !== null ? `${label} · AI 신뢰도 ${tx.categoryConfidence}%` : label;
}

function KeyValues({ rows }: { rows: { k: string; v: string }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-5 sm:grid-cols-[72px_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.k} className="contents">
          <dt className="text-xs leading-5 text-ink-3">{row.k}</dt>
          <dd className="m-0 min-w-0 break-words">{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function TxActions({ tx, actions }: { tx: TransactionItem; actions: LedgerActions }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="ds-reveal flex flex-wrap items-center gap-2">
        <span className="text-[13px] leading-5 text-ink">
          이 거래를 삭제할까요? 소비 집계에서 바로 빠져요.
        </span>
        <span className="flex gap-2">
          <ActionButton variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            취소
          </ActionButton>
          <ActionButton
            variant="danger"
            disabled={busy}
            onClick={() => run(() => actions.onDelete(tx.id))}
          >
            삭제
          </ActionButton>
        </span>
      </div>
    );
  }

  const canCategorize = tx.bucket === "spending";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCategorize ? (
        <Select
          value={tx.category ?? undefined}
          onValueChange={(value) => run(() => actions.onCategory(tx.id, value as ExpenseCategory))}
          disabled={busy}
        >
          <SelectTrigger
            aria-label="지출 카테고리"
            className="h-11 min-w-[132px] gap-2 rounded-[9px] border-0 bg-surface px-3 text-[13px] font-semibold shadow-ring sm:h-9"
          >
            <SelectValue placeholder="카테고리 선택" />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                <span className="flex items-center gap-2">
                  <CategoryMark category={category} size="sm" />
                  {EXPENSE_CATEGORY_LABELS[category]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {tx.spendingOverride ? (
        <ActionButton
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => actions.onOverride(tx.id, null))}
        >
          기본 분류로 되돌리기
        </ActionButton>
      ) : tx.bucket === "spending" ? (
        <ActionButton
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => actions.onOverride(tx.id, "exclude"))}
        >
          집계에서 제외
        </ActionButton>
      ) : tx.type !== "cancel" ? (
        <ActionButton
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => actions.onOverride(tx.id, "include"))}
        >
          소비로 포함
        </ActionButton>
      ) : null}
      <ActionButton variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
        삭제
      </ActionButton>
    </div>
  );
}

function RowButton({
  row,
  open,
  onToggle,
  ctx,
  controls,
}: {
  row: LedgerRow;
  open: boolean;
  onToggle: () => void;
  ctx: FlagContext;
  controls: string;
}) {
  if (row.kind === "refunds") {
    const first = row.items[0];
    return (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className={ROW_GRID}
      >
        <span className="num hidden text-[13px] text-ink-3 sm:block">{txTime(first)}</span>
        <LedgerMark kind="refund" />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {row.merchant} 환불 {row.items.length}건
            </span>
            <Flag label={refundFlag(ctx).label} />
          </span>
          <span className="truncate text-xs leading-4 text-ink-3">
            <span className="sm:hidden">{txTime(first)} · </span>
            {first.accountName}
          </span>
        </span>
        <span className="hidden text-xs text-ink-3 sm:block">환불</span>
        <span className="num text-right text-[15px] font-medium">
          {formatWon(row.total, { sign: true })}
        </span>
      </button>
    );
  }
  const tx = row.tx;
  const flag = rowFlag(tx, ctx);
  const tag = rowTag(tx);
  const ignored = tx.bucket === "ignore";
  const meta = [
    tx.bucket === "spending" && tx.category ? SPENDING_CATEGORY_LABELS[tx.category] : null,
    tx.bucket === "spending" && !tx.category ? "분류 중" : null,
    tx.accountName,
  ].filter(Boolean);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={ROW_GRID}
    >
      <span className="num hidden text-[13px] text-ink-3 sm:block">{txTime(tx)}</span>
      <Mark tx={tx} />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {tx.isRefund ? `${tx.merchant.split("_")[0]} 환불` : tx.merchant}
          </span>
          {flag ? <Flag label={flag.label} /> : null}
        </span>
        <span className="truncate text-xs leading-4 text-ink-3">
          <span className="sm:hidden">{txTime(tx)} · </span>
          {meta.join(" · ")}
        </span>
      </span>
      <span className="hidden text-xs text-ink-3 sm:block">{tag ?? ""}</span>
      <span
        className={cn(
          "num text-right text-[15px]",
          tx.amount >= 1_000_000 ? "font-semibold" : "font-medium",
          ignored ? "text-ink-3" : "text-ink"
        )}
      >
        {formatWon(signedAmount(tx), { sign: true })}
      </span>
    </button>
  );
}

function RowDetail({
  row,
  ctx,
  actions,
  id,
}: {
  row: LedgerRow;
  ctx: FlagContext;
  actions: LedgerActions;
  id: string;
}) {
  if (row.kind === "refunds") {
    return (
      <div id={id} className="ds-reveal flex flex-col gap-2.5 pb-3.5 pl-10 sm:pl-[96px]">
        <p className="ai-voice m-0">{refundFlag(ctx).reason}</p>
        <KeyValues
          rows={row.items.map((r) => ({
            k: txTime(r),
            v: `${formatWon(r.amount, { sign: true })} · ${r.merchant.split("_")[0]} · ${r.accountName}`,
          }))}
        />
      </div>
    );
  }
  const tx = row.tx;
  const flag = rowFlag(tx, ctx);
  const raw = [tx.rawTitle, tx.rawText]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s*\n\s*/g, " · ");
  return (
    <div id={id} className="ds-reveal flex flex-col gap-3 pb-3.5 pl-10 sm:pl-[96px]">
      {flag ? <p className="ai-voice m-0">{flag.reason}</p> : null}
      <KeyValues
        rows={[
          { k: "알림 원문", v: raw || "(내용 없음)" },
          { k: "계좌", v: tx.accountName },
          { k: "시각", v: formatDateTime(new Date(tx.transactedAt)) },
          { k: "분류", v: classification(tx) },
        ]}
      />
      <TxActions tx={tx} actions={actions} />
    </div>
  );
}

/**
 * Transactions grouped by KST day (newest first) with each day's spending and
 * refunds in its header. Rows expand in place to the source notification, the
 * classification and the corrections (category, exclude, delete).
 */
export function Ledger({
  days,
  ctx,
  actions,
}: {
  days: LedgerDay[];
  ctx: FlagContext;
  actions: LedgerActions;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col">
      {days.map((day) => (
        <section key={day.key} aria-label={formatDay(day.key)}>
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-0 pt-5 pb-2 sm:px-2">
            <h3 className="m-0 text-sm font-semibold">{formatDay(day.key)}</h3>
            <span className="flex flex-wrap justify-end gap-x-3 text-[13px] text-ink-2">
              <span className="num">
                {day.spend > 0 ? `지출 ${formatWon(day.spend)}` : "지출 없음"}
              </span>
              {day.refund > 0 ? (
                <span className="num">환불 {formatWon(day.refund, { sign: true })}</span>
              ) : null}
            </span>
          </div>
          {day.rows.map((row) => {
            const isOpen = open.has(row.id);
            const detailId = `ledger-${row.id}`;
            return (
              <div key={row.id} className="border-b border-line">
                <RowButton
                  row={row}
                  open={isOpen}
                  onToggle={() => toggle(row.id)}
                  ctx={ctx}
                  controls={detailId}
                />
                {isOpen ? <RowDetail row={row} ctx={ctx} actions={actions} id={detailId} /> : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
