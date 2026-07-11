"use client";

import { Activity, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { useAuth } from "@/modules/auth/hooks";
import { HealthTrendCard } from "@/modules/health/components/HealthTrendCard";
import { WorkoutList } from "@/modules/health/components/WorkoutList";
import { type HealthSummary, useHealthSummary } from "@/modules/health/hooks";

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function NeverConnected({ onGoSettings }: { onGoSettings: () => void }) {
  return (
    <div className="border-2 border-dashed rounded-lg p-12 text-center">
      <Activity className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
      <p className="text-muted-foreground mb-1">아직 건강 데이터가 연동되지 않았습니다</p>
      <p className="text-xs text-muted-foreground mb-4">
        Google Health(Fitbit)를 연결하면 걸음·심박·산소포화도 추이를 볼 수 있어요
      </p>
      <Button onClick={onGoSettings} variant="outline">
        설정에서 연동하기
      </Button>
    </div>
  );
}

function ReauthBanner({ onGoSettings }: { onGoSettings: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
      <div className="flex-1 text-sm">
        <p className="font-medium">연동이 만료되었습니다</p>
        <p className="text-muted-foreground">다시 연동해야 새 데이터를 가져올 수 있어요.</p>
      </div>
      <Button size="sm" variant="outline" onClick={onGoSettings}>
        다시 연동
      </Button>
    </div>
  );
}

function DisconnectedHistoryBanner({ onGoSettings }: { onGoSettings: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
      <div className="flex-1 text-sm">
        <p className="font-medium">연동 해제됨 · 과거 데이터 유지</p>
        <p className="text-muted-foreground">
          연동은 해제되었지만 이전에 수집한 데이터는 그대로 보관되어 있어요.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onGoSettings}>
        다시 연동
      </Button>
    </div>
  );
}

function BackfillingNotice() {
  return (
    <div className="border-2 border-dashed rounded-lg p-12 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
      <p className="text-muted-foreground mb-1">동기화 중 · 과거 데이터 백필 진행 중</p>
      <p className="text-xs text-muted-foreground">
        처음 연동 후 과거 기록을 가져오고 있어요. 잠시 후 추이가 채워집니다.
      </p>
    </div>
  );
}

function HealthBody({ summary }: { summary: HealthSummary }) {
  const router = useRouter();
  const goSettings = () => router.push("/settings");

  if (!summary.hasConnection && !summary.hasAnyHistory) {
    return <NeverConnected onGoSettings={goSettings} />;
  }

  const backfilling = summary.hasConnection && !summary.backfillCompletedAt;
  const showBackfillingOnly = backfilling && !summary.hasAnyHistory;

  return (
    <div className="space-y-4">
      {summary.status === "needs_reauth" ? <ReauthBanner onGoSettings={goSettings} /> : null}
      {!summary.hasConnection && summary.hasAnyHistory ? (
        <DisconnectedHistoryBanner onGoSettings={goSettings} />
      ) : null}

      {showBackfillingOnly ? (
        <BackfillingNotice />
      ) : (
        <>
          {backfilling ? (
            <p className="text-xs text-muted-foreground">과거 데이터 백필이 아직 진행 중입니다.</p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.metrics.map((m) => (
              <HealthTrendCard key={m.key} series={m} />
            ))}
          </div>
          <WorkoutList workouts={summary.workouts} />
        </>
      )}
    </div>
  );
}

export default function HealthPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { summary, isLoading, refresh } = useHealthSummary();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  if (isAuthLoading) return <CenteredSpinner />;
  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header showSync={false} />
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">건강</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {summary?.lastSyncedAt
                ? `최근 동기화 ${formatRelativeTime(summary.lastSyncedAt)}`
                : "걸음·심박·산소포화도 등 일일 건강 추이"}
            </p>
          </div>
          <Button onClick={refresh} disabled={isLoading} size="sm" variant="outline">
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            새로고침
          </Button>
        </div>

        {isLoading && !summary ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : summary ? (
          <HealthBody summary={summary} />
        ) : (
          <p className="text-sm text-muted-foreground">불러오지 못했습니다.</p>
        )}
      </main>
    </div>
  );
}
