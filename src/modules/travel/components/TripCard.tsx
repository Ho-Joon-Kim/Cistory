"use client";

import { ArrowRight, CalendarDays, Loader2, MapPin, Wallet, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateKeyToUtcMillis } from "@/lib/date-key";
import { formatWon } from "../format";
import type { TravelTripListItem } from "../hooks";

export function getTripDuration(
  startDate: string,
  endDate: string
): { nights: number; days: number } {
  const start = dateKeyToUtcMillis(startDate);
  const end = dateKeyToUtcMillis(endDate);
  if (start === null || end === null || end < start) return { nights: 0, days: 1 };
  const nights = Math.round((end - start) / 86_400_000);
  return { nights, days: nights + 1 };
}

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

interface TripCardProps {
  trip: TravelTripListItem;
  onMarkNotTrip?: (tripId: string) => Promise<boolean>;
  isMarkingNotTrip?: boolean;
}

export function TripCard({ trip, onMarkNotTrip, isMarkingNotTrip = false }: TripCardProps) {
  const duration = getTripDuration(trip.startDate, trip.endDate);

  const handleMarkNotTrip = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onMarkNotTrip || isMarkingNotTrip) return;
    if (!window.confirm(`"${trip.name}"을(를) 여행 목록에서 제외할까요?`)) return;

    if (await onMarkNotTrip(trip.id)) {
      toast.success("여행에서 제외하고 정기 방문지로 등록했습니다");
    } else {
      toast.error("여행 제외 처리에 실패했습니다");
    }
  };

  return (
    <Card className="group relative h-full gap-4 py-5 transition-colors hover:border-foreground/25">
      <Link
        href={`/travel/${trip.id}`}
        aria-label={`${trip.name} 자세히 보기`}
        className="absolute inset-0 z-0 rounded-xl"
      />
      <div className="pointer-events-none relative z-10 flex h-full flex-col gap-4">
        <CardHeader className="gap-3 px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">{trip.name}</CardTitle>
              <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                <span>
                  {formatDateKey(trip.startDate)} ~ {formatDateKey(trip.endDate)}
                </span>
              </div>
            </div>
            <Badge variant={trip.isOverseas ? "default" : "outline"}>
              {trip.isOverseas ? "해외" : "국내"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="mt-auto px-5">
          <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <span className="font-medium text-foreground">
              {duration.nights}박 {duration.days}일
            </span>
            <span className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4" aria-hidden="true" />총 지출{" "}
              {formatWon(trip.totalSpending)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              방문지 {Math.max(0, Math.round(trip.visitCount))}곳
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="pointer-events-auto -ml-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={isMarkingNotTrip || !onMarkNotTrip}
              onClick={handleMarkNotTrip}
            >
              {isMarkingNotTrip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              여행 아님
            </Button>
            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              자세히 보기
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
