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
import { Card, CardContent } from "@/components/ui/card";
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

interface SegmentChunk {
  kind: "regular" | "subway-session";
  segments: TrackSegmentData[];
  legs: SubwayLegData[]; // flat ordered list across segments in the chunk
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
      chunks.push({ kind: "subway-session", segments: [seg], legs: [...seg.subwayLegs] });
      cursor++;
      continue;
    }
    const groupSegments: TrackSegmentData[] = [seg];
    const groupLegs: SubwayLegData[] = [...seg.subwayLegs];
    let i = cursor + 1;
    while (
      i < segments.length &&
      segments[i].subwayLegs.length > 0 &&
      segments[i].subwayLegs[0].sessionId === sessionId
    ) {
      groupSegments.push(segments[i]);
      groupLegs.push(...segments[i].subwayLegs);
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

  return (
    <Card className="!py-3 !gap-2">
      <CardContent className="!pt-0">
        {/* Header: Start → End */}
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{startName}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">{endName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Mode icons sequence */}
            <div className="flex items-center gap-0.5">
              {track.segments.map((seg, i) => (
                <span key={`${seg.mode}-${i}`} title={MODE_LABELS[seg.mode] ?? seg.mode}>
                  {MODE_ICONS[seg.mode] ?? <span className="text-xs">{seg.mode}</span>}
                </span>
              ))}
            </div>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Subway badges (always visible — these are the headline labels) */}
        {chunks.some((c) => c.kind === "subway-session") && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {chunks
              .filter((c) => c.kind === "subway-session")
              .map((chunk) => (
                <span
                  key={chunk.legs.map((l) => l.lineId).join(":") || chunk.segments[0]?.startTime}
                  className="flex flex-wrap items-center gap-1"
                >
                  {chunk.legs.map((leg, li) => (
                    <span key={`${leg.lineId}-${li}`} className="flex items-center gap-1">
                      {li > 0 && <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />}
                      <SubwayLegBadge leg={leg} />
                    </span>
                  ))}
                </span>
              ))}
          </div>
        )}

        {/* Summary badges */}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>
            {formatTime(track.startTime)} ~ {formatTime(track.endTime)}
          </span>
          <span>{formatDistance(track.distanceMeters)}</span>
          <span>{formatDuration(track.durationSeconds)}</span>
          {track.elevationGain != null && track.elevationGain > 0 && (
            <span className="flex items-center gap-0.5">
              <Mountain className="h-3 w-3" />↑{track.elevationGain}m
              {track.elevationLoss != null && track.elevationLoss > 0 && (
                <> ↓{track.elevationLoss}m</>
              )}
            </span>
          )}
        </div>

        {/* Expanded: segment details */}
        {expanded && track.segments.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t pt-2">
            {track.segments.map((seg, i) => (
              <div
                key={`${seg.startTime}-${i}`}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-1.5">
                  {MODE_ICONS[seg.mode] ?? null}
                  <span className="font-medium">{MODE_LABELS[seg.mode] ?? seg.mode}</span>
                  {seg.subwayLegs.length > 0 && (
                    <span className="ml-1 flex items-center gap-1">
                      {seg.subwayLegs.map((leg, li) => (
                        <SubwayLegBadge key={`${leg.lineId}-${li}`} leg={leg} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{formatDuration(seg.durationSeconds)}</span>
                  <span>{formatDistance(seg.distanceMeters)}</span>
                  {seg.avgSpeedKmh != null && <span>평균 {Math.round(seg.avgSpeedKmh)}km/h</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
