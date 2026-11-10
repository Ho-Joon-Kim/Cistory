import { formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransactionSummary } from "../hooks";

function Row({
  label,
  sub,
  value,
  strong,
  muted,
  last,
}: {
  label: string;
  sub?: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-3",
        !last && "border-b border-line"
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-sm leading-5",
            strong ? "font-semibold" : "font-medium",
            muted && "text-ink-2"
          )}
        >
          {label}
        </span>
        {sub ? <span className="truncate text-label">{sub}</span> : null}
      </span>
      <span
        className={cn(
          "num text-right",
          strong ? "text-[1.375rem] leading-7 font-medium" : "text-[0.9375rem] leading-[1.375rem]",
          muted ? "text-ink-2" : "text-ink"
        )}
      >
        {value}
      </span>
    </div>
  );
}

const withTop = (top: string | null, count: number) => (top ? `${top} ${count}건` : `${count}건`);

/**
 * Where the period's money went, in ink with explicit signs (income is never
 * green): spending, refunds netted into 순지출, other money received, and what
 * the totals leave out.
 */
export function CashFlow({ summary }: { summary: TransactionSummary }) {
  const { flow } = summary;
  const spend = summary.totalSpending;
  const rows = [
    {
      key: "spend",
      label: "지출",
      sub: `${summary.spendingCount}건`,
      value: formatWon(-spend, { sign: true }),
    },
    flow.refundTotal > 0
      ? {
          key: "refund",
          label: "환불",
          sub: withTop(flow.refundTopMerchant, flow.refundCount),
          value: formatWon(flow.refundTotal, { sign: true }),
        }
      : null,
    {
      key: "net",
      label: "순지출",
      value: formatWon(Math.max(0, spend - flow.refundTotal)),
      strong: true,
    },
    flow.inflowTotal > 0
      ? {
          key: "inflow",
          label: "받은 돈",
          sub: withTop(flow.inflowTopAccount, flow.inflowCount),
          value: formatWon(flow.inflowTotal, { sign: true }),
        }
      : null,
    summary.totalIgnored > 0
      ? {
          key: "ignored",
          label: "집계 제외",
          sub:
            summary.ignoredCount === 1
              ? "내 계좌 간 이체 1건"
              : `내 계좌 간 이체 등 ${summary.ignoredCount}건`,
          value: formatWon(summary.totalIgnored),
          muted: true,
        }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="border-t border-line">
      {rows.map((row, i) => (
        <Row
          key={row.key}
          label={row.label}
          sub={"sub" in row ? row.sub : undefined}
          value={row.value}
          strong={"strong" in row ? row.strong : false}
          muted={"muted" in row ? row.muted : false}
          last={i === rows.length - 1}
        />
      ))}
    </div>
  );
}
