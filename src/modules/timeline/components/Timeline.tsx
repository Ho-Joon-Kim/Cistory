"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineCommit } from "../hooks";
import { CommitCard } from "./CommitCard";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Loader2 } from "lucide-react";
import {
  calculateDateGap,
  getRepoColor,
  groupCommitsByTimeOfDay,
} from "../utils";

interface TimelineProps {
  commits: TimelineCommit[];
  isLoading: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
}

// --- Viewport visibility hook for each date group ---
function useDateGroupVisibility() {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());

  const setRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        refs.current.set(key, el);

        // Only observe if not already visible
        if (!visibleGroups.has(key) && !observersRef.current.has(key)) {
          const observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  setVisibleGroups((prev) => new Set([...prev, key]));
                  observer.disconnect();
                  observersRef.current.delete(key);
                }
              }
            },
            { threshold: 0.1 }
          );
          observer.observe(el);
          observersRef.current.set(key, observer);
        }
      }
    },
    [visibleGroups]
  );

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
    };
  }, []);

  return { setRef, visibleGroups };
}

// --- Period break divider ---
function PeriodBreakDivider({ daysDiff }: { daysDiff: number }) {
  return (
    <div className="relative flex items-center ml-10 md:ml-14 py-2">
      <div className="flex-1 overflow-hidden">
        <div className="period-break-line border-t border-dashed border-muted-foreground/30" />
      </div>
      <span className="period-break-label px-3 text-xs text-muted-foreground/60 whitespace-nowrap">
        {daysDiff}일 후
      </span>
      <div className="flex-1 overflow-hidden">
        <div className="period-break-line border-t border-dashed border-muted-foreground/30" />
      </div>
    </div>
  );
}

// --- Date group section ---
interface DateGroupSectionProps {
  date: string;
  dateCommits: TimelineCommit[];
  isVisible: boolean;
  setRef: (key: string) => (el: HTMLDivElement | null) => void;
  repoColorMap: Map<string, string>;
  newCommitIds: Set<string>;
}

function DateGroupSection({
  date,
  dateCommits,
  isVisible,
  setRef,
  repoColorMap,
  newCommitIds,
}: DateGroupSectionProps) {
  const { label, isToday } = formatDateHeader(date);
  const subGroups = groupCommitsByTimeOfDay(dateCommits);

  return (
    <div
      ref={setRef(date)}
      className={`date-group-section ${isVisible ? "is-visible" : ""}`}
    >
      {/* Date header */}
      <div className="relative flex items-center mb-2">
        {/* Date marker - simple dot with pulse */}
        <div
          className={`
            date-marker absolute left-2 md:left-4 w-3 h-3 rounded-full border-2 border-background
            ${isToday
              ? "bg-primary animate-pulse-glow shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
              : "bg-primary"
            }
          `}
        />

        <div className="ml-10 md:ml-14 flex items-center gap-2">
          <h3
            className={`text-sm font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}
          >
            {label}
          </h3>
          {/* Commit count badge */}
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
            <AnimatedNumber value={dateCommits.length} />
          </span>
        </div>
      </div>

      {/* Commits with time-of-day sub-groups */}
      <div className="ml-10 md:ml-14 space-y-1">
        {subGroups.map((subGroup, sgIndex) => (
          <div key={sgIndex}>
            {/* Sub-group label */}
            {subGroup.label && (
              <div className="flex items-center gap-2 py-2">
                <span className="text-[11px] text-muted-foreground/50 font-medium tracking-wide">
                  {subGroup.label}
                </span>
                <div className="subgroup-divider h-px bg-muted-foreground/15 flex-1" />
              </div>
            )}

            {/* Commits in sub-group */}
            <div className="space-y-1">
              {subGroup.commits.map((commit, index) => (
                <div key={commit.id} className="relative commit-card-stagger">
                  {/* Tick mark on stepper line */}
                  <div className="timeline-tick absolute -left-[23px] md:-left-[31px] top-1/2 -translate-y-1/2" />
                  <CommitCard
                    commit={commit}
                    isNew={newCommitIds.has(commit.id)}
                    animationDelay={index * 50}
                    repoColor={repoColorMap.get(commit.repository.fullName)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const { setRef, visibleGroups } = useDateGroupVisibility();

  // Track new commits for animation
  useEffect(() => {
    if (commits.length === 0) return;

    const currentIds = new Set(commits.map((c) => c.id));

    if (isFirstRender.current) {
      setSeenCommitIds(currentIds);
      isFirstRender.current = false;
      return;
    }

    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!seenCommitIds.has(id)) {
        newIds.add(id);
      }
    }

    if (newIds.size > 0) {
      setNewCommitIds(newIds);
      setSeenCommitIds(currentIds);

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

  // Repo color map
  const repoColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const commit of commits) {
      const name = commit.repository.fullName;
      if (!map.has(name)) {
        map.set(name, getRepoColor(name));
      }
    }
    return map;
  }, [commits]);

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

  // Group by date
  const groupedCommits = groupCommitsByDate(commits);
  const dateEntries = Object.entries(groupedCommits);

  return (
    <div className="relative">
      {/* Enhanced stepper line */}
      <div className="absolute left-[14px] md:left-[22px] top-0 bottom-0 w-0.5 timeline-stepper-line rounded-full" />

      <div>
        {dateEntries.map(([date, dateCommits], groupIndex) => {
          // Calculate dynamic gap from previous date group
          let gapPx = 0;
          let showPeriodBreak = false;
          let daysDiff = 0;

          if (groupIndex > 0) {
            const prevDate = dateEntries[groupIndex - 1][0];
            const gapResult = calculateDateGap(prevDate, date);
            gapPx = gapResult.gapPx;
            showPeriodBreak = gapResult.showPeriodBreak;
            daysDiff = gapResult.daysDiff;
          }

          return (
            <div key={date} style={groupIndex > 0 ? { marginTop: `${gapPx}px` } : undefined}>
              {/* Period break divider */}
              {showPeriodBreak && <PeriodBreakDivider daysDiff={daysDiff} />}

              <DateGroupSection
                date={date}
                dateCommits={dateCommits}
                isVisible={visibleGroups.has(date)}
                setRef={setRef}
                repoColorMap={repoColorMap}
                newCommitIds={newCommitIds}
              />
            </div>
          );
        })}
      </div>

      {/* Loading indicator & Observer target */}
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
