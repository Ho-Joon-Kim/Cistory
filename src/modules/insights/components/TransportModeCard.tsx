"use client";

import type { TransportModesResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface TransportModeCardProps {
  data: TransportModesResult | null;
  isLoading: boolean;
}

const MODE_LABELS: Record<
  string,
  { label: string; tone: "green" | "amber" | "orange" | "violet" | "blue" }
> = {
  walking: { label: "도보", tone: "green" },
  running: { label: "달리기", tone: "amber" },
  cycling: { label: "자전거", tone: "amber" },
  driving: { label: "자동차", tone: "blue" },
  train: { label: "지하철·기차", tone: "violet" },
  flying: { label: "비행", tone: "orange" },
  unknown: { label: "기타", tone: "violet" },
};

/** 이동 수단별 거리·시간 분포. */
export function TransportModeCard({ data, isLoading }: TransportModeCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="transport" title="이동 수단" subtitle="거리·시간 분포">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.modes.length === 0) {
    return (
      <InsightCard schema="transport" title="이동 수단" subtitle="거리·시간 분포">
        <InsightCardEmpty message="이동 데이터가 없습니다" />
      </InsightCard>
    );
  }

  const totalKm = data.modes.reduce((s, m) => s + m.distanceMeters / 1000, 0);
  const max = Math.max(...data.modes.map((m) => m.distanceMeters));

  return (
    <InsightCard
      schema="transport"
      title="이동 수단"
      subtitle={`총 ${Math.round(totalKm).toLocaleString()} km`}
    >
      <ul className="space-y-2.5">
        {data.modes.map((m) => {
          const meta = MODE_LABELS[m.mode] ?? { label: m.mode, tone: "blue" as const };
          const pct = (m.distanceMeters / max) * 100;
          const km = m.distanceMeters / 1000;
          const hours = m.durationSeconds / 3600;
          return (
            <li key={m.mode} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm text-foreground">{meta.label}</span>
                  <span className="text-[11px] text-ink-mute tabular-mono shrink-0">
                    {hours < 1 ? `${Math.round(hours * 60)}분` : `${hours.toFixed(1)}h`} ·{" "}
                    {m.segmentCount}회
                  </span>
                </div>
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-[hsl(var(--accent-${meta.tone}))]`}
                    style={{
                      width: `${pct}%`,
                      filter: `drop-shadow(0 0 3px hsl(var(--accent-${meta.tone}) / 0.6))`,
                    }}
                  />
                </div>
              </div>
              <div className="tabular-mono text-sm text-foreground font-semibold w-20 text-right">
                {km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString()}
                <span className="text-[10px] text-ink-mute ml-0.5">km</span>
              </div>
            </li>
          );
        })}
      </ul>
    </InsightCard>
  );
}
