"use client";

import {
  computeWeightTrendGeometry,
  formatIndex,
  formatKcal,
  formatKg,
  formatPct,
  formatSignedDelta,
} from "@/lib/body-format";
import { formatRelativeTime } from "@/lib/utils";
import type { BodyResult } from "../service";
import { InsightCard } from "./primitives/InsightCard";

/** Full-layout skeleton so the card's shape is visible before any measurement. */
function BodyCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-2.5 w-8 rounded bg-muted" />
          <div className="h-8 w-24 rounded bg-muted" />
        </div>
        <div className="space-y-2 text-right">
          <div className="ml-auto h-2.5 w-10 rounded bg-muted" />
          <div className="ml-auto h-6 w-16 rounded bg-muted" />
        </div>
      </div>
      <div className="h-20 rounded bg-muted/60" />
      <div className="mt-1.5 flex justify-between">
        <div className="h-3 w-14 rounded bg-muted" />
        <div className="h-3 w-14 rounded bg-muted" />
        <div className="h-3 w-14 rounded bg-muted" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={`t-${i}`} className="h-16 rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        {[0, 1, 2].map((i) => (
          <div key={`a-${i}`} className="space-y-1.5">
            <div className="h-2.5 w-12 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface BodyCardProps {
  data: BodyResult | null;
  isLoading: boolean;
}

/** Neutral, direction-only delta chip — no red/green good-vs-bad coloring. */
function Delta({
  value,
  unit,
  digits = 1,
}: {
  value: number | null;
  unit: string;
  digits?: number;
}) {
  const label = formatSignedDelta(value, unit, digits);
  if (!label) return null;
  return <span className="text-[11px] text-ink-mute tabular-mono">{label}</span>;
}

/** One composition metric — value + neutral delta (or a caption fallback). */
function Tile({
  label,
  value,
  delta,
  unit,
  digits = 1,
  caption,
}: {
  label: string;
  value: string;
  delta: number | null;
  unit: string;
  digits?: number;
  caption?: string;
}) {
  const deltaLabel = formatSignedDelta(delta, unit, digits);
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">{label}</div>
      <div className="mt-1 tabular-mono text-lg font-semibold leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1 h-3.5 leading-none">
        {deltaLabel ? (
          <span className="text-[11px] text-ink-mute tabular-mono">{deltaLabel}</span>
        ) : caption ? (
          <span className="text-[10px] text-ink-mute">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Weight trend — raw measured points PLUS a smoothed "Trend Weight" line
 * (Withings-style exponential weighted average). Both are shown deliberately:
 * hiding the raw points behind only a smoothed line was a widely-disliked
 * Withings redesign choice.
 */
function WeightTrend({ series }: { series: { date: string; weight: number }[] }) {
  if (series.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center text-[11px] text-ink-mute">
        추이를 표시할 측정이 부족합니다
      </div>
    );
  }

  const W = 300;
  const H = 80;
  const { points, trendPath } = computeWeightTrendGeometry(series, { width: W, height: H, pad: 6 });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-foreground"
      style={{ height: H }}
      preserveAspectRatio="none"
      role="img"
      aria-label="체중 추이"
    >
      <title>체중 추이</title>
      {series.map((s, i) => (
        <circle
          key={s.date}
          cx={points[i].x}
          cy={points[i].y}
          r={1.5}
          fill="hsl(var(--ink-mute))"
        />
      ))}
      <path
        d={trendPath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 체성분 풀 카드 — 헤드라인 체중/체지방%, 추이, 체성분 타일, 보조 스탯. */
export function BodyCard({ data, isLoading }: BodyCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="cross" title="체성분" subtitle="Withings · 체중 · 체성분 추이">
        <div className="h-48 animate-pulse rounded bg-muted/20" />
      </InsightCard>
    );
  }

  if (!data || data.measurementCount === 0) {
    return (
      <InsightCard schema="cross" title="체성분" subtitle="Withings · 체중 · 체성분 추이">
        <BodyCardSkeleton />
      </InsightCard>
    );
  }

  const { weight, fatRatioPct, muscleMassKg, hydrationKg, boneMassKg, visceralFat } = data;
  const { bmrKcal, metabolicAge, heartRateBpm } = data;

  return (
    <InsightCard schema="cross" title="체성분" subtitle="Withings · 체중 · 체성분 추이">
      {/* ① Headline — 체중(큼) + 체지방률 + 직전 대비 델타(중립) */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">체중</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular-mono text-3xl font-semibold text-foreground">
              {formatKg(weight.latest)}
            </span>
            <Delta value={weight.delta} unit="kg" />
          </div>
          {data.latestMeasuredAt ? (
            <div className="mt-1 text-[11px] text-ink-mute">
              {formatRelativeTime(data.latestMeasuredAt)}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">체지방률</div>
          <div className="mt-1 flex items-baseline justify-end gap-2">
            <span className="tabular-mono text-2xl font-semibold text-foreground">
              {formatPct(fatRatioPct.latest)}
            </span>
            <Delta value={fatRatioPct.delta} unit="%" />
          </div>
        </div>
      </div>

      {/* ② 체중 추이 — 원시 측정점 + 부드러운 추세선 */}
      <WeightTrend series={data.weightSeries} />
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-mute tabular-mono">
        <span>최소 {formatKg(weight.min)}</span>
        <span>{data.measurementCount}회 측정</span>
        <span>최대 {formatKg(weight.max)}</span>
      </div>

      {/* ③ 체성분 — 개별 스탯 타일 그리드(스택/도넛 지양) */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="근육량"
          value={formatKg(muscleMassKg.latest)}
          delta={muscleMassKg.delta}
          unit="kg"
        />
        <Tile
          label="수분"
          value={formatKg(hydrationKg.latest)}
          delta={hydrationKg.delta}
          unit="kg"
        />
        <Tile
          label="뼈"
          value={formatKg(boneMassKg.latest)}
          delta={boneMassKg.delta}
          unit="kg"
          digits={2}
        />
        <Tile
          label="내장지방"
          value={formatIndex(visceralFat.latest, 1)}
          delta={visceralFat.delta}
          unit=""
          caption="정상 1–12"
        />
      </div>

      {/* ④ 보조 스탯 — 기초대사량 · 대사나이 · 심박 */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">기초대사량</div>
          <div className="mt-1 tabular-mono text-base font-semibold text-foreground">
            {formatKcal(bmrKcal.latest)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">대사나이</div>
          <div className="mt-1 tabular-mono text-base font-semibold text-foreground">
            {metabolicAge.latest == null ? "—" : `${Math.round(metabolicAge.latest)}세`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">심박</div>
          <div className="mt-1 tabular-mono text-base font-semibold text-foreground">
            {heartRateBpm.latest == null ? "—" : `${Math.round(heartRateBpm.latest)}bpm`}
          </div>
        </div>
      </div>
    </InsightCard>
  );
}
