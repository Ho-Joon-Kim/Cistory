"use client";

import { Card, CardContent } from "@/components/ui/card";
import { GitCommit, MapPin, Timer } from "lucide-react";
import type { PlaceProductivity } from "../types";

interface PlaceProductivityCardProps {
  places: PlaceProductivity[];
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function PlaceProductivityCard({ places }: PlaceProductivityCardProps) {
  if (places.length === 0) return null;

  const maxScore = Math.max(...places.map((p) => p.productivityScore), 1);

  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">장소별 생산성</h3>

        <div className="space-y-4">
          {places.slice(0, 5).map((place) => (
            <div key={`${place.lat}-${place.lon}`} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {place.placeName}
                  </span>
                </div>
                <span className="text-sm font-bold">{place.productivityScore}점</span>
              </div>

              {/* 생산성 바 */}
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${(place.productivityScore / maxScore) * 100}%` }}
                />
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <GitCommit className="h-3 w-3" />
                  {place.commitCount}개
                </span>
                <span className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  {formatDuration(place.codingSeconds)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
