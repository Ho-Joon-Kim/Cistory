"use client";

import type { TripsResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";
import { Pill } from "./primitives/Pill";
import { Stat } from "./primitives/Stat";

interface TripsCardProps {
  data: TripsResult | null;
  isLoading: boolean;
  year: number;
}

/** 여행 카드 — 국내/해외 트립 + 톱 도시·국가. (Mapbox globe는 후속) */
export function TripsCard({ data, isLoading, year }: TripsCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="location" title="어디까지 갔나" subtitle={`${year}년 트립`}>
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.totalTrips === 0) {
    return (
      <InsightCard schema="location" title="어디까지 갔나" subtitle={`${year}년 트립`}>
        <InsightCardEmpty message="감지된 여행이 없습니다" />
      </InsightCard>
    );
  }

  return (
    <InsightCard
      schema="location"
      title="어디까지 갔나"
      subtitle={`${year}년 ${data.totalTrips}회 트립 / ${data.totalDays}일`}
    >
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="해외" value={data.overseasTrips} suffix="회" tone="violet" glow />
        <Stat label="국내" value={data.domesticTrips} suffix="회" tone="blue" glow />
        <Stat label="총 일수" value={data.totalDays} suffix="일" tone="amber" />
      </div>

      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute mb-2">방문지</div>
      <div className="flex flex-wrap gap-1.5">
        {data.topDestinations.map((d) => (
          <Pill key={d.name} tone={d.isOverseas ? "violet" : "blue"}>
            {d.name}
            {d.count > 1 ? <span className="opacity-60 ml-1">×{d.count}</span> : null}
          </Pill>
        ))}
      </div>
    </InsightCard>
  );
}
