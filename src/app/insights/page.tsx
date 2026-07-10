"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";
// New cards (insights redesign)
import { AIClockCard } from "@/modules/insights/components/AIClockCard";
import { BodyCard } from "@/modules/insights/components/BodyCard";
import { CodingHeatmap } from "@/modules/insights/components/CodingHeatmap";
import { CommuteReliabilityCard } from "@/modules/insights/components/CommuteReliabilityCard";
import { DataUsageCard } from "@/modules/insights/components/DataUsageCard";
import { DiscoveriesCard } from "@/modules/insights/components/DiscoveriesCard";
import { HeroSwimlane } from "@/modules/insights/components/HeroSwimlane";
import { MonthlyDigestCard } from "@/modules/insights/components/MonthlyDigestCard";
import { NetSpendCard } from "@/modules/insights/components/NetSpendCard";
import { PlaceProductivityCard } from "@/modules/insights/components/PlaceProductivityCard";
import { RepoSplitCard } from "@/modules/insights/components/RepoSplitCard";
import { RoutineDiscovery } from "@/modules/insights/components/RoutineDiscovery";
import { StreakGamification } from "@/modules/insights/components/StreakGamification";
import { SubwayInsightsCard } from "@/modules/insights/components/SubwayInsightsCard";
import { TransportModeCard } from "@/modules/insights/components/TransportModeCard";
import { TripsCard } from "@/modules/insights/components/TripsCard";
import { VisitsXCommitsCard } from "@/modules/insights/components/VisitsXCommitsCard";
import { WorkPatternCard } from "@/modules/insights/components/WorkPatternCard";
import { useInsights } from "@/modules/insights/hooks";
import { SyncStatusProvider } from "@/modules/sync/hooks";

function SectionDivider({
  label,
  subtitle,
  tone,
}: {
  label: string;
  subtitle?: string;
  tone?: "primary";
}) {
  return (
    <div className="flex items-baseline gap-3 px-1 pt-3">
      <div
        className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
          tone === "primary" ? "glow-text-green" : "text-ink-mute"
        }`}
      >
        {tone === "primary" ? "✦ " : ""}
        {label}
      </div>
      <div className="flex-1 h-px bg-[hsl(var(--hairline))]" />
      {subtitle ? <div className="text-[11px] text-ink-mute">{subtitle}</div> : null}
    </div>
  );
}

function InsightsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const currentYear = new Date().getFullYear();
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : currentYear;

  const {
    streaks,
    patterns,
    routines,
    digests,
    commitHeatmap,
    subway,
    swimlane,
    aiClock,
    commute,
    placeProductivity,
    trips,
    transport,
    visitsXCommits,
    netSpend,
    repoSplit,
    dataUsage,
    discoveries,
    body,
  } = useInsights(year);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  const handleYearChange = (newYear: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(newYear));
    router.push(`/insights?${params.toString()}`);
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SyncStatusProvider>
      {/* data-neon scopes the insights-redesign tokens & utilities (see globals.patch.css) */}
      <div data-neon className="min-h-screen bg-background">
        <Header />

        <main className="container mx-auto px-4 py-6">
          {/* Year selector */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h1 className="text-2xl font-bold">인사이트</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleYearChange(year - 1)}
                disabled={year <= 2020}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-lg font-semibold min-w-[60px] text-center">{year}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleYearChange(year + 1)}
                disabled={year >= currentYear}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Layout — content-aware: only Hero / Heatmap / Monthly are full-width.
              Everything else is a clean 2-col grid. Schema groups stay intact via order. */}
          <div className="flex flex-col gap-4">
            {/* Hero — full width (year overview swimlane) */}
            <HeroSwimlane data={swimlane.data} isLoading={swimlane.isLoading} year={year} />

            {/* CODING — AI clock + Work pattern */}
            <SectionDivider label="코딩" tone="primary" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AIClockCard data={aiClock.data} isLoading={aiClock.isLoading} />
              <WorkPatternCard data={patterns.data} isLoading={patterns.isLoading} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RepoSplitCard data={repoSplit.data} isLoading={repoSplit.isLoading} />
              <StreakGamification data={streaks.data} isLoading={streaks.isLoading} year={year} />
            </div>

            {/* Heatmap — full width (only chart that genuinely needs 12 months horizontally) */}
            <CodingHeatmap
              data={commitHeatmap.data}
              isLoading={commitHeatmap.isLoading}
              year={year}
            />

            {/* LOCATION — visits, transport, trips */}
            <SectionDivider label="위치 · 이동" tone="primary" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PlaceProductivityCard
                data={placeProductivity.data}
                isLoading={placeProductivity.isLoading}
              />
              <VisitsXCommitsCard data={visitsXCommits.data} isLoading={visitsXCommits.isLoading} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TransportModeCard data={transport.data} isLoading={transport.isLoading} />
              <SubwayInsightsCard data={subway.data} isLoading={subway.isLoading} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CommuteReliabilityCard data={commute.data} isLoading={commute.isLoading} />
              <TripsCard data={trips.data} isLoading={trips.isLoading} year={year} />
            </div>

            {/* SPENDING + META */}
            <SectionDivider label="소비 · 메타" tone="primary" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NetSpendCard data={netSpend.data} isLoading={netSpend.isLoading} />
              <DataUsageCard data={dataUsage.data} isLoading={dataUsage.isLoading} />
            </div>

            {/* DISCOVERIES + ROUTINE — narrative pair */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DiscoveriesCard data={discoveries.data} isLoading={discoveries.isLoading} />
              <RoutineDiscovery data={routines.data} isLoading={routines.isLoading} />
            </div>

            {/* HEALTH — 체성분 (Withings) */}
            <SectionDivider label="건강" tone="primary" />
            <BodyCard data={body.data} isLoading={body.isLoading} />

            {/* Monthly digest — full-width strip (12 months × 4 cols) */}
            <MonthlyDigestCard data={digests.data} isLoading={digests.isLoading} year={year} />
          </div>
        </main>
      </div>
    </SyncStatusProvider>
  );
}

export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InsightsContent />
    </Suspense>
  );
}
