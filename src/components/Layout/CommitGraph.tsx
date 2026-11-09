"use client";

import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useMemo } from "react";
import { toKstCalendarDate } from "@/lib/date-key";
import { cn } from "@/lib/utils";
import {
  COMMIT_GRAPH_DAYS,
  commitGraphBars,
  commitGraphLabel,
  type DailyCommitStat,
} from "./commit-graph";

interface StatsResponse {
  stats: DailyCommitStat[];
}

async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch("/api/timeline/stats");
  if (!response.ok) throw new Error(`stats ${response.status}`);
  return response.json();
}

/**
 * The app-bar commit strip: last 28 days, √-scaled bar heights, 5-step brand
 * ramp, today underlined, CSS tooltip per bar ("11월 9일 · 커밋 22"). One
 * `role="img"` with a summary label for screen readers. Keeps its footprint
 * (111×20, compact 83×16) while loading so the bar never shifts.
 */
export function CommitGraph({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery({
    queryKey: ["timeline", "stats"],
    queryFn: fetchStats,
    staleTime: 5 * 60_000,
  });

  const bars = useMemo(
    () => (data?.stats ? commitGraphBars(data.stats, toKstCalendarDate(new Date())) : null),
    [data]
  );

  const className = cn("ds-hcg", compact && "is-compact");
  if (!bars || bars.length === 0) {
    return (
      <span className={className} aria-hidden="true">
        {Array.from({ length: COMMIT_GRAPH_DAYS }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
          <i key={i} />
        ))}
      </span>
    );
  }

  return (
    <span className={className} role="img" aria-label={commitGraphLabel(bars)}>
      {bars.map((bar) => (
        <i
          key={bar.date}
          data-level={bar.level}
          data-today={bar.isToday ? "" : undefined}
          data-tip={bar.tip}
          style={bar.height ? ({ "--h": bar.height } as CSSProperties) : undefined}
        />
      ))}
    </span>
  );
}
