"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toKstCalendarDate } from "@/lib/date-key";
import { cn } from "@/lib/utils";
import {
  barIndexAt,
  COMMIT_GRAPH_DAYS,
  commitGraphBars,
  commitGraphLabel,
  type DailyCommitStat,
} from "./commit-graph";

interface StatsResponse {
  stats: DailyCommitStat[];
}

async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch("/api/timeline/stats");
  if (!response.ok) throw new Error(`stats ${response.status}`);
  return response.json();
}

/** The bar a navigation key moves to, or null for keys the strip ignores. */
function keyTarget(key: string, current: number, count: number): number | null {
  const steps: Record<string, number> = {
    ArrowLeft: current - 1,
    ArrowRight: current + 1,
    Home: 0,
    End: count - 1,
  };
  return key in steps ? Math.min(count - 1, Math.max(0, steps[key])) : null;
}

/** How long a tapped bar's tooltip stays up after the finger lifts. */
const TAP_TIP_MS = 2500;

/**
 * The app-bar commit strip: last 28 days, √-scaled bar heights, 5-step brand
 * ramp, today underlined, a tooltip per bar ("11월 9일 · 커밋 22"). Keeps its
 * footprint (111×20, compact 83×16) while loading so the bar never shifts.
 *
 * The tooltip follows the mouse, a tap (or a horizontal scrub — the strip has a
 * padded hit area) on touch, and ←/→/Home/End when the strip has keyboard focus
 * (one tab stop, exposed as a slider over the 28 days).
 */
export function CommitGraph({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery({
    queryKey: ["timeline", "stats"],
    queryFn: fetchStats,
    staleTime: 5 * 60_000,
  });

  const bars = useMemo(
    () => (data?.stats ? commitGraphBars(data.stats, toKstCalendarDate(new Date())) : null),
    [data]
  );

  const stripRef = useRef<HTMLSpanElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = bars?.length ?? 0;

  const clearTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const pick = useCallback(
    (clientX: number) => {
      const strip = stripRef.current;
      if (!strip || count === 0) return;
      const r = strip.getBoundingClientRect();
      setActiveIndex(barIndexAt(clientX, r.left, r.width, count));
    },
    [count]
  );

  // A tap elsewhere dismisses a touch-opened tooltip.
  useEffect(() => {
    if (activeIndex === null) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!stripRef.current?.contains(event.target as Node)) setActiveIndex(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [activeIndex]);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    clearTimer();
    pick(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse" || event.buttons > 0) pick(event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse") return;
    clearTimer();
    hideTimer.current = setTimeout(() => setActiveIndex(null), TAP_TIP_MS);
  };
  const onPointerLeave = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse") setActiveIndex(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (count === 0) return;
    if (event.key === "Escape") {
      setActiveIndex(null);
      return;
    }
    const next = keyTarget(event.key, activeIndex ?? count - 1, count);
    if (next === null) return;
    event.preventDefault();
    clearTimer();
    setActiveIndex(next);
  };

  const className = cn("ds-hcg", compact && "is-compact");
  if (!bars || bars.length === 0) {
    return (
      <span className={className} aria-hidden="true">
        {Array.from({ length: COMMIT_GRAPH_DAYS }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
          <i key={i} />
        ))}
      </span>
    );
  }

  const shown = activeIndex ?? count - 1;
  return (
    <span
      ref={stripRef}
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={commitGraphLabel(bars)}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={shown + 1}
      aria-valuetext={bars[shown]?.tip}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onFocus={() => setActiveIndex((i) => i ?? count - 1)}
      onBlur={() => setActiveIndex(null)}
    >
      {bars.map((bar, i) => (
        <i
          key={bar.date}
          data-level={bar.level}
          data-today={bar.isToday ? "" : undefined}
          data-active={i === activeIndex ? "" : undefined}
          data-tip={bar.tip}
          style={bar.height ? ({ "--h": bar.height } as CSSProperties) : undefined}
        />
      ))}
    </span>
  );
}
