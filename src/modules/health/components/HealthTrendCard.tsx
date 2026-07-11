"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthMetricSeries } from "@/modules/health/hooks";

const WINDOW_DAYS = 30;
const CHART_HEIGHT = 44;

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

/**
 * Accumulation metrics (steps, distance): 0-baseline bars — bar height is
 * proportional to the daily total, which is the meaningful reading.
 */
function SumBars({ axis, series }: { axis: AxisPoint[]; series: HealthMetricSeries }) {
  const values = axis.map((a) => a.sum).filter((v): v is number => v != null);
  const maxV = Math.max(...values);
  return (
    <div className="flex items-end gap-[2px]" style={{ height: CHART_HEIGHT }}>
      {axis.map((a) =>
        a.sum == null ? (
          <div key={a.day} className="flex-1" aria-hidden />
        ) : (
          <div
            key={a.day}
            className="flex-1 rounded-t-sm bg-primary/70"
            style={{ height: maxV > 0 ? Math.max(2, (a.sum / maxV) * CHART_HEIGHT) : 2 }}
            title={`${a.day}: ${formatValue(a.sum, series.decimals)} ${series.unit}`}
          />
        )
      )}
    </div>
  );
}

/**
 * Average / instantaneous metrics (heart rate, SpO2, VO2max): a range plot — each
 * day is a faint min→max bar with a solid dot at the average — scaled to the
 * window's actual [min, max] (NOT zero), so day-to-day variation is visible rather
 * than flattened against a far-off zero baseline.
 */
function AvgRange({
  axis,
  domainMin,
  domainMax,
  series,
}: {
  axis: AxisPoint[];
  domainMin: number;
  domainMax: number;
  series: HealthMetricSeries;
}) {
  const span = domainMax - domainMin;
  // pixels from the top; higher value → nearer the top. Flat series → mid-height.
  const yTop = (v: number) => (span > 0 ? 1 - (v - domainMin) / span : 0.5) * CHART_HEIGHT;
  return (
    <div className="flex items-stretch gap-[2px]" style={{ height: CHART_HEIGHT }}>
      {axis.map((a) => (
        <div key={a.day} className="relative flex-1">
          {a.avg != null ? (
            <>
              {a.min != null && a.max != null ? (
                <div
                  className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-primary/25"
                  style={{ top: yTop(a.max), height: Math.max(3, yTop(a.min) - yTop(a.max)) }}
                  aria-hidden
                />
              ) : null}
              <div
                className="absolute left-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
                style={{ top: yTop(a.avg) }}
                title={`${a.day}: ${formatValue(a.avg, series.decimals)} ${series.unit}`}
              />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function HealthTrendCard({ series }: { series: HealthMetricSeries }) {
  const isSum = series.agg === "sum";
  const axis = buildAxis(series);

  // Chart footer + latest read from the field this metric is actually about.
  const primary = axis.map((a) => (isSum ? a.sum : a.avg)).filter((v): v is number => v != null);
  const hasData = primary.length > 0;
  const latest = [...axis].reverse().find((a) => (isSum ? a.sum : a.avg) != null);
  const latestValue = latest ? (isSum ? latest.sum : latest.avg) : null;

  // Footer range: sum → min/max of daily totals; avg → the range-plot's domain.
  const lows = axis.map((a) => a.min).filter((v): v is number => v != null);
  const highs = axis.map((a) => a.max).filter((v): v is number => v != null);
  const footMin = isSum ? Math.min(...primary) : Math.min(...(lows.length ? lows : primary));
  const footMax = isSum ? Math.max(...primary) : Math.max(...(highs.length ? highs : primary));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {series.label}
          </CardTitle>
          {latestValue != null ? (
            <div className="text-right">
              <span className="text-xl font-semibold tabular-nums">
                {formatValue(latestValue, series.decimals)}
              </span>
              <span className="ml-1 text-xs text-muted-foreground">{series.unit}</span>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <>
            {isSum ? (
              <SumBars axis={axis} series={series} />
            ) : (
              <AvgRange axis={axis} domainMin={footMin} domainMax={footMax} series={series} />
            )}
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>
                최근 {WINDOW_DAYS}일 · 최소 {formatValue(footMin, series.decimals)}
              </span>
              <span>최대 {formatValue(footMax, series.decimals)}</span>
            </div>
          </>
        ) : (
          <div
            className="flex items-center justify-center text-xs text-muted-foreground"
            style={{ height: CHART_HEIGHT }}
          >
            데이터 없음
          </div>
        )}
      </CardContent>
    </Card>
  );
}
