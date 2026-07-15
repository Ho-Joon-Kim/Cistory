"use client";

import type { HealthMetricSeries } from "@/modules/health/hooks";
import { metricAccent } from "@/modules/health/metrics-meta";
import { InsightCard } from "@/modules/insights/components/primitives/InsightCard";
import { HoverLayer } from "./HoverLayer";

const WINDOW_DAYS = 30;
const VB_W = 300;
const VB_H = 56;
const TOP = 6;
const BASE = 46;

/** Local 'YYYY-MM-DD' keys for the last `n` days, oldest → newest. */
function lastNDays(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${d.getFullYear()}-${m}-${day}`);
  }
  return out;
}

function formatValue(v: number, decimals: number): string {
  return v.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 'YYYY-MM-DD' → 'M.D' for tooltips. */
function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}.${Number(d)}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Static height pattern for the empty-state skeleton chart.
const SKELETON_BARS = [
  40, 55, 35, 60, 45, 70, 50, 38, 62, 48, 58, 42, 66, 52, 44, 60, 36, 54, 68, 46, 50, 40, 58, 34,
  62, 48, 56, 42, 64, 50,
].map((h, i) => ({ id: `${i}-${h}`, h }));

function SkeletonChart() {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: VB_H }}>
      {SKELETON_BARS.map((b) => (
        <div
          key={b.id}
          className="flex-1 animate-pulse rounded-t-sm bg-muted"
          style={{ height: `${b.h}%` }}
        />
      ))}
    </div>
  );
}

interface AxisPoint {
  day: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  sum: number | null;
}

/** Dense 30-day axis (missing days stay null → rendered as gaps), values scaled. */
function buildAxis(series: HealthMetricSeries): AxisPoint[] {
  const scale = series.scale ?? 1;
  const byDay = new Map(series.points.map((p) => [p.day, p]));
  return lastNDays(WINDOW_DAYS).map((day) => {
    const p = byDay.get(day);
    const s = (v: number | null | undefined) => (v == null ? null : v * scale);
    return { day, avg: s(p?.avg), min: s(p?.min), max: s(p?.max), sum: s(p?.sum) };
  });
}

const slot = VB_W / WINDOW_DAYS;
const bw = slot - 2;

/** Accumulation metrics (steps, distance, exercise): 0-baseline bars + median line. */
function SumBars({
  axis,
  accent,
  todayIdx,
  active,
}: {
  axis: AxisPoint[];
  accent: string;
  todayIdx: number;
  active: number | null;
}) {
  const values = axis.map((a) => a.sum).filter((v): v is number => v != null);
  const maxV = Math.max(...values, 1);
  const med = median(values);
  const barH = (v: number) => Math.max(2, (v / maxV) * (BASE - TOP));
  const medY = BASE - (med / maxV) * (BASE - TOP);
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="block h-auto w-full"
      style={{ overflow: "visible" }}
    >
      <title>일별 누적 추이</title>
      {med > 0 ? (
        <line
          x1={0}
          y1={medY}
          x2={VB_W}
          y2={medY}
          stroke="hsl(0 0% 100% / 0.14)"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
      ) : null}
      {axis.map((a, i) => {
        if (a.sum == null)
          return <rect key={a.day} x={i * slot + 1} y={BASE} width={bw} height={0} />;
        const h = barH(a.sum);
        const isToday = i === todayIdx;
        const isActive = i === active;
        return (
          <rect
            key={a.day}
            x={i * slot + 1}
            y={BASE - h}
            width={bw}
            height={h}
            rx={1.5}
            fill={accent}
            fillOpacity={isToday || isActive ? 1 : 0.5}
            filter={isToday ? `drop-shadow(0 0 4px ${accent})` : undefined}
          >
            <title>{`${shortDay(a.day)}: ${a.sum}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Instant metrics (heart rate, SpO2, VO2max, resting HR): min–avg–max range plot. */
function AvgRange({
  axis,
  accent,
  domainMin,
  domainMax,
  active,
}: {
  axis: AxisPoint[];
  accent: string;
  domainMin: number;
  domainMax: number;
  active: number | null;
}) {
  const span = domainMax - domainMin;
  const yTop = (v: number) => (span > 0 ? 1 - (v - domainMin) / span : 0.5) * (BASE - TOP) + TOP;
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="block h-auto w-full"
      style={{ overflow: "visible" }}
    >
      <title>일별 범위 추이</title>
      {axis.map((a, i) => {
        if (a.avg == null) return <rect key={a.day} x={i * slot} width={slot} height={0} />;
        const cx = i * slot + slot / 2;
        const isActive = i === active;
        return (
          <g key={a.day}>
            {a.min != null && a.max != null ? (
              <line
                x1={cx}
                y1={yTop(a.max)}
                x2={cx}
                y2={yTop(a.min)}
                stroke={accent}
                strokeOpacity={isActive ? 0.5 : 0.28}
                strokeWidth={3}
                strokeLinecap="round"
              />
            ) : null}
            <circle
              cx={cx}
              cy={yTop(a.avg)}
              r={isActive ? 3.6 : 2.4}
              fill={accent}
              filter={isActive ? `drop-shadow(0 0 4px ${accent})` : undefined}
            >
              <title>{`${shortDay(a.day)}: ${a.avg}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

export function HealthTrendCard({ series }: { series: HealthMetricSeries }) {
  const isSum = series.agg === "sum";
  const accent = metricAccent(series.key);
  const axis = buildAxis(series);

  const primary = axis.map((a) => (isSum ? a.sum : a.avg)).filter((v): v is number => v != null);
  const hasData = primary.length > 0;
  let todayIdx = -1;
  for (let i = axis.length - 1; i >= 0; i--) {
    if ((isSum ? axis[i].sum : axis[i].avg) != null) {
      todayIdx = i;
      break;
    }
  }
  const latestValue = todayIdx >= 0 ? (isSum ? axis[todayIdx].sum : axis[todayIdx].avg) : null;

  const lows = axis.map((a) => a.min).filter((v): v is number => v != null);
  const highs = axis.map((a) => a.max).filter((v): v is number => v != null);
  const footMin = isSum ? Math.min(...primary) : Math.min(...(lows.length ? lows : primary));
  const footMax = isSum ? Math.max(...primary) : Math.max(...(highs.length ? highs : primary));

  const title = (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
      {series.label}
    </span>
  );
  const right =
    latestValue != null ? (
      <span className="tabular-mono">
        <span className="text-xl font-semibold text-foreground">
          {formatValue(latestValue, series.decimals)}
        </span>
        <span className="ml-1 text-[11px] text-ink-mute">{series.unit}</span>
      </span>
    ) : (
      <span className="block h-5 w-12 animate-pulse rounded bg-muted" />
    );

  const tip = (a: AxisPoint) => {
    const v = isSum ? a.sum : a.avg;
    if (v == null) {
      return (
        <span className="text-ink-mute">
          {shortDay(a.day)} · <span>기록 없음</span>
        </span>
      );
    }
    return (
      <span>
        <span className="text-ink-mute">{shortDay(a.day)}</span>{" "}
        <span className="tabular-mono font-semibold text-foreground">
          {formatValue(v, series.decimals)}
        </span>{" "}
        <span className="text-ink-mute">{series.unit}</span>
        {!isSum && a.min != null && a.max != null ? (
          <span className="ml-1 tabular-mono text-ink-mute">
            ({formatValue(a.min, series.decimals)}–{formatValue(a.max, series.decimals)})
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <InsightCard title={title} right={right}>
      {hasData ? (
        <>
          <HoverLayer
            items={axis}
            tooltip={tip}
            render={(active) =>
              isSum ? (
                <SumBars axis={axis} accent={accent} todayIdx={todayIdx} active={active} />
              ) : (
                <AvgRange
                  axis={axis}
                  accent={accent}
                  domainMin={footMin}
                  domainMax={footMax}
                  active={active}
                />
              )
            }
          />
          <div className="mt-2 flex justify-between text-[10.5px] text-ink-mute tabular-mono">
            <span>
              최근 {WINDOW_DAYS}일 · {isSum ? "중앙값" : "최소"}{" "}
              {formatValue(isSum ? median(primary) : footMin, series.decimals)}
            </span>
            <span>최대 {formatValue(footMax, series.decimals)}</span>
          </div>
        </>
      ) : (
        <>
          <SkeletonChart />
          <div className="mt-2 text-[10.5px] text-ink-mute">데이터 없음</div>
        </>
      )}
    </InsightCard>
  );
}
