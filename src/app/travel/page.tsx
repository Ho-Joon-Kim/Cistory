"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/hooks";
import { TripCard } from "@/modules/travel/components/TripCard";
import { type TravelTripListItem, useTravelTrips } from "@/modules/travel/hooks";

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

interface TravelTripsContentProps {
  trips: TravelTripListItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function TravelTripsContent({
  trips,
  isLoading,
  error,
  hasMore,
  loadMore,
  refresh,
}: TravelTripsContentProps) {
  if (isLoading && trips.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && trips.length === 0) {
    return (
      <Card className="border-dashed py-12 text-center">
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={refresh} size="sm" variant="outline">
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (trips.length === 0) {
    return (
      <Card className="border-dashed py-12 text-center">
        <CardContent>
          <p className="font-medium">아직 기록된 여행이 없습니다</p>
          <p className="mt-1 text-sm text-muted-foreground">
            여행 감지가 완료되면 최근 여행이 여기에 표시됩니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </div>
      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button onClick={loadMore} disabled={isLoading} variant="outline">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}더 보기
          </Button>
        </div>
      ) : null}
    </>
  );
}

export default function TravelPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { trips, isLoading, error, hasMore, loadMore, refresh } = useTravelTrips(isAuthenticated);

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
        />
      </main>
    </div>
  );
}
