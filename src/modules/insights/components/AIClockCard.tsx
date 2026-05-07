"use client";

import type { AIClockResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";
import { RadialClock } from "./primitives/RadialClock";
import { Stat } from "./primitives/Stat";

interface AIClockCardProps {
  data: AIClockResult | null;
  isLoading: boolean;
}

/**
 * 24-hour radial clock: AI vs human additions per hour-of-day.
 * Inner ring = AI portion, outer = total volume.
 */
export function AIClockCard({ data, isLoading }: AIClockCardProps) {
  if (isLoading) {
    return (
      <InsightCard
        schema="coding"
        title="24시간 AI 클락"
        subtitle="시간대별 AI vs 직접 입력 코드량"
      >
        <div className="h-72 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.totalAi + data.totalHuman === 0) {
    return (
      <InsightCard
        schema="coding"
        title="24시간 AI 클락"
        subtitle="시간대별 AI vs 직접 입력 코드량"
      >
        <InsightCardEmpty message="WakaTime AI 라인 데이터가 없습니다" />
      </InsightCard>
    );
  }

  const total = data.totalAi + data.totalHuman;
  const aiPct = Math.round((data.totalAi / total) * 100);
  const peakHour = data.hours.reduce(
    (best, h, i) => (h.ai + h.human > data.hours[best].ai + data.hours[best].human ? i : best),
    0
  );

  return (
    <InsightCard schema="coding" title="24시간 AI 클락" subtitle="시간대별 AI vs 직접 입력 코드량">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
        <RadialClock hours={data.hours} size={260} />
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-4 sm:gap-3">
          <Stat label="AI 비율" value={`${aiPct}%`} tone="green" glow size="lg" />
          <Stat label="피크 시간" value={`${peakHour}시`} tone="amber" glow />
          <Stat
            label="AI 라인"
            value={data.totalAi.toLocaleString()}
            caption="추가된 줄"
            tone="green"
            size="sm"
          />
          <Stat
            label="직접 입력"
            value={data.totalHuman.toLocaleString()}
            caption="추가된 줄"
            tone="amber"
            size="sm"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11px] text-ink-mute">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[hsl(var(--accent-green))]" /> AI
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[hsl(var(--accent-amber)/0.6)]" /> 직접 입력
        </span>
        <span className="ml-auto">웨지 길이 = 시간대 총 코드량</span>
      </div>
    </InsightCard>
  );
}
