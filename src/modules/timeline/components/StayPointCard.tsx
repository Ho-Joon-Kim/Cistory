"use client";

import { Clock, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { StayPointData } from "@/modules/location/hooks";

interface StayPointCardProps {
  stayPoint: StayPointData;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
}

export function StayPointCard({ stayPoint }: StayPointCardProps) {
  const { placeName, address, category, startTime, endTime, durationMinutes, icon } = stayPoint;

  return (
    <Card className="!py-0 !gap-0 rounded-lg relative overflow-hidden">
      {/* Primary color left border */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />

      <CardContent className="py-2 pl-4 pr-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0 text-base">
              {icon || <MapPin className="h-4 w-4 text-primary" />}
            </span>
            <div className="min-w-0">
              <span className="font-medium text-sm truncate block">
                {placeName || address || "알 수 없는 장소"}
              </span>
              {placeName && address && (
                <span className="text-xs text-muted-foreground truncate block">{address}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            {category && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                {category}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTime(startTime)} – {formatTime(endTime)}
          </span>
          <span>{formatDuration(durationMinutes)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
