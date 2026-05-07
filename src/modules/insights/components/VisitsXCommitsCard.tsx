"use client";

import type { VisitsXCommitsResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface VisitsXCommitsCardProps {
  data: VisitsXCommitsResult | null;
  isLoading: boolean;
}

/** 방문 × 커밋: 방문한 날 커밋도 발생한 날의 톱 N 장소. */
export function VisitsXCommitsCard({ data, isLoading }: VisitsXCommitsCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="cross" title="방문 × 커밋" subtitle="방문한 날 커밋도 일어난 장소">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.places.length === 0) {
    return (
      <InsightCard schema="cross" title="방문 × 커밋" subtitle="방문한 날 커밋도 일어난 장소">
        <InsightCardEmpty message="방문·커밋 동시 데이터가 없습니다" />
      </InsightCard>
    );
  }

  return (
    <InsightCard schema="cross" title="방문 × 커밋" subtitle="방문한 날 커밋도 일어난 장소">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">
            <th className="text-left font-normal pb-2">장소</th>
            <th className="text-right font-normal pb-2">활동일</th>
            <th className="text-right font-normal pb-2">커밋</th>
            <th className="text-right font-normal pb-2">체류</th>
          </tr>
        </thead>
        <tbody>
          {data.places.map((p, idx) => (
            <tr
              key={p.placeName}
              className={
                idx === 0
                  ? "border-b border-hairline last:border-0 bg-[hsl(var(--accent-green)/0.05)]"
                  : "border-b border-hairline last:border-0"
              }
            >
              <td className="py-2 text-foreground truncate max-w-[180px]">{p.placeName}</td>
              <td className="py-2 text-right tabular-mono text-foreground">{p.daysWithCommits}</td>
              <td className="py-2 text-right tabular-mono glow-text-green">{p.totalCommits}</td>
              <td className="py-2 text-right tabular-mono text-ink-dim">
                {p.totalVisitHours.toFixed(0)}
                <span className="text-[10px] text-ink-mute ml-0.5">h</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </InsightCard>
  );
}
