"use client";

import { AiLine, CountUp, HeroNumber } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatDay, formatReturn, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChangeArrow, enterStyle, marketTone } from "./parts";

export interface TodayRow {
  id: string;
  label: string;
  change: number;
  prev: number;
}

interface Props {
  total: number;
  deposit: number;
  invested: number;
  pnl: number;
  /** Today's change vs the previous trading day, or null when KIS gave none. */
  todayChange: number | null;
  prevTotal: number | null;
  prevDate: string | null;
  todayRows: TodayRow[];
  fact: Fact | null;
}

const signed = (n: number) => formatWon(n, { sign: true });

export function PortfolioHero({
  total,
  deposit,
  invested,
  pnl,
  todayChange,
  prevTotal,
  prevDate,
  todayRows,
  fact,
}: Props) {
  const pnlRate = invested > 0 ? pnl / invested : 0;
  const todayRate = todayChange !== null && prevTotal ? todayChange / prevTotal : null;

  // Composition of the total: cost basis, unrealized gain (or the loss eaten out
  // of the cost basis), cash. Shares are of the larger of total and cost + cash.
  const whole = Math.max(total, invested + deposit, 1);
  const comp =
    pnl >= 0
      ? [
          {
            key: "매입금액",
            value: formatWon(invested),
            w: invested / whole,
            cls: "bg-ink-2",
            tone: "text-ink",
          },
          {
            key: "평가손익",
            value: signed(pnl),
            w: pnl / whole,
            cls: "bg-gain",
            tone: "text-gain",
          },
          {
            key: "예수금",
            value: formatWon(deposit),
            w: deposit / whole,
            cls: "bg-track",
            tone: "text-ink",
          },
        ]
      : [
          {
            key: "평가금액",
            value: formatWon(invested + pnl),
            w: (invested + pnl) / whole,
            cls: "bg-ink-2",
            tone: "text-ink",
          },
          {
            key: "평가손실",
            value: signed(pnl),
            w: -pnl / whole,
            cls: "bg-loss-soft shadow-[inset_0_0_0_1px_var(--down)]",
            tone: "text-loss",
          },
          {
            key: "예수금",
            value: formatWon(deposit),
            w: deposit / whole,
            cls: "bg-track",
            tone: "text-ink",
          },
        ];

  return (
    <section
      aria-label="총자산"
      className="ds-enter mt-7 grid grid-cols-1 border-b border-line pb-7 lg:mt-10 lg:grid-cols-12 lg:gap-x-6 lg:pb-12"
      style={enterStyle(1)}
    >
      <div className="flex min-w-0 flex-col lg:col-span-7">
        <span className="text-label">총자산</span>
        <div className="mt-1.5 lg:mt-2">
          <HeroNumber value={total} countUp format={(n) => formatCount(n)} unit="원" />
        </div>
        {todayChange !== null ? (
          <p className="m-0 mt-2 flex flex-wrap items-center gap-x-1.5 text-sm lg:mt-2.5 lg:gap-x-2 lg:text-[15px]">
            <span
              className={cn(
                "num inline-flex items-center gap-1 font-semibold",
                marketTone(todayChange)
              )}
            >
              <ChangeArrow value={todayChange} />
              {signed(todayChange)}
              {todayRate !== null ? ` (${formatReturn(todayRate)})` : ""}
            </span>
            {prevDate ? (
              <span className="text-ink-2">
                <span className="hidden lg:inline">직전 거래일 </span>
                {formatDay(prevDate)}보다
              </span>
            ) : null}
          </p>
        ) : null}

        {/* Total P/L on what was invested */}
        <div className="mt-5 lg:mt-7">
          <span className="text-label lg:hidden">
            총 평가손익 · 매입금액 <span className="num">{formatWon(invested)}</span> 대비
          </span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 lg:mt-0 lg:gap-x-3">
            <span className="hidden text-[13px] leading-4 font-medium text-ink-3 lg:inline">
              총 평가손익
            </span>
            <CountUp
              value={pnl}
              format={signed}
              className={cn("text-[22px] leading-7 font-medium", marketTone(pnl))}
            />
            <span className={cn("num text-[15px] font-semibold", marketTone(pnl))}>
              {formatReturn(pnlRate)}
            </span>
            <span className="hidden text-sm text-ink-2 lg:inline">
              매입금액 <span className="num">{formatWon(invested)}</span> 대비
            </span>
          </div>
        </div>

        <div className="mt-3.5 max-w-[560px] lg:mt-4">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full lg:h-2.5">
            {comp.map((c, i) => (
              <span
                key={c.key}
                className={cn("ds-growx block min-w-[3px]", c.cls)}
                style={{
                  width: `${Math.max(0, c.w * 100)}%`,
                  animationDelay: `${i * 100}ms`,
                  animationFillMode: "backwards",
                }}
              />
            ))}
          </div>
          <dl className="m-0 mt-2.5 flex flex-col gap-1 text-xs leading-4 lg:flex-row lg:gap-6">
            {comp.map((c) => (
              <div key={c.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--line)]",
                    c.cls
                  )}
                />
                <dt className="w-14 text-ink-3 lg:w-auto">{c.key}</dt>
                <dd className={cn("num m-0", c.tone)}>{c.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {fact ? (
          <div className="mt-4 max-w-[640px] lg:mt-5">
            <AiLine fact={fact} rows={fact.rows} />
          </div>
        ) : null}
      </div>

      {todayRows.length > 0 ? (
        <div className="mt-5 flex flex-col lg:col-span-4 lg:col-start-9 lg:mt-0 lg:pt-1">
          <span className="text-sm leading-[22px] font-semibold text-ink lg:text-[15px]">
            오늘 계좌별 변화
          </span>
          <div className="mt-0 lg:mt-2">
            {todayRows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 lg:py-3"
              >
                <span className="text-sm">{r.label}</span>
                <span className={cn("num text-sm font-medium", marketTone(r.change))}>
                  {signed(r.change)}
                  {r.prev > 0 ? (
                    <span className="text-xs"> ({formatReturn(r.change / r.prev)})</span>
                  ) : null}
                </span>
              </div>
            ))}
            {todayChange !== null ? (
              <div className="hidden items-center justify-between gap-3 py-3 lg:flex">
                <span className="text-sm font-semibold">합계</span>
                <span className={cn("num text-sm font-semibold", marketTone(todayChange))}>
                  {signed(todayChange)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
