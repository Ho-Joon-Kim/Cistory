"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";
import { AccountAllocationChart } from "@/modules/portfolio/components/AccountAllocationChart";
import { AccountHoldingsTable } from "@/modules/portfolio/components/AccountHoldingsTable";
import { AssetTimelineChart } from "@/modules/portfolio/components/AssetTimelineChart";
import { CategoryBreakdown } from "@/modules/portfolio/components/CategoryBreakdown";
import { HoldingWeightList } from "@/modules/portfolio/components/HoldingWeightList";
import { PortfolioOverviewCard } from "@/modules/portfolio/components/PortfolioOverviewCard";
import { RecentExecutionsCard } from "@/modules/portfolio/components/RecentExecutionsCard";
import { syncAllAccounts, usePortfolioSummary } from "@/modules/portfolio/hooks";
import { SyncStatusProvider } from "@/modules/sync/hooks";

function PortfolioContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { summary, isLoading, refresh } = usePortfolioSummary();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncAllAccounts();
      if (r.ok) {
        toast.success("동기화 완료");
        refresh();
      } else {
        toast.error("동기화 실패");
      }
    } finally {
      setSyncing(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const accountAllocations =
    summary?.accounts
      .map((a) => {
        const snap = summary.latestSnapshots.find((s) => s.accountId === a.id);
        return snap
          ? {
              accountId: a.id,
              label: a.label,
              accountType: a.accountType,
              totalEvalAmount: snap.totalEvalAmount,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null) ?? [];

  return (
    <SyncStatusProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Header showSync={false} />

        <main className="flex-1 container mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">포트폴리오</h1>
              <p className="text-sm text-muted-foreground mt-1">
                한국투자증권 보유 종목과 자산 변동을 보여줍니다
              </p>
            </div>
            <Button onClick={handleSync} disabled={syncing} size="sm" variant="outline">
              {syncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              지금 동기화
            </Button>
          </div>

          {isLoading && !summary ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !summary || summary.accounts.length === 0 ? (
            <div className="border-2 border-dashed rounded-lg p-12 text-center">
              <p className="text-muted-foreground mb-4">아직 등록된 계좌가 없습니다</p>
              <Button onClick={() => router.push("/dashboard/settings")} variant="outline">
                설정에서 계좌 추가하기
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PortfolioOverviewCard
                  totalEval={summary.totals?.totalEvalAmount ?? 0}
                  deposit={summary.totals?.totalDeposit ?? 0}
                  pnl={summary.totals?.totalPnl ?? 0}
                  pnlRate={summary.totals?.totalPnlRate ?? 0}
                  prevDayTotalAsset={summary.totals?.prevDayTotalAsset ?? null}
                  assetIcdc={summary.totals?.assetIcdcAmt ?? null}
                  accountCount={summary.accounts.length}
                  positionCount={summary.positions.length}
                />
                <AccountAllocationChart accounts={accountAllocations} />
              </div>

              <AssetTimelineChart />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <HoldingWeightList positions={summary.positions} />
                <CategoryBreakdown positions={summary.positions} />
              </div>

              <AccountHoldingsTable
                accounts={summary.accounts}
                snapshots={summary.latestSnapshots}
                positions={summary.positions}
              />

              <RecentExecutionsCard limit={15} />
            </div>
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PortfolioContent />
    </Suspense>
  );
}
