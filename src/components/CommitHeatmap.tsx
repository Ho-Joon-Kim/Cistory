"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

interface HeatmapState {
  data: StatsResponse | null;
  isLoading: boolean;
  isVisible: boolean;
}

export function CommitHeatmap() {
  const [state, setState] = useState<HeatmapState>({
    data: null,
    isLoading: true,
    isVisible: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchStats = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/timeline/stats", { signal });
      if (response.ok) {
        const json = await response.json();
        setState({ data: json, isLoading: false, isVisible: false });
        // Trigger animation after data loads
        setTimeout(() => setState((prev) => ({ ...prev, isVisible: true })), 50);
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to fetch heatmap stats:", error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    fetchStats(controller.signal);
    return () => controller.abort();
  }, [fetchStats]);

  if (state.isLoading) {
    return (
      <div className="flex items-end gap-[2px] h-6">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="w-1 bg-muted rounded-sm animate-shimmer"
            style={{ height: `${Math.random() * 16 + 4}px` }}
          />
        ))}
      </div>
    );
  }

  if (!state.data || state.data.totalCommits === 0) {
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
        {state.data.stats.map((stat, index) => {
          const heightPercent = state.data!.maxCount > 0
            ? Math.max((stat.count / state.data!.maxCount) * 100, stat.count > 0 ? 20 : 8)
            : 8;

          return (
            <Tooltip key={stat.date}>
              <TooltipTrigger asChild>
                <div
                  className={`
                    w-1 rounded-sm cursor-pointer
                    transition-all duration-200
                    hover:opacity-80 hover:scale-110
                    ${stat.count > 0 ? "bg-primary" : "bg-muted"}
                    ${state.isVisible ? "animate-bar-grow" : "opacity-0"}
                  `}
                  style={{
                    height: `${heightPercent}%`,
                    minHeight: "3px",
                    animationDelay: `${index * 20}ms`,
                  }}
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
