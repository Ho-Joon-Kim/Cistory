"use client";

import type { CSSProperties, ReactNode } from "react";
import { AiLine, EmptyState, EvidenceScope, useEvidence } from "@/components/ds";
import { toKstCalendarDate } from "@/lib/date-key";
import { evidenceMatches } from "@/lib/facts/evidence";
import { formatDateRange, formatDay, formatTime } from "@/lib/format";
import { useAnimatedNumber } from "@/lib/hooks/useCountUp";
import { cn } from "@/lib/utils";
import { workoutFact } from "../health-facts";
import type { HealthWorkout } from "../types";
import { groupWorkouts, type WorkoutIcon, workoutIcon, workoutName } from "../view-model";

const SHADES = ["var(--ink)", "var(--ink2)", "var(--ink3)", "var(--bar)", "var(--line)"];

const ICON_PATHS: Record<WorkoutIcon, ReactNode> = {
  bike: (
    <>
      <circle cx="5.5" cy="17" r="3.5" />
      <circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17l4-8h6l3 8M9.5 9L8 6H6M15.5 9l-3 8h-7" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4" r="2" />
      <path d="M10 22l2-7 3 3v4M7 13l2-5 4-1 3 4 3 1M12 15l-1-6" />
    </>
  ),
  run: (
    <>
      <circle cx="15" cy="4" r="2" />
      <path d="M6 21l3-6 3 2 1 4M5 11l3-3h5l3 4h3M12 8l-2 7" />
    </>
  ),
  lift: <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />,
  swim: (
    <path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5S16 18 18 18s2-1.5 4-1.5M8 13l4-5 4 3" />
  ),
  act: <path d="M3 12h4l3-8 4 16 3-8h4" />,
};

function Icon({ kind }: { kind: WorkoutIcon }) {
  return (
    <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-sunken text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[kind]}
      </svg>
    </span>
  );
}

function Body({ workouts }: { workouts: HealthWorkout[] }) {
  const { active } = useEvidence();
  const groups = groupWorkouts(workouts);
  const total = workouts.reduce((a, w) => a + w.minutes, 0);
  const shownTotal = useAnimatedNumber(total, { from: 0, duration: 900 });
  const fact = workoutFact(workouts);
  const hotName = fact ? String(fact.detail?.name) : null;
  const first = toKstCalendarDate(new Date(workouts[workouts.length - 1].start));
  const last = toKstCalendarDate(new Date(workouts[0].start));
  const range = formatDateRange(first, last);

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-6">
      <div className="flex flex-col gap-1 lg:pr-12">
        <div className="flex items-baseline justify-between lg:flex-col lg:items-start lg:gap-1">
          <h2
            id="h-wo"
            className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[1.375rem] lg:leading-[1.875rem]"
          >
            운동
          </h2>
          <span className="text-[0.8125rem] leading-5 text-ink-2 lg:text-sm lg:leading-[1.375rem]">
            {range}
          </span>
        </div>
        <p className="m-0 mt-2 lg:mt-4">
          <span className="num text-[1.375rem] leading-7 font-medium tracking-[-0.03em] text-ink">
            {workouts.length}회
          </span>
          <span className="text-[0.9375rem] font-medium text-ink-3"> · </span>
          <span className="num text-[1.375rem] leading-7 font-medium tracking-[-0.03em] text-ink">
            {Math.round(shownTotal)}
          </span>
          <span className="text-[0.9375rem] font-medium text-ink-3">분</span>
        </p>
        <div className="mt-1.5 lg:mt-2">
          <AiLine fact={fact} rows={fact?.rows} title="운동 기록 해석" tint />
        </div>
        <div
          aria-hidden="true"
          className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] lg:mt-5"
        >
          {groups.map((g, i) => {
            const on = active ? g.name === hotName : null;
            return (
              <span
                key={g.name}
                className="ds-growx h-full transition-opacity duration-150"
                style={{
                  width: `${g.share * 100}%`,
                  background: on ? "var(--brand)" : (SHADES[i] ?? "var(--line)"),
                  opacity: on === false ? 0.25 : 1,
                }}
              />
            );
          })}
        </div>
        <ul className="m-0 mt-1 list-none p-0 lg:mt-2">
          {groups.map((g, i) => (
            <li
              key={g.name}
              className="grid grid-cols-[10px_minmax(0,1fr)_36px_48px_40px] items-center gap-2.5 border-b border-line py-2 text-[0.8125rem] leading-[1.375rem] lg:grid-cols-[10px_minmax(0,1fr)_44px_52px_44px] lg:py-2.5 lg:text-sm"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-[2px]"
                style={{ background: SHADES[i] ?? "var(--line)" }}
              />
              <span className="truncate text-ink">{g.name}</span>
              <span className="num text-right text-ink-2">{g.count}회</span>
              <span className="num text-right text-ink">
                {g.minutes}
                <span className="font-sans text-xs font-medium tracking-normal text-ink-3">분</span>
              </span>
              <span className="num text-right text-xs text-ink-3 lg:text-[0.8125rem]">
                {Math.round(g.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="m-0 mt-4 list-none p-0 lg:mt-0 lg:max-w-[600px] lg:pt-2">
        {workouts.map((w, k) => {
          const on = active ? evidenceMatches(active, w.start) : null;
          return (
            <li
              key={w.start}
              className={cn(
                "-mx-2 grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-2.5 transition-[background-color,opacity] duration-150",
                k > 0 && "shadow-[0_-1px_0_var(--line)]",
                on && "bg-brand-soft",
                on === false && "opacity-40"
              )}
            >
              <Icon kind={workoutIcon(w.type)} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm leading-[1.375rem] font-medium text-ink">
                  {workoutName(w)}
                </span>
                <span className="text-xs leading-4 text-ink-3 tabular-nums">
                  {formatDay(new Date(w.start))} {formatTime(new Date(w.start))}
                </span>
              </span>
              <span>
                <span className="num text-[0.9375rem] text-ink">{w.minutes}</span>
                <span className="text-xs font-medium text-ink-3">분</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WorkoutsSection({
  workouts,
  style,
  className,
}: {
  workouts: HealthWorkout[];
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <EvidenceScope>
      <section aria-labelledby="h-wo" className={className} style={style}>
        {workouts.length > 0 ? (
          <Body workouts={workouts} />
        ) : (
          <>
            <h2
              id="h-wo"
              className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[1.375rem] lg:leading-[1.875rem]"
            >
              운동
            </h2>
            <EmptyState
              className="mt-3"
              title="최근 30일 운동 기록이 없어요"
              description="Fitbit에 기록된 운동이 생기면 여기에 표시돼요."
            />
          </>
        )}
      </section>
    </EvidenceScope>
  );
}
