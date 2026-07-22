"use client";

import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/hooks";
import { getTripDuration } from "@/modules/travel/components/TripCard";
import { TripRouteMap } from "@/modules/travel/components/TripRouteMap";
import { TripTimeline } from "@/modules/travel/components/TripTimeline";
import { type TravelRoute, type TravelTripDetail, useTravelDetail } from "@/modules/travel/hooks";

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

interface TravelDetailContentProps {
  detail: TravelTripDetail;
  route: TravelRoute;
}

export function TravelDetailContent({ detail, route }: TravelDetailContentProps) {
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
      </div>
    </>
  );
}

interface TravelDetailStateProps {
  detail: TravelTripDetail | null;
  route: TravelRoute | null;
  isLoading: boolean;
  error: string | null;
  notFound: boolean;
  refresh: () => void;
}

function TravelDetailState({
  detail,
  route,
  isLoading,
  error,
  notFound,
  refresh,
}: TravelDetailStateProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail || !route) {
    return (
      <Card className="border-dashed py-12 text-center">
        <CardContent>
          <p className="font-medium">
            {notFound ? "여행을 찾을 수 없습니다" : "여행 상세를 표시할 수 없습니다"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {notFound ? "삭제되었거나 접근할 수 없는 여행입니다." : error}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {!notFound ? (
              <Button onClick={refresh} size="sm" variant="outline">
                다시 시도
              </Button>
            ) : null}
            <Button asChild size="sm" variant={notFound ? "default" : "ghost"}>
              <Link href="/travel">여행 목록</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <TravelDetailContent detail={detail} route={route} />;
}

export default function TravelDetailPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = typeof params.tripId === "string" ? params.tripId : "";
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { detail, route, isLoading, error, notFound, refresh } = useTravelDetail(
    tripId,
    isAuthenticated
  );

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthLoading, isAuthenticated, router]);

  if (isAuthLoading) return <CenteredSpinner />;
  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header showSync={false} />
      <main className="flex-1 container mx-auto px-4 py-6">
        <TravelDetailState
          detail={detail}
          route={route}
          isLoading={isLoading}
          error={error}
          notFound={notFound}
          refresh={refresh}
        />
      </main>
    </div>
  );
}
