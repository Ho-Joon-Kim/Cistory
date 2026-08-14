"use client";

import {
  ArrowLeftRight,
  ArrowRight,
  Bike,
  Car,
  ChevronDown,
  ChevronUp,
  Footprints,
  Mountain,
  Plane,
  Train,
  TrainFront,
} from "lucide-react";
import { useState } from "react";
import { ActivityCard } from "@/modules/timeline/components/ActivityCard";
import type { SubwayLegData, TrackData, TrackSegmentData } from "../hooks";

const MODE_ICONS: Record<string, React.ReactNode> = {
  walking: <Footprints className="h-3.5 w-3.5" />,
  running: <Footprints className="h-3.5 w-3.5 text-orange-500" />,
  cycling: <Bike className="h-3.5 w-3.5 text-blue-500" />,
  driving: <Car className="h-3.5 w-3.5 text-red-500" />,
  motorcycle: <Car className="h-3.5 w-3.5 text-purple-500" />,
  bus: <Car className="h-3.5 w-3.5 text-green-600" />,
  train: <Train className="h-3.5 w-3.5 text-indigo-500" />,
  subway: <TrainFront className="h-3.5 w-3.5 text-emerald-500" />,
  flying: <Plane className="h-3.5 w-3.5 text-sky-500" />,
};

const MODE_LABELS: Record<string, string> = {
  stationary: "정지",
  walking: "도보",
  running: "달리기",
  cycling: "자전거",
  driving: "차량",
  motorcycle: "오토바이",
  bus: "버스",
  train: "기차",
  subway: "지하철",
  flying: "비행",
  boat: "보트",
  unknown: "미분류",
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function lineRefLabel(ref: string | null, name: string | null): string {
  if (ref) {
    if (/^\d+$/.test(ref)) return `${ref}호선`;
    return ref;
  }
  return name ?? "노선";
}

function ConfidenceDot({ score }: { score: number }) {
  const color = score >= 0.8 ? "bg-green-500" : score >= 0.55 ? "bg-yellow-400" : "bg-zinc-300";
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${color}`}
      title={`신뢰도 ${Math.round(score * 100)}%`}
    />
  );
}

function SubwayLegBadge({ leg }: { leg: SubwayLegData }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]"
      style={{ borderColor: leg.lineColor, color: leg.lineColor }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: leg.lineColor }}
      />
      <span className="font-medium">{lineRefLabel(leg.lineRef, leg.lineName)}</span>
      {leg.startStationName && (
        <span className="text-foreground">
          {leg.startStationName}
          {leg.endStationName && (
            <>
              {" "}
              <ArrowRight className="inline h-2.5 w-2.5" /> {leg.endStationName}
            </>
          )}
        </span>
      )}
      <ConfidenceDot score={leg.totalConfidence} />
    </span>
  );
}

/**
 * One leg tagged with the startTime of the segment that owns it. `legOrder` is
 * segment-local — unique only per `(transportationSegmentId, legOrder)` — so it
 * identifies a leg just within its own segment. Across a chunk's flattened
 * transfer chain the same legOrder recurs, and so can the same lineId (a
 * there-and-back rides one line twice), which is why the pair is what's stored.
 */
interface ChunkLeg {
  segmentStartTime: string;
  leg: SubwayLegData;
}

interface SegmentChunk {
  kind: "regular" | "subway-session";
  segments: TrackSegmentData[];
  legs: ChunkLeg[]; // flat ordered list across segments in the chunk
}

function tagLegs(segment: TrackSegmentData): ChunkLeg[] {
  return segment.subwayLegs.map((leg) => ({ segmentStartTime: segment.startTime, leg }));
}

/**
 * Group consecutive segments that share a subway session_id so a transfer chain
 * renders as one badge ("2호선 강남 → 교대 ⇄ 3호선 교대 → 안국") instead of two
 * disconnected badges. Segments without subway match render as their own chunks.
 */
function groupIntoChunks(segments: TrackSegmentData[]): SegmentChunk[] {
  const chunks: SegmentChunk[] = [];
  let cursor = 0;
  while (cursor < segments.length) {
    const seg = segments[cursor];
    if (seg.subwayLegs.length === 0) {
      chunks.push({ kind: "regular", segments: [seg], legs: [] });
      cursor++;
      continue;
    }
    // Walk forward as long as segments share the SAME non-null session_id with
    // their previous neighbor's last leg. (sessionId can be null if the
    // grouper hasn't run yet — treat null as standalone.)
    const sessionId = seg.subwayLegs[0].sessionId;
    if (!sessionId) {
      chunks.push({ kind: "subway-session", segments: [seg], legs: tagLegs(seg) });
      cursor++;
      continue;
    }
    const groupSegments: TrackSegmentData[] = [seg];
    const groupLegs: ChunkLeg[] = tagLegs(seg);
    let i = cursor + 1;
    while (
      i < segments.length &&
      segments[i].subwayLegs.length > 0 &&
      segments[i].subwayLegs[0].sessionId === sessionId
    ) {
      groupSegments.push(segments[i]);
      groupLegs.push(...tagLegs(segments[i]));
      i++;
    }
    chunks.push({ kind: "subway-session", segments: groupSegments, legs: groupLegs });
    cursor = i;
  }
  return chunks;
}

interface TrackCardProps {
  track: TrackData;
}

export function TrackCard({ track }: TrackCardProps) {
  const [expanded, setExpanded] = useState(false);

  const startName = track.startPlaceName ?? formatTime(track.startTime);
  const endName = track.endPlaceName ?? formatTime(track.endTime);
  const chunks = groupIntoChunks(track.segments);
  const primaryMode = track.segments[0]?.mode ?? "unknown";
  const subwayDetail = chunks.some((chunk) => chunk.kind === "subway-session") ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {chunks
        .filter((chunk) => chunk.kind === "subway-session")
        .map((chunk) => (
          <span key={chunk.segments[0]?.startTime} className="flex flex-wrap items-center gap-1">
            {chunk.legs.map(({ segmentStartTime, leg }, index) => (
              <span key={`${segmentStartTime}-${leg.legOrder}`} className="flex items-center gap-1">
                {index > 0 && <ArrowLeftRight className="size-3 text-muted-foreground" />}
                <SubwayLegBadge leg={leg} />
              </span>
            ))}
          </span>
        ))}
    </div>
  ) : undefined;

  return (
    <ActivityCard
      accent="movement"
      kind="이동"
      chip={
        <>
          {MODE_ICONS[primaryMode]}
          {MODE_LABELS[primaryMode] ?? primaryMode}
        </>
      }
      icon={<ArrowRight size={12} />}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{startName}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{endName}</span>
        </span>
      }
      trailing={
        <span className="flex items-center gap-1.5">
          <time dateTime={track.startTime}>{formatTime(track.startTime)}</time>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      }
      detail={subwayDetail}
      stats={
        <>
          <span>
            {formatTime(track.startTime)}–{formatTime(track.endTime)}
          </span>
          <strong>{formatDistance(track.distanceMeters)}</strong>
          <span>{formatDuration(track.durationSeconds)}</span>
          {track.elevationGain != null && track.elevationGain > 0 && (
            <span className="flex items-center gap-0.5">
              <Mountain className="size-3" />↑{track.elevationGain}m
              {track.elevationLoss != null && track.elevationLoss > 0 && (
                <> ↓{track.elevationLoss}m</>
              )}
            </span>
          )}
        </>
      }
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      toggleLabel={`이동 기록 ${expanded ? "접기" : "펼치기"}`}
    >
      {expanded && track.segments.length > 0 && (
        <div className="activity-expanded-details">
          {track.segments.map((segment) => (
            <div key={segment.startTime} className="activity-segment-row">
              <div className="flex min-w-0 items-center gap-1.5">
                {MODE_ICONS[segment.mode] ?? null}
                <span className="font-medium">{MODE_LABELS[segment.mode] ?? segment.mode}</span>
                {segment.subwayLegs.length > 0 && (
                  <span className="ml-1 flex min-w-0 items-center gap-1">
                    {segment.subwayLegs.map((leg) => (
                      <SubwayLegBadge key={leg.legOrder} leg={leg} />
                    ))}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <span>{formatDuration(segment.durationSeconds)}</span>
                <span>{formatDistance(segment.distanceMeters)}</span>
                {segment.avgSpeedKmh != null && (
                  <span>평균 {Math.round(segment.avgSpeedKmh)}km/h</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ActivityCard>
  );
}
