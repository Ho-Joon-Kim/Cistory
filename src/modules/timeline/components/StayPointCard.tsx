"use client";

import { MapPin } from "lucide-react";
import type { StayPointData } from "@/modules/location/hooks";
import { ActivityCard } from "./ActivityCard";

interface StayPointCardProps {
  stayPoint: StayPointData;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
}

export function StayPointCard({ stayPoint }: StayPointCardProps) {
  const { placeName, address, category, startTime, endTime, durationMinutes } = stayPoint;
  const title = placeName || address || "알 수 없는 장소";

  return (
    <ActivityCard
      accent="location"
      kind="위치"
      chip={category}
      icon={<MapPin size={12} />}
      title={title}
      trailing={<time dateTime={startTime}>{formatTime(startTime)}</time>}
      detail={placeName ? address : undefined}
      stats={
        <>
          <span>
            {formatTime(startTime)}–{formatTime(endTime)}
          </span>
          <strong>{formatDuration(durationMinutes)}</strong>
        </>
      }
    />
  );
}
