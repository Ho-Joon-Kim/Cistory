"use client";

import { ArrowDown, Clock, Navigation } from "lucide-react";
import type { TimelineSegment } from "../../utils";

interface TimelinePanelProps {
  segments: TimelineSegment[];
  selectedIndex: number | null;
  onSegmentClick: (index: number) => void;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
}

export function TimelinePanel({ segments, selectedIndex, onSegmentClick }: TimelinePanelProps) {
  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 py-8">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">타임라인 데이터가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        타임라인
      </h3>
      <div className="flex flex-col">
        {segments.map((seg, i) => {
          const isSelected = selectedIndex === i;

          if (seg.type === "staying") {
            const sp = seg.stayPoint;
            return (
              <button
                key={`stay-${sp.startTime}`}
                type="button"
                className={`flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50 ${
                  isSelected ? "bg-accent" : ""
                }`}
                onClick={() => onSegmentClick(i)}
              >
                <div className="flex flex-col items-center mt-0.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${
                      sp.savedPlaceId
                        ? "bg-amber-500/20 text-amber-600"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    <Navigation className="h-3 w-3" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {sp.placeName || "알 수 없는 장소"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(sp.startTime)} - {formatTime(sp.endTime)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(sp.durationMinutes)}
                  </p>
                </div>
              </button>
            );
          }

          // Moving segment
          const durationMin = Math.round(
            (new Date(seg.endTime).getTime() - new Date(seg.startTime).getTime()) / 60000
          );

          return (
            <button
              key={`move-${seg.startTime}`}
              type="button"
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50 ${
                isSelected ? "bg-accent" : ""
              }`}
              onClick={() => onSegmentClick(i)}
            >
              <div className="flex flex-col items-center">
                <div className="flex h-5 w-6 items-center justify-center">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">
                  이동 {formatTime(seg.startTime)} - {formatTime(seg.endTime)} (
                  {formatDuration(durationMin)})
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
