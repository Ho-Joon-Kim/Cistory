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

export function HealthTrendCard({ series }: { series: HealthMetricSeries }) {
  const scale = series.scale ?? 1;
  const pointValue = (p: HealthMetricSeries["points"][number]): number | null => {
    const raw = series.agg === "sum" ? p.sum : p.avg;
    return raw == null ? null : raw * scale;
  };

  // Index points by day, then walk a dense 30-day axis so missing days become
  // visual gaps (AE6) rather than zero-height bars.
  const byDay = new Map(series.points.map((p) => [p.day, p]));
  const axis = lastNDays(WINDOW_DAYS).map((day) => {
    const p = byDay.get(day);
    return { day, value: p ? pointValue(p) : null };
  });

  const values = axis.map((a) => a.value).filter((v): v is number => v != null);
  const hasData = values.length > 0;
  const maxV = hasData ? Math.max(...values) : 0;
  const minV = hasData ? Math.min(...values) : 0;
  const latest = [...axis].reverse().find((a) => a.value != null)?.value ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {series.label}
          </CardTitle>
          {latest != null ? (
            <div className="text-right">
              <span className="text-xl font-semibold tabular-nums">
                {formatValue(latest, series.decimals)}
              </span>
              <span className="ml-1 text-xs text-muted-foreground">{series.unit}</span>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <>
            <div className="flex items-end gap-[2px]" style={{ height: CHART_HEIGHT }}>
              {axis.map((a) => {
                if (a.value == null) {
                  // gap — a missing day is not zero
                  return <div key={a.day} className="flex-1" aria-hidden />;
                }
                const h = maxV > 0 ? Math.max(2, (a.value / maxV) * CHART_HEIGHT) : 2;
                return (
                  <div
                    key={a.day}
                    className="flex-1 rounded-t-sm bg-primary/70"
                    style={{ height: h }}
                    title={`${a.day}: ${formatValue(a.value, series.decimals)} ${series.unit}`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>
                최근 {WINDOW_DAYS}일 · 최소 {formatValue(minV, series.decimals)}
              </span>
              <span>최대 {formatValue(maxV, series.decimals)}</span>
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
