"use client";

import { type ReactNode, useMemo, useState } from "react";
import { AiLine, FactTrigger } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatMonthDay, formatShare, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpendingTrendResponse } from "../types";
import {
  forecastRows,
  type HeroModel,
  SPLIT_LABEL,
  type TrendModel,
  tickLabel,
  trendModel,
  trendValueAt,
} from "../view-model";
import { BlockTitle } from "./parts";
import type { CompareMode } from "./SpendingHero";
import { TREND_STROKES, type TrendAnnotation, TrendChart } from "./TrendChart";

/** A 24px stroke sample in the series' own line style — the legend's swatch. */
function LineSample({ kind }: { kind: keyof typeof TREND_STROKES }) {
  const s = TREND_STROKES[kind];
  return (
    <svg aria-hidden="true" width="24" height="10" viewBox="0 0 24 10" className="flex-none">
      <line
        x1={2}
        x2={22}
        y1={5}
        y2={5}
        stroke={s.stroke}
        strokeOpacity={kind === "previous" ? 0.7 : 1}
        strokeWidth={s.width}
        strokeDasharray={s.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LegendRow({
  kind,
  label,
  sub,
  value,
  strong = false,
}: {
  kind: keyof typeof TREND_STROKES;
  label: string;
  sub?: string | null;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5">
      <LineSample kind={kind} />
      <div className="flex min-w-0 flex-col">
        <span
          className={cn("truncate text-sm leading-5", strong ? "font-semibold" : "font-medium")}
        >
          {label}
        </span>
        {sub ? <span className="truncate text-label">{sub}</span> : null}
      </div>
      <span
        className={cn(
          "num text-right text-[0.9375rem] leading-[1.375rem]",
          strong ? "font-semibold" : "font-medium"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Legend that doubles as the readout: every line's value on the cursor day (today by default). */
function Readout({
  model,
  cursor,
  monthLabel,
}: {
  model: TrendModel;
  cursor: number | null;
  monthLabel: string;
}) {
  const day = cursor ?? model.today;
  const projected = day > model.today;
  const current = trendValueAt(model, day);
  const f = model.forecast;
  return (
    <div className="flex flex-col">
      <span aria-live="polite" className="pb-1.5 text-label">
        {cursor === null ? `오늘(${day}일)까지 누적` : `${day}일까지 누적`}
      </span>
      <div className="border-t border-line">
        <LegendRow
          kind={projected ? "forecast" : "actual"}
          label={monthLabel}
          sub={projected ? "이 속도라면" : model.mode === "ex" ? `${SPLIT_LABEL} 제외` : null}
          value={current === null ? "–" : formatWon(current)}
          strong
        />
        {model.references.map((r) => {
          const v = r.values[day - 1] ?? 0;
          const diff = !projected && current !== null ? current - v : null;
          return (
            <LegendRow
              key={r.key}
              kind={r.key}
              label={r.label}
              sub={
                diff === null || v <= 0
                  ? "같은 날"
                  : `같은 날 · 이번 달이 ${formatWon(Math.abs(diff))} ${diff >= 0 ? "더" : "덜"}`
              }
              value={formatWon(v)}
            />
          );
        })}
        {f ? (
          <LegendRow
            kind="forecast"
            label="월말 예상"
            sub={
              f.range
                ? `범위 ${tickLabel(f.range.lower)}–${tickLabel(f.range.upper)}원`
                : "하루 속도 그대로"
            }
            value={formatWon(f.mid)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** "이대로면 11월은 2,6xx,xxx원쯤에서 끝나요 — 10월 전체보다 …" with the method as evidence. */
function ForecastLine({
  trend,
  model,
  hero,
  paceFact,
}: {
  trend: SpendingTrendResponse;
  model: TrendModel;
  hero: HeroModel;
  paceFact: Fact | null;
}) {
  const f = model.forecast;
  if (!f) return null;
  // Without 의료·건강 the existing pace fact already says this, against the same basis.
  if (model.mode === "ex" && paceFact) {
    return <AiLine fact={paceFact} rows={paceFact.rows} className="max-w-[600px]" />;
  }
  const prev = hero.previous;
  const prevValue = prev ? (model.mode === "ex" ? prev.rest : prev.total) : 0;
  const diff = f.mid - prevValue;
  return (
    <AiLine className="max-w-[600px]" evidence={{ kind: "keys", keys: ["forecast"] }}>
      {model.mode === "ex" ? `${SPLIT_LABEL}을 빼고 이 속도라면 ` : "이대로면 "}
      {hero.monthLabel}은{" "}
      <FactTrigger rows={forecastRows(trend, model)} numeric title="이 예상에 쓴 사실">
        {formatWon(f.mid)}
      </FactTrigger>
      쯤에서 끝나요
      {prev && prevValue > 0
        ? ` — ${prev.label} 전체보다 ${formatWon(Math.abs(diff))} ${diff >= 0 ? "많아요" : "적어요"}.`
        : "."}
    </AiLine>
  );
}

/**
 * The month's cumulative spending as a first-class block right under the hero:
 * this month against last month and the recent average day by day, today's
 * marker, and the month-end projection with its range. Method and drivers sit
 * behind the AI line's one dotted fact; the chart itself never collapses.
 */
export function SpendingTrend({
  trend,
  hero,
  mode,
  paceFact,
  headerAction,
}: {
  trend: SpendingTrendResponse;
  hero: HeroModel;
  mode: CompareMode;
  paceFact: Fact | null;
  headerAction?: ReactNode;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const model = useMemo(() => trendModel(trend, mode), [trend, mode]);

  const annotation: TrendAnnotation | null =
    mode === "all" && hero.healthItem && hero.health > 0
      ? {
          day: Number(hero.healthItem.dayKey.slice(8, 10)),
          label: `${SPLIT_LABEL} ${tickLabel(hero.health)}`,
          rows: [
            { label: hero.healthItem.merchant, value: formatWon(hero.health) },
            { label: "날짜", value: formatMonthDay(hero.healthItem.dayKey) },
            {
              label: "이번 달 비중",
              value: formatShare(hero.total > 0 ? hero.health / hero.total : 0),
            },
          ],
          evidence: { kind: "keys", keys: ["health"] },
        }
      : null;

  const empty = model.now <= 0;

  return (
    <div className="flex flex-col gap-4" data-fact-host="">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <BlockTitle>누적 지출</BlockTitle>
          <span className="text-label">
            {hero.monthLabel} {model.today}일째 · 지난달·최근 평균과 같은 날끼리 비교
          </span>
        </div>
        {headerAction}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-6">
        <div className="min-w-0">
          <TrendChart
            model={model}
            cursor={cursor}
            onCursor={setCursor}
            monthLabel={hero.monthLabel}
            annotation={annotation}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:pt-3">
          <Readout model={model} cursor={cursor} monthLabel={hero.monthLabel} />
          {empty ? (
            <p className="m-0 text-sm leading-[1.375rem] text-ink-2">
              이번 달 지출이 아직 없어서 월말 예상은 첫 기록부터 그려요.
            </p>
          ) : (
            <ForecastLine trend={trend} model={model} hero={hero} paceFact={paceFact} />
          )}
        </div>
      </div>
    </div>
  );
}
