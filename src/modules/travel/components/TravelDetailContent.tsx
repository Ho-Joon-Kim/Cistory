import { ArrowLeft, CalendarDays } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TravelRoute, TravelTripDetail } from "../hooks";
import { getTripDuration } from "./TripCard";
import { TripHealthCard } from "./TripHealthCard";
import { TripRouteMap } from "./TripRouteMap";
import { TripRoutineCard } from "./TripRoutineCard";
import { TripSpendingCard } from "./TripSpendingCard";
import { TripTimeline } from "./TripTimeline";
import { TripTransportCard } from "./TripTransportCard";

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

export function TravelDetailContent({
  detail,
  route,
}: {
  detail: TravelTripDetail;
  route: TravelRoute;
}) {
  const { trip, visits } = detail;
  const duration = getTripDuration(trip.startDate, trip.endDate);

  return (
    <>
      <div className="mb-6">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
          <Link href="/travel">
            <ArrowLeft aria-hidden="true" />
            여행 목록
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{trip.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {formatDateKey(trip.startDate)} ~ {formatDateKey(trip.endDate)}
              </span>
              <span>
                {duration.nights}박 {duration.days}일
              </span>
            </div>
          </div>
          <Badge variant={trip.isOverseas ? "default" : "outline"}>
            {trip.isOverseas ? "해외" : "국내"}
          </Badge>
        </div>
      </div>

      <div className="space-y-6">
        <section aria-labelledby="trip-route-heading">
          <h2 id="trip-route-heading" className="mb-3 text-lg font-semibold">
            여행 경로
          </h2>
          <TripRouteMap points={route.points} visits={visits} />
        </section>
        <TripTimeline startDate={trip.startDate} endDate={trip.endDate} visits={visits} />
        <div className="grid gap-6 lg:grid-cols-2">
          <TripSpendingCard spending={detail.spending} />
          <TripTransportCard transport={detail.transport} />
          <TripRoutineCard routine={detail.routine} />
          {detail.health.length > 0 ? <TripHealthCard health={detail.health} /> : null}
        </div>
      </div>
    </>
  );
}
