"use client";

import { useEvidence } from "@/components/ds";
import { formatReturn, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { evidenceKey } from "../facts";
import { ChangeArrow, enterStyle, marketTone, SectionTitle } from "./parts";

export interface AccountOutcome {
  id: string;
  label: string;
  typeLabel: string;
  number: string;
  /** Total evaluation incl. cash. */
  total: number;
  securities: number;
  invested: number;
  deposit: number;
  pnl: number;
  holdings: number;
  todayChange: number | null;
}

/**
 * 계좌별 성과: each account's value, its P/L on what was put in, and a bar of
 * cost basis vs. current securities value (gain in red, a loss as a blue-ringed
 * gap). Accounts share one scale so their sizes compare.
 */
export function AccountOutcomes({ accounts }: { accounts: AccountOutcome[] }) {
  const { active, stateOf } = useEvidence();
  const maxV = Math.max(1, ...accounts.flatMap((a) => [a.invested, a.securities]));
  return (
    <section
      aria-labelledby="pf-accounts"
      className="ds-enter mt-8 border-b border-line pb-7 lg:mt-12 lg:pb-12"
      style={enterStyle(2)}
    >
      <div id="pf-accounts">
        <SectionTitle>계좌별 성과</SectionTitle>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:mt-5 lg:grid-cols-2 lg:gap-x-12">
        {accounts.map((a, i) => {
          const rate = a.invested > 0 ? a.pnl / a.invested : 0;
          const base = Math.min(a.invested, a.securities);
          const up = a.securities >= a.invested;
          const lit = active !== null && stateOf(evidenceKey.account(a.id)) === "on";
          const delay = `${200 + i * 120}ms`;
          return (
            <div
              key={a.id}
              // Lit evidence: the hero fact's popover places itself off this card.
              data-evidence={lit ? "on" : undefined}
              className={cn(
                "-m-3 flex flex-col rounded-xl p-3 transition-colors duration-150 ease-out lg:-m-4 lg:p-4",
                lit ? "bg-brand-soft" : "bg-transparent"
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 lg:gap-x-2.5">
                <span className="text-[15px] leading-[22px] font-semibold">{a.label}</span>
                <span className="text-label">
                  {a.typeLabel} · <span className="num">{a.number}</span>
                </span>
              </div>
              <div className="mt-1.5 flex flex-col gap-0.5 lg:mt-2 lg:flex-row lg:items-baseline lg:gap-3.5">
                <span className="num text-[22px] leading-7 font-medium">{formatWon(a.total)}</span>
                <span
                  className={cn(
                    "num inline-flex items-center gap-1 text-sm font-semibold lg:text-[15px]",
                    marketTone(a.pnl)
                  )}
                >
                  <ChangeArrow value={a.pnl} size={13} />
                  {formatWon(a.pnl, { sign: true })} ({formatReturn(rate)})
                </span>
              </div>
              <div
                className="relative mt-3 h-3 rounded bg-track lg:mt-4 lg:h-3.5"
                role="img"
                aria-label={`매입 ${formatWon(a.invested)}, 주식 평가 ${formatWon(a.securities)}`}
              >
                <div
                  className="ds-growx absolute inset-y-0 left-0 rounded-l bg-ink-2"
                  style={{
                    width: `${(base / maxV) * 100}%`,
                    animationDelay: delay,
                    animationFillMode: "backwards",
                  }}
                />
                <div
                  className={cn(
                    "ds-growx absolute inset-y-0 rounded-r",
                    up ? "bg-gain" : "bg-loss-soft shadow-[inset_0_0_0_1px_var(--down)]"
                  )}
                  style={{
                    left: `${(base / maxV) * 100}%`,
                    width: `${(Math.abs(a.securities - a.invested) / maxV) * 100}%`,
                    animationDelay: delay,
                    animationFillMode: "backwards",
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-ink-3">
                <span>
                  매입 <span className="num">{formatWon(a.invested)}</span>
                </span>
                <span>
                  주식 평가 <span className="num">{formatWon(a.securities)}</span>
                </span>
              </div>
              <dl className="m-0 mt-3 grid grid-cols-2 gap-y-2.5 lg:mt-4 lg:grid-cols-[repeat(4,auto)] lg:justify-start lg:gap-x-8">
                {[
                  { k: "매입금액", v: formatWon(a.invested), tone: "" },
                  { k: "예수금", v: formatWon(a.deposit), tone: "" },
                  { k: "종목", v: `${a.holdings}개`, tone: "" },
                  {
                    k: "오늘",
                    v: a.todayChange === null ? "—" : formatWon(a.todayChange, { sign: true }),
                    tone: a.todayChange === null ? "text-ink-3" : marketTone(a.todayChange),
                  },
                ].map((s) => (
                  <div key={s.k}>
                    <dt className="text-label">{s.k}</dt>
                    <dd
                      className={cn("num m-0 mt-0.5 text-sm leading-5 lg:leading-[22px]", s.tone)}
                    >
                      {s.v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
