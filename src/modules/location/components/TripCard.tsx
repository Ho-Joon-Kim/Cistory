"use client";

import { MapPin, Plane, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TripData } from "../hooks";

interface TripCardProps {
  trip: TripData;
  onDelete?: (id: string) => void;
}

function formatDateRange(startDate: string, endDate: string): string {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  const startStr = start.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (startDate === endDate) return `${startStr} (당일)`;
  return `${startStr} ~ ${endStr} (${diffDays}일)`;
}

export function TripCard({ trip, onDelete }: TripCardProps) {
  return (
    <Card className="!py-4 !gap-3">
      <CardHeader className="!pb-0">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {trip.isOverseas ? (
                <Plane className="h-4 w-4 text-sky-500" />
              ) : (
                <MapPin className="h-4 w-4 text-green-500" />
              )}
              {trip.name}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatDateRange(trip.startDate, trip.endDate)}
            </p>
          </div>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(trip.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {trip.visitedCities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trip.visitedCities.map((city) => (
              <span
                key={city}
                className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              >
                {city}
              </span>
            ))}
          </div>
        )}
        {trip.totalDistanceMeters != null && trip.totalDistanceMeters > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            총 이동거리: {(trip.totalDistanceMeters / 1000).toFixed(1)}km
          </p>
        )}
        {trip.notes && <p className="text-sm text-muted-foreground mt-2 italic">{trip.notes}</p>}
      </CardContent>
    </Card>
  );
}
