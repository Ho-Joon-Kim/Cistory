"use client";

import { useEffect, useRef, useState } from "react";
import type { TimelineCommit } from "../hooks";
import { CommitCard } from "./CommitCard";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { Loader2 } from "lucide-react";

interface TimelineProps {
  commits: TimelineCommit[];
  isLoading: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
}

export function Timeline({
  commits,
  isLoading,
  hasNext,
  onLoadMore,
}: TimelineProps) {
  const observerTarget = useRef<HTMLDivElement>(null);
  const [seenCommitIds, setSeenCommitIds] = useState<Set<string>>(new Set());
  const [newCommitIds, setNewCommitIds] = useState<Set<string>>(new Set());
  const isFirstRender = useRef(true);

  // Track new commits for animation
  useEffect(() => {
    if (commits.length === 0) return;

    const currentIds = new Set(commits.map((c) => c.id));

    if (isFirstRender.current) {
      // First render - mark all as seen (no animation)
      setSeenCommitIds(currentIds);
      isFirstRender.current = false;
      return;
    }

    // Find newly added commits
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!seenCommitIds.has(id)) {
        newIds.add(id);
      }
    }

    if (newIds.size > 0) {
      setNewCommitIds(newIds);
      setSeenCommitIds(currentIds);

      // Clear new status after animation
      const timer = setTimeout(() => {
        setNewCommitIds(new Set());
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [commits, seenCommitIds]);

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

      <div className="space-y-5">
        {Object.entries(groupedCommits).map(([date, dateCommits]) => {
          const { label, isToday } = formatDateHeader(date);
          return (
          <div key={date}>
            {/* 날짜 헤더 */}
            <div className="relative flex items-center mb-2">
              <div
                className={`
                  absolute left-2 md:left-4 w-3 h-3 rounded-full border-2 border-background
                  ${isToday
                    ? "bg-primary animate-pulse-glow shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
                    : "bg-primary"
                  }
                `}
              />
              <h3 className={`ml-10 md:ml-14 text-sm font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                {label}
              </h3>
            </div>

            {/* 해당 날짜의 커밋들 */}
            <div className="space-y-1.5 ml-10 md:ml-14">
              {dateCommits.map((commit, index) => (
                <CommitCard
                  key={commit.id}
                  commit={commit}
                  isNew={newCommitIds.has(commit.id)}
                  animationDelay={index * 50}
                />
              ))}
            </div>
          </div>
        );
        })}
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

function formatDateHeader(dateStr: string): { label: string; isToday: boolean } {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return { label: "오늘", isToday: true };
  if (isYesterday) return { label: "어제", isToday: false };

  return {
    label: date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    isToday: false,
  };
}
