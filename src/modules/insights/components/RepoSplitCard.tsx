"use client";

import { Globe, Lock } from "lucide-react";
import type { RepoSplitResult } from "../service";
import { Donut } from "./primitives/Donut";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface RepoSplitCardProps {
  data: RepoSplitResult | null;
  isLoading: boolean;
}

/** 회사 vs 사이드 — 프라이빗/퍼블릭 비율 + 톱 레포. */
export function RepoSplitCard({ data, isLoading }: RepoSplitCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="commits" title="회사 vs 사이드" subtitle="프라이빗 vs 퍼블릭 커밋">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.totalCommits === 0) {
    return (
      <InsightCard schema="commits" title="회사 vs 사이드" subtitle="프라이빗 vs 퍼블릭 커밋">
        <InsightCardEmpty message="커밋 데이터가 없습니다" />
      </InsightCard>
    );
  }

  const privPct = Math.round((data.privateCommits / data.totalCommits) * 100);

  return (
    <InsightCard schema="commits" title="회사 vs 사이드" subtitle="프라이빗 vs 퍼블릭 커밋">
      <div className="grid grid-cols-[auto_1fr] gap-4 items-center">
        <Donut
          segments={[
            { label: "프라이빗", value: data.privateCommits, tone: "amber" },
            { label: "퍼블릭", value: data.publicCommits, tone: "green" },
          ]}
          size={140}
          thickness={16}
          centerValue={data.totalCommits.toLocaleString()}
          centerLabel="커밋"
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink-dim">
              <Lock className="w-3 h-3 text-[hsl(var(--accent-amber))]" />
              프라이빗
            </span>
            <span className="tabular-mono glow-text-amber font-semibold">
              {privPct}%
              <span className="text-[10px] text-ink-mute ml-1">
                ({data.privateCommits.toLocaleString()})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink-dim">
              <Globe className="w-3 h-3 text-[hsl(var(--accent-green))]" />
              퍼블릭
            </span>
            <span className="tabular-mono glow-text-green font-semibold">
              {100 - privPct}%
              <span className="text-[10px] text-ink-mute ml-1">
                ({data.publicCommits.toLocaleString()})
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-hairline">
        <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute mb-2">톱 레포</div>
        <ul className="space-y-1.5">
          {data.topRepos.map((r) => (
            <li key={r.fullName} className="flex justify-between items-baseline gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-foreground truncate">
                {r.isPrivate ? (
                  <Lock className="w-3 h-3 text-[hsl(var(--accent-amber))] shrink-0" />
                ) : (
                  <Globe className="w-3 h-3 text-[hsl(var(--accent-green))] shrink-0" />
                )}
                <span className="truncate">{r.fullName}</span>
              </span>
              <span className="tabular-mono text-ink-dim shrink-0">
                {r.commits.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </InsightCard>
  );
}
