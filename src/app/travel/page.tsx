"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";
import { TravelTripsContent } from "@/modules/travel/components/TravelTripsContent";
import { useTravelTrips } from "@/modules/travel/hooks";

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function TravelPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { trips, isLoading, error, hasMore, loadMore, refresh, markNotTrip, markingTripIds } =
    useTravelTrips(isAuthenticated);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthLoading, isAuthenticated, router]);

  if (isAuthLoading) return <CenteredSpinner />;
  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header showSync={false} />
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">여행</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              위치 기록으로 돌아보는 최근 여행입니다
            </p>
          </div>
          <Button onClick={refresh} disabled={isLoading} size="sm" variant="outline">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            새로고침
          </Button>
        </div>

        <TravelTripsContent
          trips={trips}
          isLoading={isLoading}
          error={error}
          hasMore={hasMore}
          loadMore={loadMore}
          refresh={refresh}
          markNotTrip={markNotTrip}
          markingTripIds={markingTripIds}
        />
      </main>
    </div>
  );
}
