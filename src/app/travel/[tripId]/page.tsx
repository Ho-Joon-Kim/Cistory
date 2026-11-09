"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageContainer } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";
import { TravelDetailView } from "@/modules/travel/components/TravelDetailView";
import { requestMarkNotTrip, requestRenameTrip, useTravelDetail } from "@/modules/travel/hooks";

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

  if (!isAuthLoading && !isAuthenticated) return null;

  const onRename = async (name: string) => {
    try {
      await requestRenameTrip(tripId, name.trim());
      refresh();
      return true;
    } catch (renameError) {
      toast.error(renameError instanceof Error ? renameError.message : "이름을 바꾸지 못했어요");
      return false;
    }
  };

  const onNotTrip = async () => {
    try {
      await requestMarkNotTrip(tripId);
      toast("여행에서 뺐어요. 이 장소는 다음 감지부터 여행으로 보지 않아요.");
      router.push("/travel");
    } catch (markError) {
      toast.error(markError instanceof Error ? markError.message : "여행에서 빼지 못했어요");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <Header />
      <PageContainer>
        {isAuthLoading || isLoading ? (
          <LoadingState variant="kpi" className="mt-4" label="여행 불러오는 중" />
        ) : !detail || !route ? (
          notFound ? (
            <EmptyState
              title="여행을 찾을 수 없어요"
              description="삭제되었거나 여행 아님으로 표시된 여행이에요."
              action={
                <Button asChild variant="outline">
                  <Link href="/travel">모든 여행</Link>
                </Button>
              }
            />
          ) : (
            <ErrorState
              title="여행을 불러오지 못했어요"
              description={error ?? undefined}
              actions={
                <>
                  <Button variant="outline" onClick={refresh}>
                    다시 시도
                  </Button>
                  <Button asChild variant="ghost">
                    <Link href="/travel">모든 여행</Link>
                  </Button>
                </>
              }
            />
          )
        ) : (
          <TravelDetailView
            detail={detail}
            route={route}
            onRename={onRename}
            onNotTrip={() => void onNotTrip()}
          />
        )}
      </PageContainer>
    </div>
  );
}
