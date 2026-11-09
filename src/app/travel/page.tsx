"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { LoadingState, PageContainer, PageTitle } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { toKstCalendarDate } from "@/lib/date-key";
import { useAuth } from "@/modules/auth/hooks";
import { enter } from "@/modules/travel/components/parts";
import { TravelListView } from "@/modules/travel/components/TravelListView";
import { useTravelTrips } from "@/modules/travel/hooks";

export default function TravelPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const travel = useTravelTrips(isAuthenticated);
  const today = useMemo(() => toKstCalendarDate(new Date()), []);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthLoading, isAuthenticated, router]);

  if (!isAuthLoading && !isAuthenticated) return null;

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <Header />
      <PageContainer>
        <div {...enter(0)}>
          <PageTitle
            title="여행"
            meta={
              <>
                위치 기록에서 자동으로 찾은 여행
                {travel.trips.length > 0 ? ` · 최근 ${travel.trips.length}건` : ""}
              </>
            }
          />
        </div>
        {isAuthLoading ? (
          <LoadingState variant="rows" rows={6} className="mt-10" />
        ) : (
          <TravelListView
            trips={travel.trips}
            summary={travel.summary}
            today={today}
            isLoading={travel.isLoading}
            error={travel.error}
            hasMore={travel.hasMore}
            loadMore={travel.loadMore}
            refresh={travel.refresh}
            scheduleNotTrip={travel.scheduleNotTrip}
            undoNotTrip={travel.undoNotTrip}
            renameTrip={travel.renameTrip}
          />
        )}
      </PageContainer>
    </div>
  );
}
