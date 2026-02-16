"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plane } from "lucide-react";
import type { MonthlyReportData } from "../types";

interface OverseasTripCardsProps {
  trips: MonthlyReportData["overseasTrips"];
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startStr = start.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
  const endStr = end.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });

  const diffDays =
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (startDate === endDate) {
    return `${startStr} (당일)`;
  }
  return `${startStr} ~ ${endStr} (${diffDays}일)`;
}

export function OverseasTripCards({ trips }: OverseasTripCardsProps) {
  if (trips.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold flex items-center gap-2">
        <Plane className="h-4 w-4" />
        해외 여행
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {trips.map((trip) => (
          <Card
            key={`${trip.country}-${trip.startDate}`}
            className="!py-4 !gap-3"
          >
            <CardHeader className="!pb-0">
              <CardTitle className="text-xl">{trip.country}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formatDateRange(trip.startDate, trip.endDate)}
              </p>
            </CardHeader>
            <CardContent>
              {trip.places.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {trip.places.map((place) => (
                    <span
                      key={place}
                      className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    >
                      {place}
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
