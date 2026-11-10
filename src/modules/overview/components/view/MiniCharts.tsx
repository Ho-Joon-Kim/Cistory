"use client";

import { useState } from "react";
import { formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashPair, MiniBar, NetBar, WeightPoint } from "@/modules/overview/view/hero";
import { wonColumn } from "@/modules/overview/view/sections";
import { faceClass } from "./face-class";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { useTaggedEvidence } from "./useTaggedEvidence";

function Tip({ children }: { children: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 rounded-[7px] bg-surface px-2 py-1 text-xs leading-4 whitespace-nowrap text-ink shadow-pop",
        faceClass(children)
      )}
    >
      {children}
    </span>
  );
}

/**
 * History bars under a hero figure: one per period, the viewed one in the brand
 * color, the period in progress as an outline, missing periods as a dashed stub.
 */
export function MiniBars({
  bars,
  label,
  showLabels = true,
  className,
  gap = 6,
  tag,
}: {
  bars: MiniBar[];
  label: string;
  /** The series these bars draw ("commits", "steps"); evidence for another series leaves them dim. */
  tag: string;
  showLabels?: boolean;
  className?: string;
  gap?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { stateOf } = useTaggedEvidence(tag);
  const [ref, width] = useMeasuredWidth<HTMLUListElement>();
  if (bars.length === 0) return null;
  // Labels never wrap ("8/3⏎1"): when a slot is narrower than the longest label,
  // show every k-th one counting back from the newest bar.
  const slot = width > 0 ? (width - gap * (bars.length - 1)) / bars.length + gap : Infinity;
  const longest = Math.max(...bars.map((b) => b.label.length));
  const every = Math.max(1, Math.ceil((longest * 6.6 + 6) / slot));
  return (
    <ul
      ref={ref}
      aria-label={label}
      // Span-built bars aren't svg: tell evidence popovers to stay off them.
      data-evidence-avoid=""
      className={cn("m-0 flex h-full list-none items-end p-0", className)}
      style={{ gap }}
    >
      {bars.map((bar, i) => {
        const evidence = stateOf(bar.key);
        return (
          <li
            key={bar.key}
            className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i ? <Tip>{bar.tip}</Tip> : null}
            <span className="sr-only">{bar.tip}</span>
            <span className="relative flex w-full flex-1 items-end">
              {bar.ratio === null ? (
                <span
                  aria-hidden="true"
                  className="h-px w-full border-t border-dashed border-line"
                />
              ) : (
                <span
                  aria-hidden="true"
                  data-evidence={evidence}
                  className={cn(
                    "ds-grow block w-full rounded-t-[3px] rounded-b-[1px]",
                    bar.partial
                      ? "bg-transparent shadow-[inset_0_0_0_1px_var(--bar2)]"
                      : bar.current || evidence === "on" || hover === i
                        ? "bg-brand"
                        : "bg-bar"
                  )}
                  style={{
                    height: `${Math.max(2, bar.ratio * 100)}%`,
                    animationDelay: `${i * 20}ms`,
                  }}
                />
              )}
            </span>
            {showLabels ? (
              <span
                aria-hidden="true"
                className={cn(
                  "text-[11px] leading-3 whitespace-nowrap text-ink-3",
                  faceClass(bar.label)
                )}
              >
                {(bars.length - 1 - i) % every === 0 ? bar.label : "\u00a0"}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Previous vs current income/spending as paired horizontal bars. */
export function CashPairs({ pairs }: { pairs: CashPair[] }) {
  const { activeTag, isActive } = useTaggedEvidence("cash");
  // A cash fact (one day's 입금/지출) lights the viewed period's matching bar.
  const litName =
    activeTag === "cash.income" ? "수입" : activeTag === "cash.spending" ? "지출" : null;
  return (
    <div data-evidence-avoid="" className="flex flex-col gap-3.5">
      {pairs.map((pair) => (
        <div
          key={pair.label}
          className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1"
        >
          <span className="text-label row-span-2">{pair.label}</span>
          {(
            [
              ["수입", pair.income, pair.incomeRatio, "bg-[var(--bar2)]"],
              ["지출", pair.spending, pair.spendingRatio, "bg-ink-2"],
            ] as const
          ).map(([name, value, ratio, color]) => (
            <div key={name} className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                data-evidence={
                  isActive ? (pair.current && litName === name ? "on" : "dim") : undefined
                }
                className={cn(
                  "ds-growx h-2.5 shrink-0 rounded-[2px]",
                  pair.current && litName === name && isActive ? "bg-brand" : color
                )}
                style={{ width: `calc((100% - 104px) * ${Math.max(0.01, ratio)})` }}
              />
              <span className="text-xs whitespace-nowrap text-ink-2">
                {name} <span className="num text-ink">{wonColumn(value)}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Monthly net savings around a zero line (year view). */
export function NetBars({ bars, label }: { bars: NetBar[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { stateOf } = useTaggedEvidence("cash");
  return (
    <ul
      aria-label={label}
      data-evidence-avoid=""
      className="relative m-0 flex h-28 list-none gap-1.5 p-0"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-[50px] h-px bg-line" />
      {bars.map((bar, i) => {
        const h = Math.abs(bar.ratio) * 50;
        const evidence = stateOf(bar.key);
        return (
          <li
            key={bar.key}
            className="relative h-full flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i ? <Tip>{bar.tip}</Tip> : null}
            <span className="sr-only">{bar.tip}</span>
            <span
              aria-hidden="true"
              data-evidence={evidence}
              className={cn(
                "absolute inset-x-0 rounded-[2px]",
                evidence === "on" || hover === i
                  ? "bg-brand"
                  : bar.ratio >= 0
                    ? "bg-[var(--bar2)]"
                    : "bg-ink-2"
              )}
              style={{ top: bar.ratio >= 0 ? 50 - h : 50, height: Math.max(1.5, h) }}
            />
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-0 -bottom-0.5 text-center text-[11px] text-ink-3",
                faceClass(bar.label)
              )}
            >
              {bar.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Weight over the history window: before the period in a neutral stroke, inside
 * it in the health color, the peak marked, the last weigh-in emphasised.
 */
export function WeightLine({
  points,
  peak,
  axisFrom,
  axisTo,
  now,
}: {
  points: WeightPoint[];
  peak: WeightPoint | null;
  axisFrom: string;
  axisTo: string;
  now: Date;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const { stateOf } = useTaggedEvidence("weight");
  const H = 96;
  const W = Math.max(0, width);
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const t0 = t(axisFrom);
  const t1 = Math.max(t0 + 1, t(axisTo));
  const lo = Math.min(...points.map((p) => p.weight)) - 0.4;
  const hi = Math.max(...points.map((p) => p.weight)) + 0.4;
  const x = (d: string) => ((t(d) - t0) / (t1 - t0)) * (W - 8) + 4;
  const y = (v: number) => ((hi - v) / (hi - lo)) * (H - 8) + 4;
  const path = (list: WeightPoint[]) =>
    list
      .map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.weight).toFixed(1)}`)
      .join(" ");
  const inside = points.filter((p) => p.inside);
  const before = points.filter((p) => !p.inside);
  const last = points[points.length - 1];
  const highlighted = points.filter((p) => stateOf(p.date) === "on");
  return (
    <div ref={ref} className="relative w-full">
      {W > 0 ? (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`체중 추이: ${formatMonthDay(axisFrom, { now })}부터 ${formatMonthDay(last.date, { now })} ${last.weight.toFixed(1)}kg까지`}
          className="block overflow-visible"
        >
          {before.length > 0 ? (
            <path
              d={path([...before, ...inside.slice(0, 1)])}
              fill="none"
              stroke="var(--bar2)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          ) : null}
          <path
            d={path(inside)}
            fill="none"
            stroke="var(--health)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {inside.length <= 12
            ? inside.map((p) => (
                <circle key={p.date} cx={x(p.date)} cy={y(p.weight)} r="2.5" fill="var(--health)" />
              ))
            : null}
          {peak ? (
            <g>
              <line
                x1={x(peak.date)}
                x2={Math.min(x(peak.date) + 6, W - 36)}
                y1={y(peak.weight)}
                y2={y(peak.weight)}
                stroke="var(--ink3)"
              />
              <circle
                cx={x(peak.date)}
                cy={y(peak.weight)}
                r="3"
                fill="var(--bg)"
                stroke="var(--ink2)"
                strokeWidth="1.5"
              />
              <text
                x={Math.min(x(peak.date) + 6, W - 36)}
                y={y(peak.weight) + 4}
                dx="4"
                fontSize="11"
                fill="var(--ink2)"
                className="tabular-nums"
              >
                정점 {peak.weight.toFixed(1)}
              </text>
            </g>
          ) : null}
          {highlighted.map((p) => (
            <circle
              key={`hl-${p.date}`}
              cx={x(p.date)}
              cy={y(p.weight)}
              r="6"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
            />
          ))}
          <circle
            cx={x(last.date)}
            cy={y(last.weight)}
            r="4"
            fill="var(--health)"
            stroke="var(--bg)"
            strokeWidth="2"
          />
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      <div className="mt-1.5 flex justify-between">
        <span className="text-label">{formatMonthDay(axisFrom, { now })}</span>
        <span className="text-label">{formatMonthDay(axisTo, { now })}</span>
      </div>
    </div>
  );
}
