"use client";

import { useState } from "react";
import { AiLine, CategoryMark, useEvidence } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatWon, formatWonCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type Baseline,
  type MonthAnnotation,
  type MonthBar,
  niceTicks,
  SPLIT_CATEGORY,
  SPLIT_LABEL,
  tickLabel,
} from "../view-model";
import { SPLIT_FILL } from "./SpendingHero";

/** Plot height: 160 on phones, 200 from sm; 34px of month labels under it. */
const PLOT = "h-[160px] sm:h-[200px]";

/**
 * Monthly spending as stacked bars (의료·건강 washed hue on top of the ink-2
 * rest) with the past-months average as a dashed line. A bar is a toggle that
 * selects the month for the category panel; hovering one shows its split.
 */
function MonthStep({
  dir,
  disabled,
  onClick,
}: {
  dir: -1 | 1;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={dir < 0 ? "이전 달" : "다음 달"}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-transparent text-ink-2 transition-[scale,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand active:scale-[.96] disabled:cursor-default disabled:text-ink-3 disabled:opacity-40"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={dir < 0 ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

export function MonthlyChart({
  bars,
  average,
  annotations,
  selectedKey,
  onSelect,
  today,
  fact,
}: {
  bars: MonthBar[];
  average: Baseline | null;
  annotations: MonthAnnotation[];
  selectedKey: string;
  onSelect: (key: string) => void;
  today: number;
  fact: Fact | null;
}) {
  const { stateOf, isActive } = useEvidence();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.total), average?.total ?? 0);
  const { ticks, top } = niceTicks(max);
  const n = Math.max(1, bars.length);
  const pct = (v: number) => (v / top) * 100;
  const center = (i: number) => `${((i + 0.5) / n) * 100}%`;
  const title = (b: MonthBar) => `${b.year}년 ${b.label}${b.isCurrent ? ` (${today}일째)` : ""}`;
  const selected = bars.find((b) => b.key === selectedKey) ?? bars[bars.length - 1];
  const selIndex = selected ? bars.indexOf(selected) : -1;
  const tip = hover === null ? null : bars[hover];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-[230px] sm:h-[290px]">
        {/* Grid + average share the plot frame. */}
        <div className={cn("absolute inset-x-0 bottom-[34px]", PLOT)}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-line"
              style={{ bottom: `${pct(t)}%` }}
            >
              <span className="num absolute right-0 -top-4 text-[10px] text-ink-3 sm:-top-[18px] sm:text-[11px]">
                {tickLabel(t)}
              </span>
            </div>
          ))}
          {average ? (
            <>
              <div
                className="absolute left-0 right-8 z-[1] border-t-[1.5px] border-dashed border-ink-2 sm:right-10"
                style={{ bottom: `${pct(average.total)}%` }}
              />
              <span
                className="absolute left-0 z-[2] hidden translate-y-[-4px] bg-page pr-1.5 text-xs text-ink-2 sm:block"
                style={{ bottom: `${pct(average.total)}%` }}
              >
                {average.label} 평균 <span className="num">{formatWonCompact(average.total)}</span>
              </span>
            </>
          ) : null}
        </div>

        <div
          className="absolute inset-y-0 left-0 right-8 z-[1] grid items-end sm:right-10"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {bars.map((b, i) => {
            const on = b.key === selected?.key;
            const totalPct = pct(b.total);
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={on}
                aria-label={`${title(b)} ${formatWon(b.total)}`}
                onClick={() => onSelect(b.key)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="group flex h-full cursor-pointer flex-col items-center justify-end rounded-lg border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span className={cn("relative w-full", PLOT)}>
                  <span
                    className={cn(
                      "num absolute left-1/2 z-[2] hidden -translate-x-1/2 bg-page px-[3px] text-[11px] whitespace-nowrap sm:block",
                      on ? "font-semibold text-ink" : "font-medium text-ink-3"
                    )}
                    style={{ bottom: `calc(${totalPct}% + 6px)` }}
                  >
                    {formatWonCompact(b.total)}
                  </span>
                  <span
                    data-bar={b.key}
                    className="ds-grow absolute bottom-0 left-1/2 flex w-[60%] min-w-[14px] -translate-x-1/2 flex-col justify-end gap-0.5 sm:w-[44%] sm:max-w-10"
                    style={{ height: `${totalPct}%`, animationDelay: `${i * 20}ms` }}
                  >
                    {b.health > 0 ? (
                      <span
                        data-part="split"
                        data-evidence={stateOf(`split:${b.key}`)}
                        className="block min-h-px rounded-[3px] [@media(hover:hover)]:group-hover:opacity-85"
                        style={{ flex: `${b.health} 1 0`, background: SPLIT_FILL }}
                      />
                    ) : null}
                    {b.rest > 0 ? (
                      <span
                        data-part="rest"
                        data-evidence={isActive ? "dim" : undefined}
                        className="block min-h-px rounded-[3px] bg-ink-2 [@media(hover:hover)]:group-hover:opacity-85"
                        style={{ flex: `${b.rest} 1 0` }}
                      />
                    ) : null}
                  </span>
                </span>
                <span className="flex h-[34px] flex-col items-center gap-2 pt-2">
                  <span
                    className={cn(
                      "text-xs leading-4",
                      on ? "font-semibold text-ink" : "font-medium text-ink-3"
                    )}
                  >
                    {b.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-0.5 w-5 rounded-sm bg-brand",
                      on ? "opacity-100" : "opacity-0"
                    )}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            "pointer-events-none absolute left-0 right-8 bottom-[34px] z-[3] sm:right-10",
            PLOT
          )}
        >
          {annotations.map((a) => {
            const i = bars.findIndex((b) => b.key === a.key);
            if (i < 0) return null;
            return (
              <span
                key={a.key}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: center(i), bottom: `calc(${pct(bars[i].total)}% + 24px)` }}
              >
                <span className="text-xs leading-4 whitespace-nowrap text-ink-2">{a.text}</span>
                <i aria-hidden="true" className="block h-2.5 w-px bg-ink-3" />
              </span>
            );
          })}
          {tip ? (
            <div
              className="absolute z-[4] hidden min-w-40 -translate-x-1/2 flex-col gap-1 rounded-[10px] bg-surface px-3 py-2.5 text-xs leading-4 whitespace-nowrap shadow-tip [@media(hover:hover)]:sm:flex"
              style={{
                left: center(hover ?? 0),
                bottom: `calc(${Math.min(pct(tip.total), 70)}% + 28px)`,
              }}
            >
              <span className="font-semibold">{title(tip)}</span>
              <span className="flex justify-between gap-4">
                <span className="text-ink-3">합계</span>
                <span className="num">{formatWon(tip.total)}</span>
              </span>
              <span className="flex justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-ink-3">
                  <CategoryMark category={SPLIT_CATEGORY} size="sm" />
                  {SPLIT_LABEL}
                </span>
                <span className="num">{formatWon(tip.health)}</span>
              </span>
              <span className="flex justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-ink-3">
                  <span className="grid w-5 place-items-center">
                    <span className="size-1.5 rounded-full bg-ink-2" />
                  </span>
                  나머지
                </span>
                <span className="num">{formatWon(tip.rest)}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-y border-line py-3 sm:hidden">
          <dt className="-my-2 -ml-2.5 flex items-center text-sm font-semibold">
            {/* Phones: the month columns are ~30–36px wide, so give month
                selection a 44px stepper as well. */}
            <MonthStep
              dir={-1}
              disabled={selIndex <= 0}
              onClick={() => onSelect(bars[selIndex - 1].key)}
            />
            <span aria-live="polite">{title(selected)}</span>
            <MonthStep
              dir={1}
              disabled={selIndex < 0 || selIndex >= bars.length - 1}
              onClick={() => onSelect(bars[selIndex + 1].key)}
            />
          </dt>
          <dd className="num m-0 self-center text-right text-[15px] font-medium">
            {formatWon(selected.total)}
          </dd>
          <dt className="inline-flex items-center gap-1.5 text-xs text-ink-3">
            <CategoryMark category={SPLIT_CATEGORY} size="sm" />
            {SPLIT_LABEL}
          </dt>
          <dd className="num m-0 text-right text-[13px] text-ink-2">
            {formatWon(selected.health)}
          </dd>
          <dt className="inline-flex items-center gap-1.5 text-xs text-ink-3">
            <span className="grid w-5 place-items-center">
              <span className="size-1.5 rounded-full bg-ink-2" />
            </span>
            나머지
          </dt>
          <dd className="num m-0 text-right text-[13px] text-ink-2">{formatWon(selected.rest)}</dd>
          {average ? (
            <>
              <dt className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                <span className="grid w-5 place-items-center">
                  <span className="w-2.5 border-t-[1.5px] border-dashed border-ink-2" />
                </span>
                {average.label} 평균
              </dt>
              <dd className="num m-0 text-right text-[13px] text-ink-2">
                {formatWon(average.total)}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {fact ? <AiLine fact={fact} rows={fact.rows} className="max-w-[640px]" /> : null}
    </div>
  );
}
