"use client";

import type { SwimlaneResult } from "../service";
import { InsightCard } from "./primitives/InsightCard";
import { Stat } from "./primitives/Stat";
import { Swimlane, type SwimlaneStream } from "./primitives/Swimlane";

interface HeroSwimlaneProps {
  data: SwimlaneResult | null;
  isLoading: boolean;
  year: number;
}

/**
 * Year overview hero — 4-stream swimlane spanning the full grid width.
 * Stream summaries shown as a stat strip below the chart.
 */
export function HeroSwimlane({ data, isLoading, year }: HeroSwimlaneProps) {
  if (isLoading || !data) {
    return (
      <InsightCard
        schema="cross"
        title={`${year}년 한 해`}
        subtitle="커밋 · 코딩 · 지출 · 방문을 한 줄로"
        className="lg:col-span-2"
      >
        <div className="h-[200px] animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  const streams: SwimlaneStream[] = [
    { id: "commits", label: "커밋", tone: "green", daily: data.commits },
    { id: "coding", label: "코딩", tone: "amber", daily: data.coding },
    { id: "visits", label: "방문", tone: "violet", daily: data.visits },
    { id: "spending", label: "지출", tone: "orange", daily: data.spending },
  ];

  const totalCommits = data.commits.reduce((s, x) => s + x, 0);
  const totalCodingHours = Math.round(data.coding.reduce((s, x) => s + x, 0) / 3600);
  const totalVisits = data.visits.reduce((s, x) => s + x, 0);
  const totalTx = data.spending.reduce((s, x) => s + x, 0);
  const activeDays = data.commits.filter((x) => x > 0).length;

  return (
    <InsightCard
      schema="cross"
      title={`${year}년 한 해`}
      subtitle="커밋 · 코딩 · 방문 · 지출을 한 줄로"
      className="lg:col-span-2"
    >
      <Swimlane streams={streams} year={year} height={200} />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-hairline">
        <Stat label="활동일" value={activeDays} suffix="일" tone="green" glow size="sm" />
        <Stat label="커밋" value={totalCommits.toLocaleString()} tone="green" glow size="sm" />
        <Stat
          label="코딩"
          value={totalCodingHours.toLocaleString()}
          suffix="h"
          tone="amber"
          glow
          size="sm"
        />
        <Stat label="방문" value={totalVisits.toLocaleString()} tone="violet" glow size="sm" />
        <Stat label="결제" value={totalTx.toLocaleString()} tone="orange" glow size="sm" />
      </div>
    </InsightCard>
  );
}
