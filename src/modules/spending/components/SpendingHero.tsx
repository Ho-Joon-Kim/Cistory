"use client";

import { useId } from "react";
import {
  CategoryMark,
  EvidenceScope,
  HeroNumber,
  panelClass,
  Segmented,
  useEvidence,
} from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatMonthDay, formatShare, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpendingTrendResponse } from "../types";
import { type HeroModel, heroSentence, SPLIT_CATEGORY, SPLIT_LABEL } from "../view-model";
import { BlockTitle, enter } from "./parts";
import { SpendingTrend } from "./SpendingTrend";

/** The split color: 의료·건강 hue washed into the page so ink stays the lead. */
export const SPLIT_FILL = "color-mix(in oklab, var(--cat-health) 62%, var(--bg))";

export type CompareMode = "all" | "ex";

const MODES = [
  { value: "all" as const, label: "전체" },
  { value: "ex" as const, label: `${SPLIT_LABEL} 제외` },
];

function SplitBar({ hero }: { hero: HeroModel }) {
  const { stateOf } = useEvidence();
  const hw = hero.total > 0 ? (hero.health / hero.total) * 100 : 0;
  return (
    <div
      role="img"
      aria-label={`${SPLIT_LABEL} ${formatWon(hero.health)}, 나머지 ${formatWon(hero.rest)}`}
      className="ds-growx flex h-2.5 gap-0.5 overflow-hidden rounded-full"
    >
      <span
        data-evidence={stateOf("health")}
        className="block h-full rounded-l-full"
        style={{ width: `${hw}%`, background: SPLIT_FILL }}
      />
      <span className="block h-full flex-1 rounded-r-full bg-ink" />
    </div>
  );
}

function Ladder({ hero, mode }: { hero: HeroModel; mode: CompareMode }) {
  const { stateOf } = useEvidence();
  const ex = mode === "ex";
  const rows = [
    {
      key: "current",
      label: hero.monthLabel,
      sub: `${hero.day}일째`,
      h: hero.health,
      r: hero.rest,
      current: true,
    },
    hero.previous
      ? {
          key: "previous",
          label: hero.previous.label,
          sub: "전체",
          h: hero.previous.health,
          r: hero.previous.rest,
          current: false,
        }
      : null,
    hero.average
      ? {
          key: "average",
          label: hero.average.label,
          sub: "월평균",
          h: hero.average.health,
          r: hero.average.rest,
          current: false,
        }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  const max = Math.max(1, ...rows.map((r) => (ex ? r.r : r.h + r.r)));
  return (
    <div className="border-t border-line">
      {rows.map((row) => {
        const value = ex ? row.r : row.h + row.r;
        return (
          <div
            key={row.key}
            className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5 sm:grid-cols-[76px_minmax(0,1fr)_112px]"
          >
            <div className="flex flex-col">
              <span
                className={cn("text-sm leading-5", row.current ? "font-semibold" : "font-medium")}
              >
                {row.label}
              </span>
              <span className="text-label">{row.sub}</span>
            </div>
            <div className="ds-growx flex h-2 gap-0.5">
              <span
                data-evidence={stateOf("health")}
                className="block h-full rounded-[2px] transition-[width,opacity] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
                style={{ width: `${ex ? 0 : (row.h / max) * 100}%`, background: SPLIT_FILL }}
              />
              <span
                className={cn(
                  "block h-full rounded-[2px] transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                  row.current ? "bg-ink" : "bg-ink-3"
                )}
                style={{ width: `${(row.r / max) * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "num text-right text-[0.9375rem] leading-[1.375rem]",
                row.current ? "font-semibold" : "font-medium"
              )}
            >
              {formatWon(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The month-to-date hero: total, a same-day change sentence, and the 의료·건강
 * split; then — always open, full width — the cumulative trend against last
 * month and the recent average with the month-end projection. Beside the hero
 * on PC (after the trend on phones) the same-basis comparison ladder. The 전체 /
 * 의료·건강 제외 switch sits on the trend and drives all three.
 */
export function SpendingHero({
  hero,
  trend,
  paceFact,
  mode,
  onModeChange,
}: {
  hero: HeroModel;
  trend: SpendingTrendResponse;
  paceFact: Fact | null;
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
}) {
  const forecastId = useId();
  const healthShare = hero.total > 0 ? hero.health / hero.total : 0;

  return (
    <EvidenceScope>
      <section
        aria-labelledby={`${forecastId}-title`}
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-x-6 lg:gap-y-12"
      >
        {/* The visible label is a small caption; the outline still needs the section's h2 so the
            aside's block title can step down to h3. */}
        <h2 id={`${forecastId}-title`} className="sr-only">
          {hero.monthLabel} 지출
        </h2>
        <div {...enter(1)} className={cn(panelClass, "ds-enter flex flex-col gap-5")}>
          <div className="flex flex-col gap-2">
            <span className="text-label">
              {hero.monthLabel} 지출 · {hero.day}일째
            </span>
            <HeroNumber value={hero.total} countUp format={formatCount} unit="원" unitSize="full" />
            <p className="m-0 max-w-[600px] text-[0.9375rem] leading-6 text-ink-2 sm:text-base">
              {heroSentence(hero, mode)}
            </p>
          </div>

          {hero.health > 0 ? (
            <div className="flex max-w-[600px] flex-col gap-3">
              <SplitBar hero={hero} />
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_220px] sm:gap-6">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <CategoryMark category={SPLIT_CATEGORY} size="sm" />
                    {SPLIT_LABEL} {hero.healthCount}건
                    <span className="num ml-auto font-medium sm:ml-1">
                      {formatWon(hero.health)}
                    </span>
                  </span>
                  <span className="truncate pl-7 text-xs leading-4 text-ink-3">
                    {hero.healthItem
                      ? `${hero.healthItem.merchant} · ${formatMonthDay(hero.healthItem.dayKey)} · `
                      : ""}
                    이번 달의 {formatShare(healthShare)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="grid w-5 flex-none place-items-center">
                      <span className="size-1.5 rounded-full bg-ink" />
                    </span>
                    나머지 {hero.restCount}건
                    <span className="num ml-auto font-medium sm:ml-1">{formatWon(hero.rest)}</span>
                  </span>
                  <span className="pl-7 text-xs leading-4 text-ink-3">
                    하루 <span className="num">{formatWon(hero.perDay)}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          {...enter(2)}
          className={cn(panelClass, "ds-enter min-w-0 lg:col-span-2 lg:row-start-2")}
        >
          <SpendingTrend
            trend={trend}
            hero={hero}
            mode={mode}
            paceFact={paceFact}
            headerAction={
              <Segmented
                items={MODES}
                value={mode}
                onChange={onModeChange}
                ariaLabel="비교 기준"
                className="sm:w-[242px]"
              />
            }
          />
        </div>

        <div
          {...enter(3)}
          className={cn(
            panelClass,
            "ds-enter flex flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:pt-5"
          )}
        >
          <div className="flex min-h-9 items-center">
            <BlockTitle>같은 기준으로 비교</BlockTitle>
          </div>
          <Ladder hero={hero} mode={mode} />
        </div>
      </section>
    </EvidenceScope>
  );
}

/** One skeleton line. */
function Bone({ className }: { className: string }) {
  return <span className={cn("block rounded bg-track", className)} />;
}

/**
 * Loading shape of {@link SpendingHero}: the same grid, the hero number's
 * height, the trend chart's measured height (184 phone / 232 PC) and the
 * readout's rows, so nothing below jumps when the data lands — and nothing says
 * "no records" before the request has answered.
 */
export function SpendingHeroSkeleton() {
  const rows = (n: number, key: string) =>
    Array.from({ length: n }, (_, i) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
        key={`${key}-${i}`}
        className="grid h-[57px] grid-cols-[64px_minmax(0,1fr)_96px] items-center gap-3 border-b border-line"
      >
        <Bone className="h-3.5 w-10" />
        <Bone className="h-2 w-3/4" />
        <Bone className="h-3.5 w-full" />
      </span>
    ));
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="이번 달 지출 불러오는 중"
      className="ds-delayed-in grid grid-cols-1 gap-10 lg:-mt-6 lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-x-6 lg:gap-y-12"
    >
      <div className="flex flex-col gap-2">
        <Bone className="h-3 w-28" />
        <Bone className="mt-1 h-11 w-64 rounded-md sm:h-14 sm:w-80" />
        <Bone className="mt-2 h-4 w-full max-w-[600px]" />
        <Bone className="h-4 w-2/3 max-w-[400px]" />
        <Bone className="mt-4 h-2.5 w-full max-w-[600px] rounded-full" />
        <span className="mt-2 flex max-w-[600px] flex-col gap-3 sm:flex-row sm:gap-6">
          <Bone className="h-9 w-full sm:w-1/2" />
          <Bone className="h-9 w-full sm:w-[220px]" />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:row-start-2">
        <div className="flex flex-col gap-1.5">
          <Bone className="h-4 w-20" />
          <Bone className="h-3 w-56" />
          {/* The 전체 / 의료·건강 제외 switch stacks under the title on phones. */}
          <Bone className="mt-1.5 h-11 w-full rounded-[10px] sm:hidden" />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-6">
          <div className="pt-5 pb-6">
            <span className="block h-[184px] rounded-md bg-track/60 sm:h-[232px]" />
          </div>
          <div className="flex flex-col border-t border-line lg:mt-9">{rows(4, "trend")}</div>
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:pt-5">
        <Bone className="h-4 w-28" />
        <div className="flex flex-col border-t border-line">{rows(3, "ladder")}</div>
      </div>
    </div>
  );
}
