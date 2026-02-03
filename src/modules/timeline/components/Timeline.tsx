"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import type { TimelineCommit } from "../hooks";
import type { DateEntry } from "../utils";
import { CommitCard } from "./CommitCard";
import { CompactCommitCard } from "./CompactCommitCard";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Loader2 } from "lucide-react";
import {
  fillDateRange,
  getRepoColor,
  groupCommitsByTimeOfDay,
} from "../utils";

interface TimelineProps {
  commits: TimelineCommit[];
  isLoading: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
}

// --- Viewport visibility hook for each date group ---
function useDateGroupVisibility(scrollRoot: React.RefObject<Element | null>) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());

  const setRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        refs.current.set(key, el);

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
            { threshold: 0.1, root: scrollRoot.current }
          );
          observer.observe(el);
          observersRef.current.set(key, observer);
        }
      }
    },
    [visibleGroups, scrollRoot]
  );

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
    };
  }, []);

  return { setRef, visibleGroups, refs };
}

// --- Date group section ---
interface DateGroupSectionProps {
  entry: DateEntry;
  isSelected: boolean;
  isVisible: boolean;
  setRef: (key: string) => (el: HTMLDivElement | null) => void;
  repoColorMap: Map<string, string>;
  newCommitIds: Set<string>;
  onSelectDate: (date: string) => void;
}

const DateGroupSection = memo(function DateGroupSection({
  entry,
  isSelected,
  isVisible,
  setRef,
  repoColorMap,
  newCommitIds,
  onSelectDate,
}: DateGroupSectionProps) {
  const { date, commits: dateCommits, isEmpty } = entry;
  const { label, isToday } = formatDateHeader(date);
  const subGroups = isSelected ? groupCommitsByTimeOfDay(dateCommits) : [];

  return (
    <div
      ref={setRef(date)}
      className={`date-group-section relative ${isVisible ? "is-visible" : ""}`}
    >
      {/* Date header */}
      <div className="relative flex items-center mb-2">
        {/* Stepper dot as button */}
        <button
          type="button"
          className={`
            stepper-dot absolute left-1 md:left-3 flex items-center justify-center w-6 h-6
          `}
          onClick={() => onSelectDate(date)}
          aria-label={`${label} 선택`}
        >
          <span
            className={`
              block rounded-full transition-all duration-200
              ${isSelected
                ? "w-3 h-3 bg-primary animate-pulse-glow"
                : "w-2.5 h-2.5 bg-muted-foreground/40 hover:bg-muted-foreground/60"
              }
            `}
          />
        </button>

        <div className="ml-10 md:ml-14 flex items-center gap-2">
          <h3
            className={`text-sm font-medium transition-colors duration-200 ${
              isSelected
                ? isToday
                  ? "text-primary"
                  : "text-foreground"
                : "text-muted-foreground/50"
            }`}
          >
            {label}
          </h3>
          <span
            className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-medium transition-colors duration-200 ${
              isSelected
                ? "bg-muted text-muted-foreground"
                : "bg-muted/50 text-muted-foreground/50"
            }`}
          >
            <AnimatedNumber value={dateCommits.length} />
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="ml-10 md:ml-14">
        {/* Selected date: full layout */}
        {isSelected && !isEmpty && (
          <div className="space-y-1">
            {subGroups.map((subGroup, sgIndex) => (
              <div key={sgIndex}>
                {subGroup.label && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-[11px] text-muted-foreground/50 font-medium tracking-wide">
                      {subGroup.label}
                    </span>
                    <div className="subgroup-divider h-px bg-muted-foreground/15 flex-1" />
                  </div>
                )}
                <div className="space-y-1">
                  {subGroup.commits.map((commit, index) => (
                    <div key={commit.id} className="relative commit-card-stagger">
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
        )}

        {/* Selected but empty */}
        {isSelected && isEmpty && (
          <p className="text-sm text-muted-foreground/60 py-2">
            이 날의 커밋이 없습니다
          </p>
        )}

        {/* Non-selected: compact commits */}
        {!isSelected && !isEmpty && (
          <div>
            {dateCommits.map((commit) => (
              <CompactCommitCard
                key={commit.id}
                commit={commit}
                onSelectDate={() => onSelectDate(date)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export function Timeline({
  commits,
  isLoading,
  hasNext,
  onLoadMore,
  selectedDate,
  onSelectedDateChange,
}: TimelineProps) {
  const observerTarget = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<Element | null>(null);
  const [seenCommitIds, setSeenCommitIds] = useState<Set<string>>(new Set());
  const [newCommitIds, setNewCommitIds] = useState<Set<string>>(new Set());
  const isFirstRender = useRef(true);
  const { setRef, visibleGroups, refs } = useDateGroupVisibility(scrollContainerRef);

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

  // Group by date and fill range
  const filledDates = useMemo(() => {
    const grouped = groupCommitsByDate(commits);
    return fillDateRange(grouped);
  }, [commits]);

  // Stepper line gradient position
  const containerRef = useRef<HTMLDivElement>(null);
  const [glowY, setGlowY] = useState<number | null>(null);

  // Resolve the scroll container once on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      scrollContainerRef.current = el.closest(".timeline-scroll-container") ?? null;
    }
  }, []);

  // Compute glow position + scroll on selection
  const isInitialScroll = useRef(true);
  useEffect(() => {
    const el = refs.current.get(selectedDate);
    if (el) {
      // Use offsetTop for stable position relative to containerRef (position:relative parent)
      const dotY = el.offsetTop + 12;
      setGlowY(dotY);
    }

    if (el) {
      if (isInitialScroll.current) {
        isInitialScroll.current = false;
        return;
      }
      const sc = scrollContainerRef.current;
      if (sc) {
        const offset = el.offsetTop - 16;
        sc.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [selectedDate, refs]);

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

  return (
    <div ref={containerRef} className="relative">
      {/* Continuous stepper line with gradient glow from selected date */}
      <div
        className="stepper-line absolute left-[15px] md:left-[23px] top-0 bottom-0 w-0.5 rounded-full"
        style={
          glowY !== null
            ? { "--glow-y": `${glowY}px` } as React.CSSProperties
            : undefined
        }
      />

      <div className="space-y-4">
        {filledDates.map((entry) => (
          <DateGroupSection
            key={entry.date}
            entry={entry}
            isSelected={entry.date === selectedDate}
            isVisible={visibleGroups.has(entry.date)}
            setRef={setRef}
            repoColorMap={repoColorMap}
            newCommitIds={newCommitIds}
            onSelectDate={onSelectedDateChange}
          />
        ))}
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
    const date = commit.committedAt.split("T")[0];
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
