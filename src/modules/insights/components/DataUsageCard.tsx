"use client";

import type { DataUsageResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";

interface DataUsageCardProps {
  data: DataUsageResult | null;
  isLoading: boolean;
}

const CATEGORY_LABELS: Record<
  string,
  { label: string; tone: "green" | "violet" | "amber" | "orange" | "blue" }
> = {
  commits: { label: "커밋", tone: "green" },
  location: { label: "위치", tone: "violet" },
  coding: { label: "코딩", tone: "amber" },
  spending: { label: "결제", tone: "orange" },
  system: { label: "시스템", tone: "blue" },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Cistory가 보관 중인 내 데이터 풋프린트. */
export function DataUsageCard({ data, isLoading }: DataUsageCardProps) {
  if (isLoading) {
    return (
      <InsightCard title="내 데이터" subtitle="Cistory가 보관 중인 양">
        <div className="h-32 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || data.totalBytes === 0) {
    return (
      <InsightCard title="내 데이터" subtitle="Cistory가 보관 중인 양">
        <InsightCardEmpty message="데이터 사용량이 계산되지 않았습니다" />
      </InsightCard>
    );
  }

  return (
    <InsightCard
      title="내 데이터"
      subtitle={`총 ${formatBytes(data.totalBytes)} · ${data.totalRows.toLocaleString()}행`}
    >
      <div className="flex h-3 rounded-full overflow-hidden bg-muted/30 mb-4">
        {data.byCategory.map((c) => {
          const meta = CATEGORY_LABELS[c.category] ?? { label: c.category, tone: "blue" as const };
          const pct = (c.bytes / data.totalBytes) * 100;
          return (
            <div
              key={c.category}
              className={`bg-[hsl(var(--accent-${meta.tone})/0.85)]`}
              style={{
                width: `${pct}%`,
                filter: `drop-shadow(0 0 4px hsl(var(--accent-${meta.tone}) / 0.4))`,
              }}
              title={`${meta.label}: ${formatBytes(c.bytes)}`}
            />
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.byCategory.map((c) => {
          const meta = CATEGORY_LABELS[c.category] ?? { label: c.category, tone: "blue" as const };
          return (
            <li key={c.category} className="flex items-center justify-between text-sm gap-2">
              <span className="inline-flex items-center gap-1.5 text-ink-dim">
                <span className={`w-2 h-2 rounded-sm bg-[hsl(var(--accent-${meta.tone}))]`} />
                {meta.label}
              </span>
              <span className="tabular-mono text-foreground">{formatBytes(c.bytes)}</span>
            </li>
          );
        })}
      </ul>
    </InsightCard>
  );
}
