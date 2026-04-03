"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Footprints,
  Bike,
  Car,
  Train,
  Plane,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Mountain,
} from "lucide-react";
import { useState } from "react";
import type { TrackData } from "../hooks";

const MODE_ICONS: Record<string, React.ReactNode> = {
  walking: <Footprints className="h-3.5 w-3.5" />,
  running: <Footprints className="h-3.5 w-3.5 text-orange-500" />,
  cycling: <Bike className="h-3.5 w-3.5 text-blue-500" />,
  driving: <Car className="h-3.5 w-3.5 text-red-500" />,
  motorcycle: <Car className="h-3.5 w-3.5 text-purple-500" />,
  bus: <Car className="h-3.5 w-3.5 text-green-600" />,
  train: <Train className="h-3.5 w-3.5 text-indigo-500" />,
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

interface TrackCardProps {
  track: TrackData;
}

export function TrackCard({ track }: TrackCardProps) {
  const [expanded, setExpanded] = useState(false);

  const startName = track.startPlaceName ?? formatTime(track.startTime);
  const endName = track.endPlaceName ?? formatTime(track.endTime);

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

        {/* Summary badges */}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{formatTime(track.startTime)} ~ {formatTime(track.endTime)}</span>
          <span>{formatDistance(track.distanceMeters)}</span>
          <span>{formatDuration(track.durationSeconds)}</span>
          {(track.elevationGain != null && track.elevationGain > 0) && (
            <span className="flex items-center gap-0.5">
              <Mountain className="h-3 w-3" />
              ↑{track.elevationGain}m
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
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{formatDuration(seg.durationSeconds)}</span>
                  <span>{formatDistance(seg.distanceMeters)}</span>
                  {seg.avgSpeedKmh != null && (
                    <span>평균 {Math.round(seg.avgSpeedKmh)}km/h</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
