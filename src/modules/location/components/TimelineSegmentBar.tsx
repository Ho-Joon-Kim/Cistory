"use client";

import { useMemo } from "react";
import type { LocationData } from "../hooks";
import type { TimelineSegment } from "../utils";

interface TimelineSegmentBarProps {
  segments: TimelineSegment[];
  locations: LocationData[];
  selectedIndex: number | null;
  hoveredIndex: number | null;
  onSegmentClick: (index: number) => void;
  onSegmentHover: (index: number | null) => void;
}

interface SegmentPosition {
  leftPercent: number;
  widthPercent: number;
}

const MINUTES_PER_DAY = 1440;
const MAX_GRADIENT_POINTS = 240;

const SPEED_COLORS = [
  { speed: 0, rgb: [59, 130, 246] },
  { speed: 7, rgb: [34, 197, 94] },
  { speed: 20, rgb: [234, 179, 8] },
  { speed: 50, rgb: [249, 115, 22] },
  { speed: 100, rgb: [239, 68, 68] },
] as const;

function getDayPercent(isoString: string): number {
  const date = new Date(isoString);
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  return Math.max(0, Math.min(100, (minutes / MINUTES_PER_DAY) * 100));
}

function computeSegmentPositions(segments: TimelineSegment[]): SegmentPosition[] {
  return segments.map((segment) => {
    const start = segment.type === "moving" ? segment.startTime : segment.stayPoint.startTime;
    const end = segment.type === "moving" ? segment.endTime : segment.stayPoint.endTime;
    const leftPercent = getDayPercent(start);
    let endPercent = getDayPercent(end);
    if (endPercent <= leftPercent) endPercent = 100;

    return {
      leftPercent,
      widthPercent: Math.max(0, endPercent - leftPercent),
    };
  });
}

function speedToColor(speed: number): string {
  const value = Math.max(0, speed);
  const upperIndex = SPEED_COLORS.findIndex((stop) => value <= stop.speed);

  if (upperIndex <= 0) {
    const [r, g, b] = upperIndex === 0 ? SPEED_COLORS[0].rgb : SPEED_COLORS.at(-1)!.rgb;
    return `rgb(${r} ${g} ${b})`;
  }

  const lower = SPEED_COLORS[upperIndex - 1];
  const upper = SPEED_COLORS[upperIndex];
  const ratio = (value - lower.speed) / (upper.speed - lower.speed);
  const rgb = lower.rgb.map((channel, index) =>
    Math.round(channel + (upper.rgb[index] - channel) * ratio)
  );
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function distanceInKm(a: LocationData, b: LocationData): number {
  const earthRadiusKm = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((b.lon - a.lon) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getSpeed(locations: LocationData[], index: number): number {
  const location = locations[index];
  if (location.velocity != null && Number.isFinite(location.velocity)) {
    return Math.abs(location.velocity);
  }
  if (index === 0) return 0;

  const previous = locations[index - 1];
  const elapsedHours =
    (new Date(location.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 3_600_000;
  return elapsedHours > 0 ? distanceInKm(previous, location) / elapsedHours : 0;
}

/** Build one continuous, speed-coloured reading-progress style gradient. */
export function buildSpeedGradient(locations: LocationData[]): string {
  if (locations.length === 0) return "none";

  const sorted = [...locations].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const bucketCount = Math.min(sorted.length, MAX_GRADIENT_POINTS);
  const points = Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const startIndex = Math.floor((bucketIndex * sorted.length) / bucketCount);
    const endIndex = Math.max(
      startIndex + 1,
      Math.floor(((bucketIndex + 1) * sorted.length) / bucketCount)
    );
    const speeds = sorted.slice(startIndex, endIndex).map((_, offset) =>
      getSpeed(sorted, startIndex + offset)
    );
    const averageSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    const representativeIndex =
      bucketIndex === 0
        ? 0
        : bucketIndex === bucketCount - 1
          ? sorted.length - 1
          : Math.floor((startIndex + endIndex - 1) / 2);
    return {
      percent: getDayPercent(sorted[representativeIndex].timestamp),
      color: speedToColor(averageSpeed),
    };
  });

  const first = points[0];
  const last = points.at(-1)!;
  if (points.length === 1) {
    const start = Math.max(0, first.percent - 0.2);
    const end = Math.min(100, first.percent + 0.2);
    return `linear-gradient(90deg, transparent 0%, transparent ${start}%, ${first.color} ${start}%, ${first.color} ${end}%, transparent ${end}%, transparent 100%)`;
  }

  const stops = ["transparent 0%", `transparent ${first.percent}%`, `${first.color} ${first.percent}%`];
  for (const point of points.slice(1)) stops.push(`${point.color} ${point.percent}%`);
  stops.push(`${last.color} ${last.percent}%`, `transparent ${last.percent}%`, "transparent 100%");
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function getSegmentLabel(segment: TimelineSegment): string {
  const start = segment.type === "moving" ? segment.startTime : segment.stayPoint.startTime;
  const end = segment.type === "moving" ? segment.endTime : segment.stayPoint.endTime;
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const timeRange = `${new Date(start).toLocaleTimeString("ko-KR", timeOptions)}–${new Date(end).toLocaleTimeString("ko-KR", timeOptions)}`;
  if (segment.type === "moving") return `이동 ${timeRange}`;
  return `${segment.stayPoint.placeName || "체류 지점"} ${timeRange}`;
}

export function TimelineSegmentBar({
  segments,
  locations,
  selectedIndex,
  hoveredIndex,
  onSegmentClick,
  onSegmentHover,
}: TimelineSegmentBarProps) {
  const positions = useMemo(() => computeSegmentPositions(segments), [segments]);
  const gradient = useMemo(() => buildSpeedGradient(locations), [locations]);

  if (segments.length === 0) return null;

  return (
    <fieldset className="speed-progress" aria-label="하루 이동 속도 타임라인">
      <div className="speed-progress-track" style={{ backgroundImage: gradient }}>
        {segments.map((segment, index) => {
          const position = positions[index];
          const isActive = selectedIndex === index || hoveredIndex === index;
          return (
            <button
              key={`${segment.type}-${segment.type === "moving" ? segment.startTime : segment.stayPoint.startTime}`}
              type="button"
              className={`speed-progress-hit-area ${isActive ? "speed-progress-hit-area-active" : ""}`}
              style={{ left: `${position.leftPercent}%`, width: `${position.widthPercent}%` }}
              onClick={() => onSegmentClick(index)}
              onMouseEnter={() => onSegmentHover(index)}
              onMouseLeave={() => onSegmentHover(null)}
              aria-pressed={selectedIndex === index}
              aria-label={getSegmentLabel(segment)}
              title={getSegmentLabel(segment)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
