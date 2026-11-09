"use client";

import { AiLine, useEvidence } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { evidenceKey, pp } from "../facts";
import { type DriftRow, driftScale } from "../view-model";
import { enterStyle, SectionTitle } from "./parts";

const pct = (r: number, digits: number) => `${(r * 100).toFixed(digits)}%`;

/** Over-target in ink, under-target in accent — drift is never a gain/loss color. */
function Legend({ compact }: { compact?: boolean }) {
  const items = [
    { k: compact ? "목표" : "목표 비중", el: <span className="h-3 w-0.5 bg-ink lg:h-3.5" /> },
    {
      k: compact ? "초과분" : "목표보다 많은 부분",
      el: <span className="h-2 w-3 rounded-sm bg-ink lg:h-2.5 lg:w-3.5" />,
    },
    {
      k: compact ? "모자란 부분" : "목표까지 모자란 부분",
      el: (
        <span className="h-2 w-3 rounded-sm bg-brand-soft shadow-[inset_0_0_0_1px_var(--brand)] lg:h-2.5 lg:w-3.5" />
      ),
    },
  ];
  return (
    <>
      {items.map((it) => (
        <span key={it.k} className="flex items-center gap-1.5 lg:gap-2">
          <span aria-hidden="true" className="flex w-3.5 justify-center">
            {it.el}
          </span>
          {it.k}
        </span>
      ))}
    </>
  );
}

function Bar({ row, scale, delay }: { row: DriftRow; scale: number; delay: number }) {
  const lo = Math.min(row.current, row.target);
  const hi = Math.max(row.current, row.target);
  const toPct = (v: number) => `${(v / scale) * 100}%`;
  return (
    <span
      className="relative block h-2 rounded-[3px] bg-track lg:h-2.5"
      role="img"
      aria-label={`현재 ${pct(row.current, 2)}, 목표 ${pct(row.target, 0)}`}
    >
      <span
        className="ds-growx absolute inset-y-0 left-0 rounded-l-[3px]"
        style={{
          width: toPct(lo),
          background: "color-mix(in oklab, var(--ink3) 45%, transparent)",
          animationDelay: `${delay}ms`,
          animationFillMode: "backwards",
        }}
      />
      <span
        className={cn(
          "ds-delayed-in absolute inset-y-0",
          row.over ? "bg-ink" : "bg-brand-soft shadow-[inset_0_0_0_1px_var(--brand)]"
        )}
        style={{ left: toPct(lo), width: toPct(hi - lo), animationFillMode: "backwards" }}
      />
      <span
        className="absolute -top-1 -bottom-1 -ml-px w-0.5 rounded-[1px] bg-ink lg:-top-[5px] lg:-bottom-[5px]"
        style={{ left: toPct(row.target) }}
      />
    </span>
  );
}

export function TargetDrift({
  accountId,
  accountLabel,
  rows,
  base,
  setAt,
  fact,
  onEdit,
  following = false,
}: {
  /** A second drift section directly after another: tighter top spacing. */
  following?: boolean;
  accountId: string;
  accountLabel: string;
  rows: DriftRow[];
  base: number;
  setAt: string | null;
  fact: Fact | null;
  onEdit: () => void;
}) {
  const { stateOf } = useEvidence();
  const scale = driftScale(rows);
  const amountText = (r: DriftRow) =>
    `${formatWon(r.amount)} ${r.over ? "초과" : "모자람"}${r.shares > 0 ? ` · ${r.shares}주` : ""}`;
  const meta = (
    <>
      {setAt ? (
        <>
          <span className="num">{setAt}</span> 설정 ·{" "}
        </>
      ) : null}
      주식 평가금액 <span className="num">{formatWon(base)}</span> 기준
    </>
  );

  return (
    <section
      aria-labelledby={`pf-drift-${accountId}`}
      className={cn("ds-enter pb-8 lg:pb-12", following ? "mt-2 lg:mt-2" : "mt-10 lg:mt-14")}
      style={enterStyle(4)}
    >
      <div id={`pf-drift-${accountId}`}>
        <div className="hidden lg:block">
          <SectionTitle meta={meta}>{accountLabel} 목표 비중</SectionTitle>
        </div>
        <div className="lg:hidden">
          <SectionTitle>{accountLabel} 목표 비중</SectionTitle>
          <p className="m-0 mt-0.5 text-xs leading-[18px] text-ink-3">{meta}</p>
        </div>
      </div>
      {fact ? (
        <div className="mt-2 max-w-[900px] lg:mt-1.5">
          <AiLine fact={fact} rows={fact.rows} />
        </div>
      ) : null}

      {/* phone */}
      <div className="lg:hidden">
        <div className="mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-ink-2">
          <Legend compact />
        </div>
        <div className="mt-2 border-t border-line">
          {rows.map((r, i) => {
            const ev = stateOf(evidenceKey.drift(accountId, r.ticker));
            return (
              <div
                key={r.ticker}
                data-evidence={ev}
                title={r.name}
                className={cn("border-b border-line py-3", ev === "on" && "bg-brand-soft")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{r.short}</span>
                  <span
                    className={cn("num text-sm font-semibold", r.over ? "text-ink" : "text-brand")}
                  >
                    {pp(r.diff)}
                  </span>
                </div>
                <div className="mt-2.5">
                  <Bar row={r} scale={scale} delay={100 + i * 40} />
                </div>
                <div className="mt-2 flex justify-between gap-3 text-xs text-ink-2">
                  <span className="num">
                    {pct(r.current, 2)} / 목표 {pct(r.target, 0)}
                  </span>
                  <span className="num">{amountText(r)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-control border-0 bg-surface text-[13px] font-semibold text-ink shadow-ring transition-[scale,box-shadow] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          목표 비중 수정
        </button>
      </div>

      {/* PC */}
      <div className="mt-5 hidden grid-cols-12 gap-x-6 lg:grid">
        <div className="col-span-9">
          <div className="text-label grid h-8 grid-cols-[140px_minmax(0,1fr)_120px_76px_200px] items-center gap-x-4 border-b border-line xl:grid-cols-[168px_minmax(0,1fr)_128px_80px_220px]">
            <span>종목</span>
            <span>현재 비중과 목표</span>
            <span className="text-right">현재 / 목표</span>
            <span className="text-right">차이</span>
            <span className="text-right">맞추려면</span>
          </div>
          {rows.map((r, i) => {
            const ev = stateOf(evidenceKey.drift(accountId, r.ticker));
            return (
              <div
                key={r.ticker}
                data-evidence={ev}
                title={r.name}
                className={cn(
                  "grid h-12 grid-cols-[140px_minmax(0,1fr)_120px_76px_200px] items-center gap-x-4 border-b border-line xl:grid-cols-[168px_minmax(0,1fr)_128px_80px_220px] [@media(hover:hover)]:hover:bg-sunken",
                  ev === "on" && "bg-brand-soft"
                )}
              >
                <span className="truncate text-sm font-medium">{r.short}</span>
                <span>
                  <Bar row={r} scale={scale} delay={100 + i * 40} />
                </span>
                <span className="num text-right text-[13px]">
                  {pct(r.current, 2)} <span className="text-ink-3">/ {pct(r.target, 0)}</span>
                </span>
                <span
                  className={cn(
                    "num text-right text-sm font-semibold",
                    r.over ? "text-ink" : "text-brand"
                  )}
                >
                  {pp(r.diff)}
                </span>
                <span className="num text-right text-[13px] text-ink-2">{amountText(r)}</span>
              </div>
            );
          })}
        </div>
        <div className="col-span-3 col-start-10 flex flex-col gap-3 pt-11 text-[13px] leading-5 text-ink-2">
          <Legend />
          <button
            type="button"
            onClick={onEdit}
            className="mt-2 inline-flex h-9 w-fit cursor-pointer items-center rounded-control border-0 bg-surface px-3.5 text-[13px] font-semibold text-ink shadow-ring transition-[scale,box-shadow] duration-150 ease-out hover:shadow-ring-hover active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            목표 비중 수정
          </button>
        </div>
      </div>
    </section>
  );
}
