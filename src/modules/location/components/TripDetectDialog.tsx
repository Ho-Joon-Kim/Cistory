"use client";

import { Check, Loader2, MapPin, Plane } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DetectedTripData } from "../hooks";

interface TripDetectDialogProps {
  trips: DetectedTripData[];
  isSaving: boolean;
  onConfirm: (trips: DetectedTripData[]) => void;
  onCancel: () => void;
}

function formatDateRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  const startStr = s.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  const endStr = e.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (start === end) return `${startStr} (당일)`;
  return `${startStr} ~ ${endStr} (${days}일)`;
}

export function TripDetectDialog({ trips, isSaving, onConfirm, onCancel }: TripDetectDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set(trips.map((_, i) => i)));

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedTrips = trips.filter((_, i) => selected.has(i));
    onConfirm(selectedTrips);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">감지된 여행 {trips.length}건</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            취소
          </Button>
          <Button size="sm" disabled={selected.size === 0 || isSaving} onClick={handleConfirm}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            {selected.size}건 저장
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {trips.map((trip, i) => (
          <Card
            key={`${trip.startDate}-${trip.name}`}
            className={`!py-3 cursor-pointer transition-colors ${
              selected.has(i) ? "border-primary bg-primary/5" : "opacity-50"
            }`}
            onClick={() => toggleSelect(i)}
          >
            <CardContent className="!pt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {trip.isOverseas ? (
                    <Plane className="h-4 w-4 text-sky-500" />
                  ) : (
                    <MapPin className="h-4 w-4 text-green-500" />
                  )}
                  <span className="font-medium">{trip.name}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {formatDateRange(trip.startDate, trip.endDate)}
                </span>
              </div>
              {trip.visitedCities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {trip.visitedCities.map((city) => (
                    <span
                      key={city}
                      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs"
                    >
                      {city}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
