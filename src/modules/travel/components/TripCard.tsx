import { ArrowRight, CalendarDays, MapPin, Wallet } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TravelTripListItem } from "../hooks";

function dateKeyToUtcMillis(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(millis).toISOString().slice(0, 10) === dateKey ? millis : null;
}

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

function formatWon(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  return `${safeValue.toLocaleString("ko-KR")}원`;
}

export function TripCard({ trip }: { trip: TravelTripListItem }) {
  const duration = getTripDuration(trip.startDate, trip.endDate);

  return (
    <Link href={`/travel/${trip.id}`} className="group block h-full">
      <Card className="h-full gap-4 py-5 transition-colors group-hover:border-foreground/25">
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
          <div className="mt-4 flex items-center justify-end gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            자세히 보기
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
