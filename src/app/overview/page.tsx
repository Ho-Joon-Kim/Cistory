"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/hooks";
import { resolveComparisonYears } from "@/modules/overview/comparison";
import { AsOfBadge } from "@/modules/overview/components/AsOfBadge";
import { ComputingState } from "@/modules/overview/components/ComputingState";
import { OverviewCards } from "@/modules/overview/components/cards/OverviewCards";
import { OverviewComparison } from "@/modules/overview/components/OverviewComparison";
import { PeriodSwitcher } from "@/modules/overview/components/PeriodSwitcher";
import {
  type OverviewPeriodSelection,
  resolveOverviewPeriod,
  useOverviewNarrative,
  useOverviewSnapshot,
} from "@/modules/overview/hooks";
import { focusOverviewSection } from "@/modules/overview/section-focus";
import type { OverviewSnapshotResponse } from "@/modules/overview/service";
import { shouldShowOverviewFailure } from "@/modules/overview/view-state";
import { SyncStatusProvider } from "@/modules/sync/hooks";

function OverviewResults({
  snapshot,
  error,
  isLoading,
  recompute,
  narrative,
  showNarrative,
}: {
  snapshot: OverviewSnapshotResponse | null;
  error: string | null;
  isLoading: boolean;
  recompute: () => Promise<void>;
  narrative: { content?: string | null; generatedAt?: string | null } | null;
  showNarrative: boolean;
}) {
  if (error) {
    return <ComputingState status="failed" error={error} onRecompute={() => void recompute()} />;
  }
  if (isLoading || !snapshot) return <ComputingState status="loading" />;
  if (snapshot.status === "missing") return <ComputingState status="pending" />;
  if (!("domains" in snapshot)) {
    return <ComputingState status={snapshot.status} />;
  }

  return (
    <>
      {shouldShowOverviewFailure(snapshot) ? (
        <ComputingState
          status="failed"
          error="일부 또는 전체 영역 계산에 실패했습니다."
          onRecompute={() => void recompute()}
        />
      ) : null}
      <OverviewCards payload={snapshot.domains} periodType={snapshot.periodType} />
      {showNarrative && narrative?.content ? (
        <section data-overview-slot="narrative" aria-labelledby="narrative-title">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <CardTitle id="narrative-title" className="text-base">
                회고
              </CardTitle>
              <AsOfBadge computedAt={narrative.generatedAt} />
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm leading-7">
              {narrative.content}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </>
  );
}

function OverviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [initialNow] = useState(() => new Date());
  const rawPeriodType = searchParams.get("periodType");
  const rawPeriodKey = searchParams.get("periodKey");
  const isComparison = searchParams.get("mode") === "comparison";
  const comparisonYears = resolveComparisonYears(
    searchParams.get("year1"),
    searchParams.get("year2"),
    initialNow
  );
  const selection: OverviewPeriodSelection = isComparison
    ? { periodType: "year", periodKey: comparisonYears.year2 }
    : resolveOverviewPeriod(rawPeriodType, rawPeriodKey, initialNow);
  const { snapshot, error, isLoading, recompute } = useOverviewSnapshot(
    selection.periodType,
    selection.periodKey,
    isAuthenticated && !isComparison
  );
  const narrative = useOverviewNarrative(
    selection.periodType,
    selection.periodKey,
    isAuthenticated && !isComparison && snapshot?.status === "ready"
  );

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthLoading, isAuthenticated, router]);

  useEffect(() => {
    const comparisonCanonical =
      !isComparison ||
      (searchParams.get("year1") === comparisonYears.year1 &&
        searchParams.get("year2") === comparisonYears.year2);
    if (
      rawPeriodType === selection.periodType &&
      rawPeriodKey === selection.periodKey &&
      comparisonCanonical
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("periodType", selection.periodType);
    params.set("periodKey", selection.periodKey);
    if (isComparison) {
      params.set("year1", comparisonYears.year1);
      params.set("year2", comparisonYears.year2);
    }
    router.replace(`/overview?${params.toString()}`, { scroll: false });
  }, [
    comparisonYears.year1,
    comparisonYears.year2,
    isComparison,
    rawPeriodKey,
    rawPeriodType,
    router,
    searchParams,
    selection.periodKey,
    selection.periodType,
  ]);

  const changePeriod = useCallback(
    (next: OverviewPeriodSelection) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("periodType", next.periodType);
      params.set("periodKey", next.periodKey);
      router.push(`/overview?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const changeComparisonYears = useCallback(
    (year1: string, year2: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("mode", "comparison");
      params.set("periodType", "year");
      params.set("periodKey", year2);
      params.set("year1", year1);
      params.set("year2", year2);
      router.push(`/overview?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const requestedSection = searchParams.get("section");
  useEffect(() => {
    if (isComparison || requestedSection !== "health" || !snapshot || !("domains" in snapshot)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      focusOverviewSection("health");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isComparison, requestedSection, snapshot]);

  if (isAuthLoading) {
    return (
      <output className="flex min-h-screen items-center justify-center">
        <Loader2 aria-hidden="true" className="size-8 animate-spin text-muted-foreground" />
        <span className="sr-only">로그인 상태 확인 중</span>
      </output>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <SyncStatusProvider>
      <div data-neon className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto space-y-6 px-4 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-mute">
                통합 대시보드
              </p>
              <h1 className="mt-1 text-2xl font-bold">내 흐름 한눈에 보기</h1>
            </div>
            {!isComparison ? (
              <div className="w-full lg:w-[430px]">
                <PeriodSwitcher {...selection} onChange={changePeriod} />
              </div>
            ) : null}
          </div>

          {isComparison ? (
            <OverviewComparison
              {...comparisonYears}
              enabled={isAuthenticated}
              onYearsChange={changeComparisonYears}
            />
          ) : (
            <OverviewResults
              snapshot={snapshot}
              error={error}
              isLoading={isLoading}
              recompute={recompute}
              narrative={narrative}
              showNarrative={selection.periodType !== "recent"}
            />
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}

export default function OverviewPage() {
  return (
    <Suspense
      fallback={
        <output className="flex min-h-screen items-center justify-center">
          <Loader2 aria-hidden="true" className="size-8 animate-spin text-muted-foreground" />
          <span className="sr-only">대시보드 준비 중</span>
        </output>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
