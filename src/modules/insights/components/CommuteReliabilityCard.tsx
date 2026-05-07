"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CommuteReliabilityResult } from "../service";
import { Histogram } from "./primitives/Histogram";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";
import { Stat } from "./primitives/Stat";

interface CommuteReliabilityCardProps {
  data: CommuteReliabilityResult | null;
  isLoading: boolean;
}

/** 출퇴근 시간 신뢰성: 자전거·도보 통근 분포 + p50/p95. */
export function CommuteReliabilityCard({ data, isLoading }: CommuteReliabilityCardProps) {
  const [bucket, setBucket] = useState<"am" | "pm">("am");

  if (isLoading) {
    return (
      <InsightCard schema="transport" title="통근 시간 신뢰성" subtitle="자전거·도보 통근 분포">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.am.sample + data.pm.sample === 0) {
    return (
      <InsightCard schema="transport" title="통근 시간 신뢰성" subtitle="자전거·도보 통근 분포">
        <InsightCardEmpty message="통근으로 분류된 트랙이 없습니다" />
      </InsightCard>
    );
  }

  const active = data[bucket];
  const tone = bucket === "am" ? "amber" : "violet";

  const Toggle = ({
    id,
    label,
    icon,
  }: {
    id: "am" | "pm";
    label: string;
    icon: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={() => setBucket(id)}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] tabular-mono border transition",
        bucket === id
          ? "border-[hsl(var(--accent-amber))] text-foreground bg-[hsl(var(--accent-amber)/0.1)]"
          : "border-hairline text-ink-mute hover:text-ink-dim"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <InsightCard
      schema="transport"
      title="통근 시간 신뢰성"
      subtitle="자전거·도보 통근 — 몇 분 일찍 나가야 안 늦나?"
      right={
        <div className="flex gap-1">
          <Toggle id="am" label="🌅 출근" icon={<Sun className="w-3 h-3" />} />
          <Toggle id="pm" label="🌙 퇴근" icon={<Moon className="w-3 h-3" />} />
        </div>
      }
    >
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Stat
          label="중앙값"
          value={Math.round(active.median)}
          suffix="분"
          tone={tone}
          glow
          size="md"
        />
        <Stat label="p95" value={Math.round(active.p95)} suffix="분" tone={tone} size="md" />
        <Stat label="가장 빠름" value={Math.round(active.min)} suffix="분" tone="green" size="md" />
        <Stat label="가장 느림" value={Math.round(active.max)} suffix="분" tone="red" size="md" />
      </div>

      <Histogram
        values={active.durationsMin}
        bins={16}
        tone={tone}
        highlightIqr
        height={120}
        refs={[
          { value: active.median, label: `p50 ${Math.round(active.median)}분` },
          { value: active.p95, label: `p95 ${Math.round(active.p95)}분`, dashed: true },
        ]}
        formatX={(v) => `${Math.round(v)}분`}
      />

      <p className="mt-3 text-[11px] text-ink-mute leading-relaxed">
        {bucket === "am"
          ? `${active.sample}회 출근, p95(${Math.round(active.p95)}분)까지 잡으면 95% 안전. 8:30 출발 시 9시 도착은 약 ${Math.round((1 - 0.05) * 100)}% 확률.`
          : `${active.sample}회 퇴근, 변동폭 ${Math.round(active.max - active.min)}분. 출근보다 신뢰성이 ${active.p95 > data.am.p95 ? "낮음" : "비슷함"}.`}
      </p>
    </InsightCard>
  );
}
