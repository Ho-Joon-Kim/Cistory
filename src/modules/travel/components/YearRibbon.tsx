"use client";

import { useState } from "react";
import { useEvidence } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TravelListSummary } from "../hooks";
import { ribbonSpans, yearFraction } from "../list-model";

const QUARTER_MONTHS = new Set([1, 4, 7, 10]);

/**
 * The year as one strip: each trip a block at its dates, month ticks, a "오늘"
 * marker and the rest of the year faded. Hover/focus a block for its name and
 * dates; an AI line hovered above lights up the trips it cites.
 */
export function YearRibbon({ summary, today }: { summary: TravelListSummary; today: string }) {
  const { stateOf } = useEvidence();
  const [hover, setHover] = useState<string | null>(null);
  const spans = ribbonSpans(summary);
  const todayX = Math.min(1, Math.max(0, yearFraction(summary.year, today) + 0.5 / 365));
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    x: yearFraction(summary.year, `${summary.year}-${String(i + 1).padStart(2, "0")}-01`),
  }));
  const hovered = spans.find((s) => s.id === hover);

  return (
    <div className="relative mt-3 pt-5">
      <span
        className="absolute top-0 z-[1] -translate-x-1/2 bg-page px-1 text-xs leading-4 font-semibold text-ink"
        style={{ left: `${todayX * 100}%` }}
      >
        오늘
      </span>
      <div
        role="img"
        aria-label={`${summary.year}년 여행 달력: ${spans.length}건`}
        className="relative h-10"
      >
        <span className="absolute inset-x-0 top-4 h-2 rounded-full bg-track" />
        <span
          className="absolute top-4 right-0 h-2 rounded-r-full bg-page opacity-55"
          style={{ left: `${todayX * 100}%` }}
        />
        {months.map((m) => (
          <span
            key={m.month}
            aria-hidden="true"
            className={cn(
              "absolute top-2.5 h-5 w-px bg-line",
              !QUARTER_MONTHS.has(m.month) && "hidden lg:block"
            )}
            style={{ left: `${m.x * 100}%` }}
          />
        ))}
        {spans.map((span, i) => (
          <button
            key={span.id}
            type="button"
            aria-label={`${span.name} ${span.range} · ${span.stay}`}
            data-evidence={stateOf(span.id)}
            onMouseEnter={() => setHover(span.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(span.id)}
            onBlur={() => setHover(null)}
            className="ds-growx absolute top-1.5 h-7 cursor-default rounded-[3px] bg-place p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand data-[evidence=on]:bg-brand"
            style={{
              left: `${span.from * 100}%`,
              width: `max(3px, calc(${(span.to - span.from) * 100}% - 1px))`,
              animationDelay: `${i * 20}ms`,
            }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute top-0.5 h-9 w-[1.5px] bg-ink"
          style={{ left: `${todayX * 100}%` }}
        />
        {hovered ? (
          <div
            className="ds-pop pointer-events-none absolute top-12 z-20 -translate-x-1/2 rounded-[10px] bg-surface px-2.5 py-2 text-xs leading-[18px] whitespace-nowrap shadow-tip"
            style={{ left: `${((hovered.from + hovered.to) / 2) * 100}%` }}
          >
            <b className="font-semibold">{hovered.name}</b>{" "}
            <span className="text-ink-2">
              {hovered.range} · {hovered.stay}
            </span>
          </div>
        ) : null}
      </div>
      <div className="relative mt-1.5 h-4">
        {months.map((m) => (
          <span
            key={m.month}
            className={cn(
              "text-label absolute pl-1",
              !QUARTER_MONTHS.has(m.month) && "hidden lg:block",
              m.month === 10 && "max-lg:hidden"
            )}
            style={{ left: `${m.x * 100}%` }}
          >
            {m.month}월
          </span>
        ))}
      </div>
    </div>
  );
}
