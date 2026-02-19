"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import type { TimelineSegment } from "../utils";
import { computeSegmentDistance } from "../utils";

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

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

interface TimelineSegmentBarProps {
  segments: TimelineSegment[];
  selectedIndex: number | null;
  hoveredIndex: number | null;
  onSegmentClick: (index: number) => void;
  onSegmentHover: (index: number | null) => void;
}

function computeFlexGrows(segments: TimelineSegment[]): number[] {
  const MIN_STAY = 8;
  const MIN_MOVE = 5;

  const durations = segments.map((seg) => {
    if (seg.type === "moving") {
      return Math.max(new Date(seg.endTime).getTime() - new Date(seg.startTime).getTime(), 60_000);
    }
    const sp = seg.stayPoint;
    return Math.max(new Date(sp.endTime).getTime() - new Date(sp.startTime).getTime(), 60_000);
  });
  const totalMs = durations.reduce((s, d) => s + d, 0);

  const raw = durations.map((d) => (d / totalMs) * 100);
  const adjusted = raw.map((p, i) =>
    Math.max(p, segments[i].type === "staying" ? MIN_STAY : MIN_MOVE),
  );
  const adjTotal = adjusted.reduce((s, p) => s + p, 0);
  return adjusted.map((p) => (p / adjTotal) * 100);
}

/**
 * Which staying segments show time labels.
 * <=4 stays: show all. Otherwise: first, last, selected, hovered,
 * + greedily fill ensuring >= MIN_GAP% between shown labels.
 */
function computeVisibleTimeLabels(
  segments: TimelineSegment[],
  flexGrows: number[],
  selectedIndex: number | null,
  hoveredIndex: number | null,
): Set<number> {
  const stayIndices = segments
    .map((s, i) => (s.type === "staying" ? i : -1))
    .filter((i) => i >= 0);

  if (stayIndices.length <= 4) return new Set(stayIndices);

  const visible = new Set<number>();
  visible.add(stayIndices[0]);
  visible.add(stayIndices[stayIndices.length - 1]);

  if (selectedIndex !== null && segments[selectedIndex]?.type === "staying") {
    visible.add(selectedIndex);
  }
  if (hoveredIndex !== null && segments[hoveredIndex]?.type === "staying") {
    visible.add(hoveredIndex);
  }

  // Cumulative center position for each stay
  const centerPositions: { index: number; center: number }[] = [];
  let cumPct = 0;
  for (let i = 0; i < segments.length; i++) {
    const center = cumPct + flexGrows[i] / 2;
    if (segments[i].type === "staying") {
      centerPositions.push({ index: i, center });
    }
    cumPct += flexGrows[i];
  }

  const MIN_GAP = 12;
  for (const { index, center } of centerPositions) {
    if (visible.has(index)) continue;
    const tooClose = [...visible].some((vi) => {
      const viPos = centerPositions.find((c) => c.index === vi);
      return viPos && Math.abs(viPos.center - center) < MIN_GAP;
    });
    if (!tooClose) visible.add(index);
  }

  return visible;
}

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
    document.body,
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

  const flexGrows = useMemo(() => computeFlexGrows(segments), [segments]);

  const visibleTimeLabels = useMemo(
    () => computeVisibleTimeLabels(segments, flexGrows, selectedIndex, hoveredIndex),
    [segments, flexGrows, selectedIndex, hoveredIndex],
  );

  if (segments.length === 0) return null;

  // Tooltip target
  const tooltipSeg =
    tooltipIndex !== null ? segments[tooltipIndex] : null;
  const tooltipAnchor =
    tooltipIndex !== null ? dotRefs.current.get(tooltipIndex) ?? null : null;

  return (
    <div className="stepper-bar">
      {/* Row 1: Time labels (above) */}
      <div className="stepper-bar-times">
        {segments.map((seg, i) => (
          <div
            key={`time-${i}`}
            className="stepper-label-cell"
            style={{ flex: `${flexGrows[i]} 0 0%` }}
          >
            {seg.type === "staying" && visibleTimeLabels.has(i) ? (
              <span className="stepper-time-text">{formatTime(seg.stayPoint.startTime)}</span>
            ) : seg.type === "moving" ? (
              <span className="stepper-dist-text">
                {computeSegmentDistance(seg.coords) > 100 && flexGrows[i] > 8
                  ? formatDistance(computeSegmentDistance(seg.coords))
                  : ""}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Row 2: Dots and dashes (middle track) */}
      <div className="stepper-bar-track">
        {segments.map((seg, i) => {
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
              <div
                key={`track-${i}`}
                className="stepper-cell"
                style={{ flex: `${flexGrows[i]} 0 0%` }}
              >
                <button
                  ref={(el) => {
                    if (el) dotRefs.current.set(i, el);
                  }}
                  type="button"
                  className={dotClasses}
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
              </div>
            );
          }

          // Moving segment
          return (
            <div
              key={`track-${i}`}
              className="stepper-cell"
              style={{ flex: `${flexGrows[i]} 0 0%` }}
            >
              <div
                className={`stepper-dash ${isDimmed ? "stepper-dash-dimmed" : ""}`}
                onClick={() => onSegmentClick(i)}
                onMouseEnter={() => onSegmentHover(i)}
                onMouseLeave={() => onSegmentHover(null)}
              />
            </div>
          );
        })}
      </div>

      {/* Row 3: Place name labels (below) */}
      <div className="stepper-bar-places">
        {segments.map((seg, i) => (
          <div
            key={`place-${i}`}
            className="stepper-label-cell"
            style={{ flex: `${flexGrows[i]} 0 0%` }}
          >
            {seg.type === "staying" && (
              <span className="stepper-place-text">
                {seg.stayPoint.placeName || formatDuration(seg.stayPoint.durationMinutes)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Tooltip via portal — always above map */}
      {tooltipSeg?.type === "staying" && tooltipAnchor && (
        <StepperTooltip anchorEl={tooltipAnchor} segment={tooltipSeg} />
      )}
    </div>
  );
}
