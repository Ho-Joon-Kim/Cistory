"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DailyStat {
  date: string;
  count: number;
}

interface StatsResponse {
  stats: DailyStat[];
  totalCommits: number;
  maxCount: number;
}

export function CommitHeatmap() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch("/api/timeline/stats");
        if (response.ok) {
          const json = await response.json();
          setData(json);
          // Trigger animation after data loads
          setTimeout(() => setIsVisible(true), 50);
        }
      } catch (error) {
        console.error("Failed to fetch heatmap stats:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-end gap-[2px] h-6">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="w-1 bg-muted rounded-[2px] animate-shimmer"
            style={{ height: `${Math.random() * 16 + 4}px` }}
          />
        ))}
      </div>
    );
  }

  if (!data || data.totalCommits === 0) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex items-end gap-[2px] h-6">
        {data.stats.map((stat, index) => {
          const heightPercent = data.maxCount > 0
            ? Math.max((stat.count / data.maxCount) * 100, stat.count > 0 ? 20 : 8)
            : 8;
          // DS: opacity scales with height — taller bars are brighter
          const barOpacity = stat.count > 0
            ? 0.3 + (stat.count / Math.max(data.maxCount, 1)) * 0.7
            : 0.15;

          return (
            <Tooltip key={stat.date}>
              <TooltipTrigger asChild>
                <div
                  className={`
                    w-1 cursor-pointer
                    transition-all duration-200
                    hover:opacity-80 hover:scale-110
                    ${stat.count > 0
                      ? isVisible ? "ds-waveform-bar" : "opacity-0"
                      : "bg-muted rounded-sm"
                    }
                    ${stat.count === 0 && isVisible ? "animate-bar-grow" : ""}
                    ${stat.count === 0 && !isVisible ? "opacity-0" : ""}
                  `}
                  style={{
                    height: `${heightPercent}%`,
                    minHeight: "3px",
                    "--bar-index": index,
                    "--bar-opacity": barOpacity,
                    ...(stat.count === 0 ? { animationDelay: `${index * 20}ms` } : {}),
                  } as React.CSSProperties}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p className="font-medium">{formatDate(stat.date)}</p>
                <p className="text-muted-foreground">
                  {stat.count}개 커밋
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
