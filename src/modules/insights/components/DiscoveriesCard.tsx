"use client";

import { Bike, Code2, GitBranch, Sparkles } from "lucide-react";
import type { DiscoveriesResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface DiscoveriesCardProps {
  data: DiscoveriesResult | null;
  isLoading: boolean;
}

const KIND_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  peak: { icon: Code2, tone: "amber" },
  ai: { icon: Sparkles, tone: "green" },
  commute: { icon: Bike, tone: "blue" },
  repos: { icon: GitBranch, tone: "violet" },
};

/** 발견 — 다른 카드들에서 합성한 4개 짧은 서프라이즈. */
export function DiscoveriesCard({ data, isLoading }: DiscoveriesCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="cross" title="발견" subtitle="올해의 패턴">
        <div className="h-32 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.bullets.length === 0) {
    return (
      <InsightCard schema="cross" title="발견" subtitle="올해의 패턴">
        <InsightCardEmpty message="아직 충분한 데이터가 없습니다" />
      </InsightCard>
    );
  }

  return (
    <InsightCard schema="cross" title="발견" subtitle="여러 데이터에서 합성된 패턴">
      <ul className="space-y-3">
        {data.bullets.map((b) => {
          const meta = KIND_META[b.kind] ?? { icon: Sparkles, tone: "violet" };
          const Icon = meta.icon;
          return (
            <li key={b.kind} className="flex gap-3">
              <div
                className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-[hsl(var(--accent-${meta.tone})/0.12)] border border-[hsl(var(--accent-${meta.tone})/0.3)]`}
              >
                <Icon className={`w-4 h-4 text-[hsl(var(--accent-${meta.tone}))]`} />
              </div>
              <div className="min-w-0">
                <div className={`text-sm font-semibold glow-text-${meta.tone}`}>{b.title}</div>
                <p className="mt-0.5 text-xs text-ink-mute leading-relaxed">{b.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </InsightCard>
  );
}
