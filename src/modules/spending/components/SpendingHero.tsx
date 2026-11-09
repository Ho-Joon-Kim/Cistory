"use client";

import { useId, useState } from "react";
import {
  AiLine,
  CategoryMark,
  EvidenceScope,
  HeroNumber,
  Segmented,
  useEvidence,
} from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatMonthDay, formatShare, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpendingTrendResponse } from "../types";
import { type HeroModel, heroSentence, SPLIT_CATEGORY, SPLIT_LABEL } from "../view-model";
import { ForecastChart } from "./ForecastChart";
import { BlockTitle, DisclosureButton, enter } from "./parts";

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
                "num text-right text-[15px] leading-[22px]",
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

function Forecast({ trend, monthLabel }: { trend: SpendingTrendResponse; monthLabel: string }) {
  const f = trend.forecast;
  const oneOff = f.oneOffTotal ?? 0;
  const day = Math.max(1, f.todayDayNumber);
  const perDay = Math.round(Math.max(0, f.currentMonthActualTotal - oneOff) / day);
  const restProjection = Math.max(0, f.predictedTotal - oneOff);
  return (
    <div className="ds-reveal flex flex-col gap-3.5 pt-1">
      <div className="flex items-baseline gap-3">
        <span className="num text-[22px] leading-7 font-medium">{formatWon(f.predictedTotal)}</span>
        <span className="text-sm leading-[22px] text-ink-2">
          {monthLabel} {f.daysInMonth}일까지
        </span>
      </div>
      <p className="ai-voice m-0">
        {oneOff > 0 ? (
          <>
            1회성 결제 <span className="num">{formatWon(oneOff)}</span>은 한 번만 더하고, 나머지는
            하루 <span className="num">{formatWon(perDay)}</span> 속도로 {f.daysInMonth}일을 채워{" "}
            <span className="num">{formatWon(restProjection)}</span>으로 봤어요.
          </>
        ) : (
          <>
            하루 <span className="num">{formatWon(perDay)}</span> 속도로 {f.daysInMonth}일을 채워
            봤어요.
          </>
        )}
      </p>
      <ForecastChart
        curve={trend.cumulativeCurve}
        today={f.todayDayNumber}
        daysInMonth={f.daysInMonth}
        predicted={f.predictedTotal}
        upper={f.upperBound}
        lower={f.lowerBound}
        monthLabel={monthLabel}
      />
      <span className="text-xs leading-[18px] text-ink-3">
        점선 범위{" "}
        <span className="num">
          {formatWon(f.lowerBound)}–{formatWon(f.upperBound)}
        </span>{" "}
        · 지난 달들이 오르내린 폭만큼 열어 둔 구간이에요
      </span>
    </div>
  );
}

/**
 * The month-to-date hero: total, the 의료·건강 split, a plain comparison
 * sentence, the pace line, and (closed) the month-end forecast. Beside it on
 * PC — below on phones — the same-basis comparison ladder.
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
  const [forecastOpen, setForecastOpen] = useState(false);
  const forecastId = useId();
  const showForecast = trend.forecast.todayDayNumber < trend.forecast.daysInMonth;
  const healthShare = hero.total > 0 ? hero.health / hero.total : 0;

  return (
    <EvidenceScope>
      <section
        aria-label={`${hero.monthLabel} 지출`}
        className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-6"
      >
        <div {...enter(1)} className="ds-enter flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-label">
              {hero.monthLabel} 지출 · {hero.day}일째
            </span>
            <HeroNumber value={hero.total} countUp format={formatCount} unit="원" />
            <p className="m-0 max-w-[600px] text-[15px] leading-6 text-ink-2 sm:text-base">
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

          {paceFact ? (
            <AiLine fact={paceFact} rows={paceFact.rows} className="max-w-[600px]" />
          ) : null}

          {showForecast ? (
            <div className="hidden max-w-[640px] flex-col gap-3 border-t border-line pt-1 lg:flex">
              <DisclosureButton
                open={forecastOpen}
                onToggle={() => setForecastOpen((v) => !v)}
                controls={`${forecastId}-pc`}
                className="self-start"
              >
                월말 예상
              </DisclosureButton>
              <div id={`${forecastId}-pc`}>
                {forecastOpen ? <Forecast trend={trend} monthLabel={hero.monthLabel} /> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div {...enter(2)} className="ds-enter flex flex-col gap-4 lg:pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <BlockTitle as="h2">같은 기준으로 비교</BlockTitle>
            <Segmented
              items={MODES}
              value={mode}
              onChange={onModeChange}
              ariaLabel="비교 기준"
              className="sm:w-[242px]"
            />
          </div>
          <Ladder hero={hero} mode={mode} />
          {showForecast ? (
            <div className="flex flex-col gap-3 lg:hidden">
              <DisclosureButton
                open={forecastOpen}
                onToggle={() => setForecastOpen((v) => !v)}
                controls={`${forecastId}-m`}
                className="self-start"
              >
                월말 예상
              </DisclosureButton>
              <div id={`${forecastId}-m`}>
                {forecastOpen ? <Forecast trend={trend} monthLabel={hero.monthLabel} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </EvidenceScope>
  );
}
