"use client";

import { Clock } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TimelineSegment } from "../utils";

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

interface TimelineSegmentBarProps {
  segments: TimelineSegment[];
  selectedIndex: number | null;
  hoveredIndex: number | null;
  onSegmentClick: (index: number) => void;
  onSegmentHover: (index: number | null) => void;
}

/** ISO 타임스탬프 → 자정 기준 분(0~1439) */
function getMinutesFromMidnight(isoString: string): number {
  const d = new Date(isoString);
  return d.getHours() * 60 + d.getMinutes();
}

interface SegmentPosition {
  leftPercent: number;
  widthPercent: number;
}

/** 각 세그먼트의 24시간 타임라인 내 절대 위치 계산 */
function computeSegmentPositions(segments: TimelineSegment[]): SegmentPosition[] {
  const MINUTES_PER_DAY = 1440;
  return segments.map((seg) => {
    const start = seg.type === "moving" ? seg.startTime : seg.stayPoint.startTime;
    const end = seg.type === "moving" ? seg.endTime : seg.stayPoint.endTime;
    const startMin = getMinutesFromMidnight(start);
    let endMin = getMinutesFromMidnight(end);
    if (endMin <= startMin) endMin = MINUTES_PER_DAY;
    return {
      leftPercent: Math.max(0, Math.min(100, (startMin / MINUTES_PER_DAY) * 100)),
      widthPercent: Math.max(0, Math.min(100, ((endMin - startMin) / MINUTES_PER_DAY) * 100)),
    };
  });
}

const TIME_TICKS = [
  { percent: 0, label: "0시" },
  { percent: 25, label: "6시" },
  { percent: 50, label: "12시" },
  { percent: 75, label: "18시" },
  { percent: 100, label: "24시" },
] as const;

/** Tooltip rendered via portal so it always floats above the map */
function StepperTooltip({
  anchorEl,
  segment,
}: {
  anchorEl: HTMLElement;
  segment: TimelineSegment & { type: "staying" };
}) {
  const sp = segment.stayPoint;
  const rect = anchorEl.getBoundingClientRect();

  return createPortal(
    <div
      className="stepper-tooltip"
      style={{
        position: "fixed",
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      {sp.placeName && <p className="stepper-tooltip-name">{sp.placeName}</p>}
      {sp.address && sp.address !== sp.placeName && (
        <p className="stepper-tooltip-address">{sp.address}</p>
      )}
      <div className="stepper-tooltip-time">
        <Clock className="h-3 w-3" />
        <span>
          {formatTime(sp.startTime)} – {formatTime(sp.endTime)} (
          {formatDuration(sp.durationMinutes)})
        </span>
      </div>
      {sp.category && <span className="stepper-tooltip-category">{sp.category}</span>}
    </div>,
    document.body
  );
}

export function TimelineSegmentBar({
  segments,
  selectedIndex,
  hoveredIndex,
  onSegmentClick,
  onSegmentHover,
}: TimelineSegmentBarProps) {
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const dotRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const positions = useMemo(() => computeSegmentPositions(segments), [segments]);

  if (segments.length === 0) return null;

  // Tooltip target
  const tooltipSeg = tooltipIndex !== null ? segments[tooltipIndex] : null;
  const tooltipAnchor = tooltipIndex !== null ? (dotRefs.current.get(tooltipIndex) ?? null) : null;

  return (
    <div className="stepper-bar">
      {/* Row 1: Fixed time ticks (0시~24시) */}
      <div className="stepper-bar-ticks">
        {TIME_TICKS.map((tick) => (
          <span
            key={tick.percent}
            className="stepper-tick-label"
            style={{ left: `${tick.percent}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* Row 2: Dots and dashes (absolute positioned on track) */}
      <div className="stepper-bar-track">
        {segments.map((seg, i) => {
          const pos = positions[i];
          const isSelected = selectedIndex === i;
          const isDimmed = selectedIndex !== null && !isSelected;

          if (seg.type === "staying") {
            const sp = seg.stayPoint;

            const dotClasses = [
              "stepper-bar-dot",
              sp.savedPlaceId ? "stepper-bar-dot-saved" : "",
              isSelected ? "stepper-bar-dot-selected" : "",
              isDimmed ? "stepper-bar-dot-dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={`track-${i}`}
                ref={(el) => {
                  if (el) dotRefs.current.set(i, el);
                }}
                type="button"
                className={dotClasses}
                style={{ left: `${pos.leftPercent + pos.widthPercent / 2}%` }}
                onClick={() => onSegmentClick(i)}
                onMouseEnter={() => {
                  onSegmentHover(i);
                  setTooltipIndex(i);
                }}
                onMouseLeave={() => {
                  onSegmentHover(null);
                  setTooltipIndex(null);
                }}
                aria-label={sp.placeName || "체류 지점"}
              />
            );
          }

          // Moving segment
          return (
            <div
              key={`track-${i}`}
              className={`stepper-dash ${isDimmed ? "stepper-dash-dimmed" : ""}`}
              style={{ left: `${pos.leftPercent}%`, width: `${pos.widthPercent}%` }}
              onClick={() => onSegmentClick(i)}
              onMouseEnter={() => onSegmentHover(i)}
              onMouseLeave={() => onSegmentHover(null)}
            />
          );
        })}
      </div>

      {/* Tooltip via portal — always above map */}
      {tooltipSeg?.type === "staying" && tooltipAnchor && (
        <StepperTooltip anchorEl={tooltipAnchor} segment={tooltipSeg} />
      )}
    </div>
  );
}
