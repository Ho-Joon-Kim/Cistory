"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEvidence } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TravelListSummary } from "../hooks";
import { nearestSpan, ribbonSpans, yearFraction } from "../list-model";

const QUARTER_MONTHS = new Set([1, 4, 7, 10]);
/** How far (px) from a block a pointer may land and still pick it. */
const HIT_SLOP_PX = 22;

/**
 * The year as one strip: each trip a block at its dates, month ticks, a "오늘"
 * marker and the rest of the year faded. Hover/focus a block for its name and
 * dates; an AI line hovered above lights up the trips it cites.
 *
 * Blocks are only a few px wide on a phone, so the buttons themselves don't
 * take pointer input: one overlay over the strip snaps every pointer to the
 * nearest block (within {@link HIT_SLOP_PX}), which gives each trip a usable
 * hit area without ever resolving a tap to a trip the finger wasn't nearest.
 * A tap pins the tooltip until the next tap elsewhere; a second tap on the
 * pinned trip (or a mouse click, or Enter on a focused block) opens it.
 */
export function YearRibbon({ summary, today }: { summary: TravelListSummary; today: string }) {
  const { stateOf } = useEvidence();
  // Pointer picks go through the block's own link, so navigation stays
  // client-side (the links are what keyboard users activate directly).
  const open = (id: string) =>
    rootRef.current?.querySelector<HTMLAnchorElement>(`a[data-span-id="${id}"]`)?.click();
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipLeft, setTipLeft] = useState<number | null>(null);
  const spans = ribbonSpans(summary);
  const todayX = Math.min(1, Math.max(0, yearFraction(summary.year, today) + 0.5 / 365));
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    x: yearFraction(summary.year, `${summary.year}-${String(i + 1).padStart(2, "0")}-01`),
  }));
  const activeId = hover ?? pinned;
  const hovered = spans.find((s) => s.id === activeId);

  const spanAt = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return nearestSpan(spans, (event.clientX - rect.left) / rect.width, HIT_SLOP_PX / rect.width);
  };

  // Clamp the tooltip inside the strip (which already sits inside the page gutter).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tip = tipRef.current;
    if (!hovered || !strip || !tip) {
      setTipLeft(null);
      return;
    }
    const width = strip.clientWidth;
    const tipWidth = tip.offsetWidth;
    const centre = ((hovered.from + hovered.to) / 2) * width;
    setTipLeft(Math.max(0, Math.min(width - tipWidth, centre - tipWidth / 2)));
  }, [hovered]);

  // A pinned (tapped) tooltip stays until a tap lands outside the strip.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <div ref={rootRef} className="relative pt-4">
      <span
        className="absolute top-0 z-[1] -translate-x-1/2 bg-page px-1 text-xs leading-4 font-semibold text-ink"
        style={{ left: `${todayX * 100}%` }}
      >
        오늘
      </span>
      <div
        ref={stripRef}
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
          <Link
            key={span.id}
            href={`/travel/${span.id}`}
            data-span-id={span.id}
            aria-label={`${span.name} ${span.range} · ${span.stay}`}
            data-evidence={stateOf(span.id)}
            data-active={activeId === span.id ? "true" : undefined}
            onFocus={() => setHover(span.id)}
            onBlur={() => setHover(null)}
            className="ds-growx pointer-events-none absolute top-1.5 h-7 cursor-default rounded-[3px] bg-place p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:outline-solid data-[active=true]:bg-brand data-[evidence=on]:bg-brand"
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
        {/* Pointer overlay: 44px tall (strip + padding), snaps to the nearest block. */}
        <div
          aria-hidden="true"
          data-testid="year-ribbon-hit"
          className={cn("absolute inset-x-0 -top-0.5 h-11", hover && "cursor-pointer")}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") setHover(spanAt(event)?.id ?? null);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setHover(null);
          }}
          onClick={(event) => {
            // Mouse: a click opens the block under the pointer (keyboard users get
            // the same through the focusable blocks).
            const native = event.nativeEvent as globalThis.PointerEvent;
            if (native.pointerType && native.pointerType !== "mouse") return;
            const id = spanAt(event)?.id;
            if (id) open(id);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") return;
            const id = spanAt(event)?.id ?? null;
            if (id && id === pinned) {
              open(id);
              return;
            }
            setPinned(id);
          }}
        />
        {hovered ? (
          <div
            ref={tipRef}
            data-testid="year-ribbon-tip"
            className="ds-pop pointer-events-none absolute top-12 z-20 rounded-[10px] bg-surface px-2.5 py-2 text-xs leading-[18px] whitespace-nowrap shadow-tip"
            style={{
              left: tipLeft ?? 0,
              visibility: tipLeft === null ? "hidden" : undefined,
            }}
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
