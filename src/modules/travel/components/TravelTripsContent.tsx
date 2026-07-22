import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TravelTripListItem } from "../hooks";
import { TripCard } from "./TripCard";

interface TravelTripsContentProps {
  trips: TravelTripListItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  markNotTrip: (tripId: string) => Promise<boolean>;
  markingTripIds: ReadonlySet<string>;
}

export function TravelTripsContent({
  trips,
  isLoading,
  error,
  hasMore,
  loadMore,
  refresh,
  markNotTrip,
  markingTripIds,
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
          <TripCard
            key={trip.id}
            trip={trip}
            onMarkNotTrip={markNotTrip}
            isMarkingNotTrip={markingTripIds.has(trip.id)}
          />
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
