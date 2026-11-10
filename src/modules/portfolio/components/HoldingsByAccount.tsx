"use client";

import { useState } from "react";
import { AiLine, useEvidence } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatReturn, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { evidenceKey } from "../facts";
import { Chevron, enterStyle, marketTone, SectionTitle } from "./parts";

export interface HoldingRow {
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnl: number;
  /** Ratio. */
  rate: number;
  /** Weight within the account's securities (0..1). */
  weight: number;
  /** Target weight when the account has targets for this ticker. */
  target: number | null;
  /** Up to two recent fills, already formatted. */
  fills: string[];
  flag: string | null;
}

export interface HoldingGroup {
  accountId: string;
  label: string;
  typeLabel: string;
  number: string;
  securities: number;
  rows: HoldingRow[];
}

const COLS =
  "lg:grid-cols-[28px_minmax(0,1fr)_64px_100px_92px_120px_120px_80px_128px] xl:grid-cols-[28px_minmax(0,1fr)_72px_108px_100px_128px_128px_84px_140px]";

const pctOne = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;
const pctTwo = (r: number) => `${(Math.round(r * 10_000) / 100).toFixed(2)}%`;

function Flag({ children }: { children: string }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface px-[7px] text-[10px] font-semibold whitespace-nowrap text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] lg:h-5 lg:text-[11px]">
      {children}
    </span>
  );
}

export function HoldingsByAccount({ groups, fact }: { groups: HoldingGroup[]; fact: Fact | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const { stateOf } = useEvidence();
  const count = groups.reduce((s, g) => s + g.rows.length, 0);

  return (
    <section aria-labelledby="pf-holdings" className="ds-enter mt-8 lg:mt-12" style={enterStyle(4)}>
      <div id="pf-holdings">
        <SectionTitle
          meta={
            <>
              {count}종목<span className="hidden lg:inline"> · 계좌 {groups.length}개</span>
            </>
          }
        >
          보유 종목
        </SectionTitle>
      </div>
      {fact ? (
        <div className="mt-1.5 max-w-[900px]">
          <AiLine fact={fact} rows={fact.rows} className="max-lg:text-wrap" />
        </div>
      ) : null}

      <div className="mt-2 lg:mt-4">
        <div
          aria-hidden="true"
          className={cn("text-label hidden h-9 items-center border-b border-line lg:grid", COLS)}
        >
          <span />
          <span>종목</span>
          <span className="text-right">수량</span>
          <span className="text-right">평균단가</span>
          <span className="text-right">현재가</span>
          <span className="text-right">평가금액</span>
          <span className="text-right">평가손익</span>
          <span className="text-right">수익률</span>
          <span className="text-right">계좌 내 비중</span>
        </div>

        {groups.map((g) => (
          <div key={g.accountId}>
            <div className="flex items-baseline justify-between gap-2.5 border-b border-line pt-5 pb-2 lg:h-12 lg:justify-start lg:pb-0">
              <span>
                <span className="text-sm font-semibold">{g.label}</span>{" "}
                <span className="text-label lg:ml-1.5">
                  <span className="hidden lg:inline">
                    {g.typeLabel} · <span className="num">{g.number}</span> ·{" "}
                  </span>
                  {g.rows.length}종목
                </span>
              </span>
              <span className="text-xs text-ink-2 lg:ml-auto lg:text-[13px]">
                주식 <span className="num">{formatWon(g.securities)}</span>
              </span>
            </div>

            {g.rows.map((r, i) => {
              const id = `${g.accountId}:${r.ticker}`;
              const isOpen = open === id;
              const panelId = `pf-pos-${g.accountId}-${r.ticker}`;
              const ev = stateOf(evidenceKey.position(g.accountId, r.ticker));
              const cost = r.quantity * r.avgPrice;
              return (
                <div key={r.ticker} data-evidence={ev}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : id)}
                    className={cn(
                      "grid min-h-16 w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2 border-0 border-b border-line py-2.5 text-left transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-brand lg:h-14 lg:min-h-0 lg:gap-x-0 lg:py-0 [@media(hover:hover)]:hover:bg-sunken",
                      COLS,
                      isOpen ? "bg-sunken" : ev === "on" ? "bg-brand-soft" : "bg-transparent"
                    )}
                  >
                    <Chevron open={isOpen} direction="right" size={14} className="lg:ml-1.5" />
                    <span className="flex min-w-0 flex-col gap-0.5 lg:gap-0">
                      <span className="flex min-w-0 items-center gap-2 text-sm leading-5 font-medium">
                        <span
                          title={r.name}
                          className={cn(
                            "min-w-0 break-keep [overflow-wrap:anywhere]",
                            // Expanded rows show the full name (touch can't reach `title`).
                            !isOpen && "line-clamp-2"
                          )}
                        >
                          {r.name}
                        </span>
                        {r.flag ? (
                          <span className="hidden lg:inline-flex">
                            <Flag>{r.flag}</Flag>
                          </span>
                        ) : null}
                      </span>
                      <span className="num hidden text-xs leading-4 text-ink-3 lg:block">
                        {r.ticker}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-ink-3 lg:hidden">
                        <span className="whitespace-nowrap">
                          <span className="num">{formatCount(r.quantity)}주</span> · 비중{" "}
                          <span className="num">{pctOne(r.weight)}</span>
                        </span>
                        {r.flag ? <Flag>{r.flag}</Flag> : null}
                      </span>
                    </span>
                    {/* phone: value + P/L stacked on the right */}
                    <span className="flex flex-col items-end gap-0.5 lg:hidden">
                      <span className="num text-sm leading-5 font-medium">
                        {formatWon(r.evalAmount)}
                      </span>
                      <span className={cn("num text-xs leading-4", marketTone(r.pnl))}>
                        {formatWon(r.pnl, { sign: true })} · {formatReturn(r.rate)}
                      </span>
                    </span>
                    {/* PC columns */}
                    <span className="num hidden text-right text-sm lg:block">
                      {formatCount(r.quantity)}주
                    </span>
                    <span className="num hidden text-right text-sm lg:block">
                      {formatWon(r.avgPrice)}
                    </span>
                    <span className="num hidden text-right text-sm lg:block">
                      {formatWon(r.currentPrice)}
                    </span>
                    <span className="num hidden text-right text-sm font-medium lg:block">
                      {formatWon(r.evalAmount)}
                    </span>
                    <span
                      className={cn("num hidden text-right text-sm lg:block", marketTone(r.pnl))}
                    >
                      {formatWon(r.pnl, { sign: true })}
                    </span>
                    <span
                      className={cn(
                        "num hidden text-right text-sm font-semibold lg:block",
                        marketTone(r.pnl)
                      )}
                    >
                      {formatReturn(r.rate)}
                    </span>
                    <span className="hidden items-center justify-end gap-2 lg:flex">
                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-track xl:w-16">
                        <span
                          className="ds-growx block h-full bg-ink-2"
                          style={{
                            width: `${Math.min(100, r.weight * 200)}%`,
                            animationDelay: `${40 + i * 20}ms`,
                            animationFillMode: "backwards",
                          }}
                        />
                      </span>
                      <span className="num w-11 text-right text-[13px]">{pctOne(r.weight)}</span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div
                      id={panelId}
                      className="ds-reveal flex flex-col gap-1.5 border-b border-line bg-sunken py-3 pl-[26px] text-xs leading-[18px] lg:min-h-[72px] lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-10 lg:py-4 lg:pl-7 lg:text-[13px]"
                    >
                      <div className="grid grid-cols-2 gap-y-1 lg:hidden">
                        <span>
                          <span className="text-ink-3">평균단가 </span>
                          <span className="num">{formatWon(r.avgPrice)}</span>
                        </span>
                        <span>
                          <span className="text-ink-3">현재가 </span>
                          <span className="num">{formatWon(r.currentPrice)}</span>
                        </span>
                        <span>
                          <span className="text-ink-3">매입금액 </span>
                          <span className="num">{formatWon(cost)}</span>
                        </span>
                        <span className="num text-ink-3">{r.ticker}</span>
                      </div>
                      <span className="hidden lg:inline">
                        <span className="text-ink-3">매입금액 </span>
                        <span className="num">{formatWon(cost)}</span>
                      </span>
                      {r.target !== null ? (
                        <span>
                          <span className="text-ink-3">{g.label} 목표 비중 </span>
                          <span className="num">{pctOne(r.target)}</span> · 현재{" "}
                          <span className="num">{pctTwo(r.weight)}</span>
                        </span>
                      ) : null}
                      {r.fills.length > 0 ? (
                        <span className="truncate lg:whitespace-normal">
                          <span className="text-ink-3">최근 체결 </span>
                          <span className="tabular-nums">{r.fills.join("  ·  ")}</span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
