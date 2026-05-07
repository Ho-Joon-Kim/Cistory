"use client";

import type { PlaceProductivityResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface PlaceProductivityCardProps {
  data: PlaceProductivityResult | null;
  isLoading: boolean;
}

/** 장소 × 생산성: 방문×코딩 시간-오버랩으로 본 "어디서 코딩하나". */
export function PlaceProductivityCard({ data, isLoading }: PlaceProductivityCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="cross" title="어디서 코딩하나" subtitle="장소별 코딩 오버랩">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.places.length === 0) {
    return (
      <InsightCard schema="cross" title="어디서 코딩하나" subtitle="장소별 코딩 오버랩">
        <InsightCardEmpty message="장소·코딩 오버랩 데이터가 없습니다" />
      </InsightCard>
    );
  }

  const max = Math.max(...data.places.map((p) => p.overlapHours));

  return (
    <InsightCard schema="cross" title="어디서 코딩하나" subtitle="방문 × 코딩 세션 시간 오버랩">
      <ul className="space-y-2.5">
        {data.places.map((p) => {
          const pct = (p.overlapHours / max) * 100;
          return (
            <li key={p.placeName} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm text-foreground truncate">{p.placeName}</span>
                  <span className="text-[11px] text-ink-mute tabular-mono shrink-0">
                    {p.visitCount}회 방문
                  </span>
                </div>
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[hsl(var(--accent-violet))]"
                    style={{
                      width: `${pct}%`,
                      filter: "drop-shadow(0 0 3px hsl(var(--accent-violet) / 0.6))",
                    }}
                  />
                </div>
              </div>
              <div className="tabular-mono text-sm text-foreground font-semibold w-16 text-right">
                {p.overlapHours.toFixed(1)}
                <span className="text-[10px] text-ink-mute ml-0.5">h</span>
              </div>
            </li>
          );
        })}
      </ul>
    </InsightCard>
  );
}
