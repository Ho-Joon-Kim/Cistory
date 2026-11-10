"use client";

import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { AiLine, EmptyState, ErrorState, EvidenceScope, useEvidence } from "@/components/ds";
import { evidenceMatches } from "@/lib/facts/evidence";
import { formatDay, formatMonthDay, formatTime } from "@/lib/format";
import { useAnimatedNumber } from "@/lib/hooks/useCountUp";
import { cn } from "@/lib/utils";
import type { BodyResult } from "@/modules/insights/service";
import { rhrFact, sleepFact, weightFact } from "../health-facts";
import type { HealthMetricSeries, HealthSleepSession, SleepStageKey } from "../types";
import {
  buildNights,
  fmtNum,
  type Night,
  nightTicks,
  type RhrView,
  rhrView,
  STAGE_LABEL,
  STAGE_LANES,
  sleepComparison,
  type WeightView,
  weightView,
} from "../view-model";

// ── shared bits ──────────────────────────────────────────────────────────────

/** A column of the hero row: a flex stack on phones, six subgrid rows from lg. */
const COLUMN = "flex min-w-0 flex-col lg:row-span-6 lg:grid lg:grid-rows-subgrid";

/** Stage marks: tokens in globals.css, each ≥3:1 against the page in both themes. */
export const STAGE_BG: Record<SleepStageKey, string> = {
  deep: "var(--sleep-deep)",
  rem: "var(--sleep-rem)",
  light: "var(--sleep-light)",
  awake: "var(--ink3)",
};

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="text-label flex items-center gap-1.5">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-health" />
      {children}
      {aside ? <span className="ml-auto font-normal text-ink-2 tabular-nums">{aside}</span> : null}
    </div>
  );
}

function Hero({ children }: { children: ReactNode }) {
  return (
    <span className="num block text-[2.25rem] leading-10 font-medium tracking-[-0.03em] text-ink lg:text-[3rem] lg:leading-[3.25rem]">
      {children}
    </span>
  );
}

function HeroUnit({ children }: { children: ReactNode }) {
  return (
    <span className="font-sans text-base font-medium tracking-normal text-ink-3 lg:text-lg">
      {children}
    </span>
  );
}

function Cmp({ lead, sub }: { lead?: ReactNode; sub?: ReactNode }) {
  return (
    <p className="m-0 text-sm leading-[1.375rem] text-ink">
      {lead}
      {sub ? (
        // The comparison wraps as a unit ("중앙값 68보다 3 낮음"), never leaving
        // an orphaned "낮음" on the second line of a narrow column. The "·" is
        // glued (nbsp) to the end of the lead, so a wrapped line never starts
        // with a dangling separator.
        <span className="text-ink-2">
          {lead ? "\u00a0· " : null}
          <span className="whitespace-nowrap">{sub}</span>
        </span>
      ) : null}
    </p>
  );
}

function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-0.5">
      <span className="text-label break-keep">{label}</span>
      <span className="num text-[0.9375rem] leading-[1.375rem] text-ink">{value}</span>
    </div>
  );
}

const pct = (n: number) => `${n}%`;

// ── sleep ────────────────────────────────────────────────────────────────────

function Hypnogram({ night, compact }: { night: Night; compact?: boolean }) {
  const { active } = useEvidence();
  const ticks = nightTicks(night);
  const h = compact ? 112 : 132;
  return (
    <div
      className={cn(
        "grid",
        compact
          ? "grid-cols-[40px_minmax(0,1fr)] gap-x-1.5"
          : "grid-cols-[44px_minmax(0,1fr)] gap-x-2"
      )}
    >
      <div
        className="grid grid-rows-4 text-[0.6875rem] leading-[0.875rem] text-ink-3"
        style={{ height: h }}
      >
        {STAGE_LANES.map((s) => (
          <span key={s} className="self-center">
            {STAGE_LABEL[s]}
          </span>
        ))}
      </div>
      <div
        className="relative"
        style={{ height: h }}
        role="img"
        aria-label={`수면 단계 그래프 · ${formatTime(night.start)}–${formatTime(night.end)}`}
      >
        {STAGE_LANES.map((s, i) => (
          <span
            key={s}
            aria-hidden="true"
            className="absolute inset-x-0 h-1/4 border-t border-dashed border-line"
            style={{ top: `${i * 25}%` }}
          />
        ))}
        {night.segments.map((g) => {
          const on = active ? evidenceMatches(active, `stage:${g.stage}`) : null;
          return (
            <span
              key={`${g.stage}-${g.startMin}`}
              aria-hidden="true"
              className="absolute mt-[3px] h-[calc(25%-6px)] rounded-[3px] transition-[opacity,background-color] duration-150"
              style={{
                left: pct((g.startMin / night.inBed) * 100),
                width: pct(Math.max(0.35, ((g.endMin - g.startMin) / night.inBed) * 100)),
                top: pct(STAGE_LANES.indexOf(g.stage) * 25),
                background: on ? "var(--brand)" : STAGE_BG[g.stage],
                opacity: on === false ? 0.22 : 1,
              }}
            />
          );
        })}
      </div>
      <span />
      <div className="relative mt-1.5 h-4">
        {ticks.map((t, i) => (
          <span
            key={t.label}
            className={cn(
              "absolute top-0 -translate-x-1/2 text-[0.6875rem] leading-[0.875rem] tracking-normal whitespace-nowrap text-ink-3 tabular-nums",
              // Below ~360px hourly labels touch; keep every other hour.
              i % 2 === 1 && "max-[359px]:hidden"
            )}
            style={{ left: pct(t.pct) }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function NightStrip({
  nights,
  index,
  onPick,
  compact,
}: {
  nights: Night[];
  index: number;
  onPick: (i: number) => void;
  compact?: boolean;
}) {
  const maxBed = Math.max(...nights.map((n) => n.inBed));
  const ordered = nights.map((n, i) => ({ n, i })).reverse();
  const barH = compact ? 52 : 64;
  return (
    <div
      className={cn("grid items-end", compact ? "gap-0" : "gap-0.5")}
      style={{ gridTemplateColumns: `repeat(${Math.max(ordered.length, 7)}, minmax(0, 1fr))` }}
    >
      {ordered.map(({ n, i }, j) => {
        const [, m, d] = n.wakeDay.split("-").map(Number);
        const prevMonth = j > 0 ? Number(ordered[j - 1].n.wakeDay.split("-")[1]) : null;
        const monthLabel = prevMonth !== m ? `${m}월` : "";
        const on = i === index;
        const stageHeight = (v: number) => pct((v / maxBed) * 100);
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={on}
            aria-label={`${formatDay(n.wakeDay)} 밤 수면 ${Math.floor(n.asleep / 60)}시간 ${n.asleep % 60}분`}
            onClick={() => onPick(i)}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg border-0 bg-transparent pt-1.5 pb-1 transition-[background-color,scale] duration-150 ease-out active:scale-[.96] focus-visible:outline-2 focus-visible:outline-brand",
              on ? "bg-brand-soft" : "hover:bg-track"
            )}
          >
            <span className="flex items-end" style={{ height: barH }}>
              <span
                className="flex flex-col-reverse overflow-hidden rounded-[3px]"
                style={{ height: barH, width: compact ? 12 : 16 }}
              >
                {(["deep", "rem", "light", "awake"] as const).map((s) => (
                  <span
                    key={s}
                    style={{ height: stageHeight(n.stages[s]), background: STAGE_BG[s] }}
                  />
                ))}
              </span>
            </span>
            {compact ? (
              <>
                <span
                  className={cn(
                    "text-[0.6875rem] leading-[0.875rem] whitespace-nowrap",
                    on ? "font-semibold text-ink" : "text-ink-3"
                  )}
                >
                  {d}일
                </span>
                <span className="min-h-[0.8125rem] text-[0.625rem] leading-[0.8125rem] text-ink-3">
                  {monthLabel}
                </span>
              </>
            ) : (
              <span
                className={cn(
                  "text-[0.6875rem] leading-[0.875rem] whitespace-nowrap",
                  on ? "font-semibold text-ink" : "text-ink-3"
                )}
              >
                {monthLabel ? `${monthLabel} ` : ""}
                {d}일
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StageLegend({ night }: { night: Night }) {
  return (
    <div className="grid grid-cols-4 gap-2 lg:gap-3">
      {(["deep", "rem", "light", "awake"] as const).map((s) => (
        <div key={s} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: STAGE_BG[s] }}
            />
            {STAGE_LABEL[s]}
          </span>
          <span className="num text-[0.9375rem] leading-[1.375rem] text-ink">
            {night.stages[s]}
            <span className="font-sans text-xs font-medium tracking-normal text-ink-3">분</span>
            <span className="ml-1.5 hidden text-xs text-ink-3 lg:inline">
              {Math.round((night.stages[s] / night.inBed) * 100)}%
            </span>
          </span>
          <span className="num text-xs leading-4 text-ink-3 lg:hidden">
            {Math.round((night.stages[s] / night.inBed) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function SleepColumn({ sessions, today }: { sessions: HealthSleepSession[]; today: string }) {
  const nights = useMemo(() => buildNights(sessions), [sessions]);
  const [index, setIndex] = useState(0);
  const night = nights[index];
  const asleep = useAnimatedNumber(night?.asleep ?? 0, { from: 0, duration: 900 });

  if (!night) {
    return (
      <div className={cn(COLUMN, "pt-5 lg:pt-6 lg:pr-8")}>
        <Label>수면</Label>
        <EmptyState
          className="mt-3 lg:row-span-5"
          title="최근 수면 기록이 없어요"
          description="Fitbit이 수면 단계를 기록하면 지난밤 수면이 여기에 표시돼요."
        />
      </div>
    );
  }
  const cmp = sleepComparison(nights, index);
  const fact = sleepFact(nights, index);
  const yesterday = night.wakeDay === today;
  const title = index === 0 && yesterday ? "어젯밤 수면" : `${formatMonthDay(night.wakeDay)} 수면`;
  const span = `${formatTime(night.start)}–${formatTime(night.end)}`;
  const shown = Math.round(asleep);

  return (
    <EvidenceScope>
      <section aria-label="수면" className={cn(COLUMN, "pt-5 lg:pt-6 lg:pr-8")}>
        <Label
          aside={
            <>
              <span className="hidden lg:inline">{formatDay(night.wakeDay)} </span>
              {span}
            </>
          }
        >
          {title}
        </Label>
        <div className="pt-2 lg:pt-2.5">
          <Hero>
            {Math.floor(shown / 60)}
            <HeroUnit>시간 </HeroUnit>
            {shown % 60}
            <HeroUnit>분</HeroUnit>
          </Hero>
        </div>
        {/* Comparison and AI line share the two subgrid rows as one block, so a
            neighbouring column whose comparison wraps (안정시 심박 at 1024) leaves
            its slack below the AI line instead of as a gap above it. */}
        <div className="flex flex-col lg:row-span-2">
          <div className="pt-1.5 lg:pt-2">
            {cmp ? (
              <Cmp lead={<span className="font-medium">{cmp.rank}</span>} sub={cmp.diff} />
            ) : null}
          </div>
          <div className="pt-1.5 lg:max-w-[592px]">
            <AiLine fact={fact} rows={fact?.rows} title="수면 해석" tint />
          </div>
        </div>
        <div className="pt-5 lg:pt-6">
          <div className="lg:hidden">
            <Hypnogram night={night} compact />
          </div>
          <div className="hidden lg:block">
            <Hypnogram night={night} />
            <div className="mt-5">
              <NightStrip nights={nights} index={index} onPick={setIndex} />
            </div>
          </div>
        </div>
        <div className="pt-4 lg:pt-5 lg:pb-6">
          <StageLegend night={night} />
          <div className="mt-4 lg:hidden">
            <NightStrip nights={nights} index={index} onPick={setIndex} compact />
          </div>
        </div>
      </section>
    </EvidenceScope>
  );
}

// ── line plots ───────────────────────────────────────────────────────────────

interface PlotPoint {
  key: string;
  x: number; // 0..100
  y: number; // 0..100
}

function polyline(points: PlotPoint[]) {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function RhrPlot({ view, height, compact }: { view: RhrView; height: number; compact?: boolean }) {
  const { active } = useEvidence();
  const lo = view.min - 2;
  const hi = view.max + 2;
  const n = view.days.length - 1;
  const pts: PlotPoint[] = view.values.flatMap((v, i) =>
    v == null ? [] : [{ key: view.days[i], x: (i / n) * 100, y: (1 - (v - lo) / (hi - lo)) * 100 }]
  );
  const run = pts.filter((p) => p.key >= view.days[view.runStart]);
  const medTop = (1 - (view.median - lo) / (hi - lo)) * 100;
  return (
    <div className="relative" style={{ height }}>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 border-t border-dashed border-bar"
        style={{ top: pct(medTop) }}
      >
        {compact ? null : (
          <span className="absolute left-0 translate-y-0.5 text-[0.6875rem] leading-[0.875rem] tracking-normal text-ink-3">
            중앙값 <span className="num">{view.median}</span>
          </span>
        )}
      </span>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible"
      >
        <polyline
          points={polyline(pts)}
          fill="none"
          stroke="var(--bar)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={polyline(run)}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="transition-opacity duration-150"
          style={{ opacity: active ? 1 : 0 }}
        />
      </svg>
      {pts.map((p) => {
        const v = view.values[view.days.indexOf(p.key)];
        const isMin = v === view.min;
        const on = active ? evidenceMatches(active, p.key) : null;
        const size = isMin ? 9 : compact ? 5 : 6;
        return (
          <span
            key={p.key}
            aria-hidden="true"
            className="absolute rounded-full transition-[opacity,background-color] duration-150"
            style={{
              left: pct(p.x),
              top: pct(p.y),
              width: size,
              height: size,
              margin: `${-size / 2}px 0 0 ${-size / 2}px`,
              background: on ? "var(--brand)" : isMin ? "var(--health)" : "var(--ink2)",
              boxShadow: isMin ? "0 0 0 2px var(--bg)" : undefined,
              opacity: on === false ? 0.25 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

function RhrColumn({ series, days }: { series: HealthMetricSeries | undefined; days: string[] }) {
  const view = useMemo(() => rhrView(series, days), [series, days]);
  const shown = useAnimatedNumber(view?.latest ?? 0, { from: 0, duration: 900 });
  const base = "pt-5 border-t border-line mt-7 lg:mt-0 lg:border-t-0 lg:border-l lg:px-8 lg:pt-6";
  if (!view) {
    return (
      <div className={cn(COLUMN, base)}>
        <Label>안정시 심박</Label>
        <EmptyState
          className="mt-3 lg:row-span-5"
          title="안정시 심박 기록이 없어요"
          description="최근 30일 동안 측정된 값이 없어요."
        />
      </div>
    );
  }
  const fact = rhrFact(view);
  return (
    <EvidenceScope>
      <section aria-label="안정시 심박" className={cn(COLUMN, base)}>
        <Label>안정시 심박</Label>
        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-x-4 pt-2 lg:block lg:pt-2.5">
          <Hero>
            {Math.round(shown)}
            <HeroUnit> bpm</HeroUnit>
          </Hero>
          <div className="lg:hidden">
            <RhrPlot view={view} height={72} compact />
          </div>
        </div>
        <div className="pt-2.5 lg:pt-2">
          <Cmp
            lead={view.cmp ? <span className="font-medium">{view.cmp}</span> : null}
            sub={view.diff}
          />
        </div>
        <div className="pt-1.5">
          <AiLine fact={fact} rows={fact?.rows} title="안정시 심박 해석" tint />
        </div>
        <div className="hidden pt-6 lg:block">
          <RhrPlot view={view} height={272} />
          <div className="mt-1.5 flex justify-between text-[0.6875rem] leading-[0.875rem] text-ink-3">
            <span>{formatMonthDay(view.days[0])}</span>
            <span>{formatMonthDay(view.days[view.days.length - 1])}</span>
          </div>
        </div>
        <div className="hidden grid-cols-3 gap-3 pt-5 pb-6 lg:grid">
          <Stat label="최저" value={view.min} />
          <Stat label="최고" value={view.max} />
          <Stat label="측정일" value={`${view.recorded}일`} />
        </div>
      </section>
    </EvidenceScope>
  );
}

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

function WeightPlot({ view, height }: { view: WeightView; height: number }) {
  const { active } = useEvidence();
  const d0 = dayNum(view.points[0].date);
  const d1 = Math.max(d0 + 1, dayNum(view.latest.date));
  const x = (d: string) => ((dayNum(d) - d0) / (d1 - d0)) * 100;
  const y = (w: number) => (1 - (w - view.lo) / (view.hi - view.lo)) * 100;
  const pts = view.points.map((p) => ({ key: p.date, x: x(p.date), y: y(p.weight) }));
  const last7 = new Set(view.points.slice(-7).map((p) => p.date));
  const bandFrom = view.points.length >= 14 ? x(view.points[view.points.length - 14].date) : null;
  const months: { left: number; label: string }[] = [];
  {
    const [y0, m0] = view.points[0].date.split("-").map(Number);
    for (let k = 1; k < 24; k++) {
      const dt = new Date(Date.UTC(y0, m0 - 1 + k, 1));
      const key = dt.toISOString().slice(0, 10);
      if (dayNum(key) > d1) break;
      months.push({ left: x(key), label: `${dt.getUTCMonth() + 1}월` });
    }
  }
  return (
    <>
      <div className="relative" style={{ height }}>
        {bandFrom != null ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 bg-brand-soft transition-opacity duration-150"
            style={{ left: pct(bandFrom), right: 0, opacity: active ? 1 : 0 }}
          />
        ) : null}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 size-full overflow-visible"
        >
          <polyline
            points={polyline(pts)}
            fill="none"
            stroke="var(--ink2)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {pts.map((p) => {
          const on = active ? evidenceMatches(active, p.key) : null;
          return (
            <span
              key={p.key}
              aria-hidden="true"
              className="absolute size-[5px] -mt-[2.5px] -ml-[2.5px] rounded-full transition-[opacity,background-color] duration-150"
              style={{
                left: pct(p.x),
                top: pct(p.y),
                background: on ? (last7.has(p.key) ? "var(--brand)" : "var(--ink)") : "var(--ink3)",
                opacity: on === false ? 0.25 : 1,
              }}
            />
          );
        })}
        <span
          aria-hidden="true"
          className="absolute size-[9px] -mt-[4.5px] -ml-[4.5px] rounded-full bg-health shadow-[0_0_0_2px_var(--bg)]"
          style={{ left: pct(x(view.peak.date)), top: pct(y(view.peak.weight)) }}
        />
        <span
          className="absolute -translate-x-1/2 -translate-y-[22px] text-[0.6875rem] leading-[0.875rem] whitespace-nowrap text-ink-2"
          style={{ left: pct(x(view.peak.date)), top: pct(y(view.peak.weight)) }}
        >
          최고 <span className="num">{fmtNum(view.peak.weight, 1)}</span>
        </span>
        <span
          aria-hidden="true"
          className="absolute size-1.5 -mt-[3px] -ml-[3px] rounded-full bg-ink"
          style={{ left: pct(x(view.latest.date)), top: pct(y(view.latest.weight)) }}
        />
      </div>
      <div className="relative mt-1.5 h-3.5">
        {months.map((m) => (
          <span
            key={m.label}
            className="absolute top-0 -translate-x-1/2 text-[0.6875rem] leading-[0.875rem] whitespace-nowrap text-ink-3"
            style={{ left: pct(m.left) }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </>
  );
}

function WeightColumn({
  body,
  isLoading,
  error,
  onRetry,
  today,
}: {
  body: BodyResult | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  today: string;
}) {
  const view = useMemo(() => weightView(body?.weightSeries, today), [body, today]);
  const shown = useAnimatedNumber(view?.latest.weight ?? 0, {
    from: view?.peak.weight ?? 0,
    duration: 900,
    decimals: 1,
  });
  const base = "mt-7 lg:mt-0 lg:border-l lg:border-line lg:pt-6 lg:pl-8";

  if (!view) {
    return (
      <div className={cn(COLUMN, base)}>
        <Label>체중</Label>
        <div className="mt-3 lg:row-span-5">
          {error ? (
            <ErrorState
              title="체성분 기록을 불러오지 못했어요"
              description="잠시 후 다시 시도해 주세요."
              actions={
                <button
                  type="button"
                  onClick={onRetry}
                  className="h-9 cursor-pointer rounded-[9px] border-0 bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-ring hover:shadow-ring-hover active:scale-[.96]"
                >
                  다시 시도
                </button>
              }
            />
          ) : isLoading ? null : (
            <EmptyState
              title="체성분 측정 기록이 아직 없어요"
              description="Withings 체중계로 측정하면 체중 추이가 여기에 표시돼요."
            />
          )}
        </div>
      </div>
    );
  }
  const fact = weightFact(view);
  const fat = body?.fatRatioPct.latest;
  return (
    <EvidenceScope>
      <section aria-label="체중" className={cn(COLUMN, base)}>
        <Label>체중</Label>
        <div className="pt-2 lg:pt-2.5">
          <Hero>
            {fmtNum(shown, 1)}
            <HeroUnit> kg</HeroUnit>
          </Hero>
        </div>
        <div className="pt-1.5 lg:pt-2">
          {view.fromPeak < 0 ? (
            <p className="m-0 text-sm leading-[1.375rem] text-ink">
              {formatMonthDay(view.peak.date)} 최고 {fmtNum(view.peak.weight, 1)}kg보다{" "}
              <span className="num font-semibold">{fmtNum(view.fromPeak, 1)}kg</span>
            </p>
          ) : (
            <Cmp lead={<span className="font-medium">최근 120일 중 최고</span>} />
          )}
        </div>
        <div className="pt-1.5">
          <AiLine fact={fact} rows={fact?.rows} title="체중 추세 해석" tint />
        </div>
        <div className="pt-7 lg:pt-6">
          <div className="lg:hidden">
            <WeightPlot view={view} height={140} />
          </div>
          <div className="hidden lg:block">
            <WeightPlot view={view} height={272} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-3.5 lg:gap-3 lg:pt-5 lg:pb-6">
          <Stat
            label={
              <>
                최저 · <span className="whitespace-nowrap">{formatMonthDay(view.low.date)}</span>
              </>
            }
            value={fmtNum(view.low.weight, 1)}
          />
          <Stat label="체지방률" value={fat != null ? `${fmtNum(fat, 1)}%` : "—"} />
          <Stat label="측정" value={`${body?.measurementCount ?? view.points.length}회`} />
        </div>
      </section>
    </EvidenceScope>
  );
}

// ── row ──────────────────────────────────────────────────────────────────────

export function HeroRow({
  sessions,
  rhr,
  days,
  today,
  body,
  bodyLoading,
  bodyError,
  onBodyRetry,
  style,
  className,
}: {
  sessions: HealthSleepSession[];
  rhr: HealthMetricSeries | undefined;
  days: string[];
  today: string;
  body: BodyResult | null;
  bodyLoading: boolean;
  bodyError: string | null;
  onBodyRetry: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section
      aria-label="핵심 지표"
      style={style}
      className={cn(
        "border-t border-line lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,3fr)_minmax(0,3fr)] lg:grid-rows-[repeat(6,auto)] lg:border-b",
        className
      )}
    >
      <SleepColumn sessions={sessions} today={today} />
      <RhrColumn series={rhr} days={days} />
      <WeightColumn
        body={body}
        isLoading={bodyLoading}
        error={bodyError}
        onRetry={onBodyRetry}
        today={today}
      />
    </section>
  );
}
