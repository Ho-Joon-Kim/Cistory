"use client";

import { MapPin } from "lucide-react";
import type { StayPointData } from "@/modules/location/hooks";

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
    <article className="activity-feed-card activity-location-card">
      <div className="activity-meta-row">
        <span className="activity-kind">
          <span className="activity-kind-dot" />
          위치
          {category && <span className="activity-category-chip">{category}</span>}
        </span>
        <time dateTime={startTime}>{formatTime(startTime)}</time>
      </div>

      <div className="activity-message-row">
        <span className="activity-icon-chip">
          <MapPin size={12} />
        </span>
        <strong>{title}</strong>
      </div>

      {placeName && address && <p className="activity-detail">{address}</p>}

      <div className="activity-stats-row">
        <span>
          {formatTime(startTime)}–{formatTime(endTime)}
        </span>
        <span className="activity-stat-emphasis">{formatDuration(durationMinutes)}</span>
      </div>
    </article>
  );
}
