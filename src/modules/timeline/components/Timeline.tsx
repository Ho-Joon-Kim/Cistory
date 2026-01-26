"use client";

import { useEffect, useRef } from "react";
import type { TimelineCommit } from "../hooks";
import { CommitCard } from "./CommitCard";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { Loader2 } from "lucide-react";

interface TimelineProps {
  commits: TimelineCommit[];
  isLoading: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
  summaryMode: "technical" | "nonTechnical";
}

export function Timeline({
  commits,
  isLoading,
  hasNext,
  onLoadMore,
  summaryMode,
}: TimelineProps) {
  const observerTarget = useRef<HTMLDivElement>(null);

  // Infinite scroll
  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNext && !isLoading) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [hasNext, isLoading, onLoadMore]);

  if (isLoading && commits.length === 0) {
    return <TimelineSkeleton />;
  }

  if (commits.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-lg">커밋이 없습니다</p>
        <p className="text-sm mt-2">
          레포지토리를 추적하면 커밋 타임라인이 여기에 표시됩니다
        </p>
      </div>
    );
  }

  // 날짜별 그룹화
  const groupedCommits = groupCommitsByDate(commits);

  return (
    <div className="relative">
      {/* 타임라인 세로선 */}
      <div className="absolute left-4 md:left-6 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-8">
        {Object.entries(groupedCommits).map(([date, dateCommits]) => (
          <div key={date}>
            {/* 날짜 헤더 */}
            <div className="relative flex items-center mb-4">
              <div className="absolute left-2 md:left-4 w-4 h-4 rounded-full bg-primary border-4 border-background" />
              <h3 className="ml-10 md:ml-14 text-sm font-medium text-muted-foreground">
                {formatDateHeader(date)}
              </h3>
            </div>

            {/* 해당 날짜의 커밋들 */}
            <div className="space-y-3 ml-10 md:ml-14">
              {dateCommits.map((commit) => (
                <CommitCard
                  key={commit.id}
                  commit={commit}
                  summaryMode={summaryMode}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 로딩 인디케이터 & Observer 타겟 */}
      <div ref={observerTarget} className="py-8 flex justify-center">
        {isLoading && commits.length > 0 && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

function groupCommitsByDate(
  commits: TimelineCommit[]
): Record<string, TimelineCommit[]> {
  const groups: Record<string, TimelineCommit[]> = {};

  for (const commit of commits) {
    const date = commit.committedAt.split("T")[0]; // YYYY-MM-DD
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(commit);
  }

  return groups;
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return "오늘";
  if (isYesterday) return "어제";

  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
