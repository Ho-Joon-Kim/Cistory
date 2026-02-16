"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Plane } from "lucide-react";
import type { MonthlyReportData } from "../types";

interface TopPlacesProps {
  places: MonthlyReportData["topPlaces"];
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}분`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function TopPlaces({ places }: TopPlacesProps) {
  const topTen = places.slice(0, 10);

  if (topTen.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">자주 방문한 장소</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">위치 데이터가 없습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">자주 방문한 장소</CardTitle>
      </CardHeader>
      <CardContent className="!pt-0">
        <div className="divide-y">
          {topTen.map((place, index) => (
            <div
              key={`${place.placeName}-${place.lat}-${place.lon}`}
              className={cn(
                "flex items-center gap-3 py-2.5",
                index % 2 === 1 && "bg-muted/30",
                index === 0 && "pt-0",
              )}
            >
              {/* Rank */}
              <span
                className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  index < 3
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>

              {/* Place info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {place.placeName}
                  </span>
                  {place.isOverseas && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300 flex-shrink-0">
                      <Plane className="h-2.5 w-2.5" />
                      해외
                    </span>
                  )}
                </div>
                {place.address && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {place.address}
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-medium">{place.visitCount}회</p>
                <p className="text-xs text-muted-foreground">
                  {formatDuration(place.totalMinutes)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
