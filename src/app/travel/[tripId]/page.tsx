"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/hooks";
import { TravelDetailContent } from "@/modules/travel/components/TravelDetailContent";
import { type TravelRoute, type TravelTripDetail, useTravelDetail } from "@/modules/travel/hooks";

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
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
