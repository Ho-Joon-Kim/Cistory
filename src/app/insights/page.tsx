"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";
// New cards (insights redesign)
import { AIClockCard } from "@/modules/insights/components/AIClockCard";
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
          <div className="flex items-center justify-between mb-6">
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

          {/* Mockup-faithful layout — weighted columns, schema grouping, section dividers.
              Row sizes match planned/components_v2/app.jsx. */}
          <div className="flex flex-col gap-4">
            {/* Hero — full width */}
            <HeroSwimlane data={swimlane.data} isLoading={swimlane.isLoading} year={year} />

            {/* Cross-stream row 1: place × productivity (wider) + commute reliability */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
              <PlaceProductivityCard
                data={placeProductivity.data}
                isLoading={placeProductivity.isLoading}
              />
              <CommuteReliabilityCard data={commute.data} isLoading={commute.isLoading} />
            </div>

            {/* Cross-stream row 2: net spend (wider) + subway */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
              <NetSpendCard data={netSpend.data} isLoading={netSpend.isLoading} />
              <SubwayInsightsCard data={subway.data} isLoading={subway.isLoading} />
            </div>

            {/* Discoveries — narrative bullets, full width */}
            <DiscoveriesCard data={discoveries.data} isLoading={discoveries.isLoading} />

            {/* Section divider — Schema-Grounded */}
            <SectionDivider label="Schema-Grounded" subtitle="실제 DB 스키마 기반" tone="primary" />

            {/* AI clock — full width, the most important coding card */}
            <AIClockCard data={aiClock.data} isLoading={aiClock.isLoading} />

            {/* Mobility row — transport modes + trips */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TransportModeCard data={transport.data} isLoading={transport.isLoading} />
              <TripsCard data={trips.data} isLoading={trips.isLoading} year={year} />
            </div>

            {/* Place × commits + Repo split */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
              <VisitsXCommitsCard data={visitsXCommits.data} isLoading={visitsXCommits.isLoading} />
              <RepoSplitCard data={repoSplit.data} isLoading={repoSplit.isLoading} />
            </div>

            {/* Data usage — meta row, full width */}
            <DataUsageCard data={dataUsage.data} isLoading={dataUsage.isLoading} />

            {/* Section divider — basic patterns */}
            <SectionDivider label="기본 패턴" />

            {/* Refined trio — heatmap (full) then streak / work pattern / routine */}
            <CodingHeatmap
              data={commitHeatmap.data}
              isLoading={commitHeatmap.isLoading}
              year={year}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <StreakGamification data={streaks.data} isLoading={streaks.isLoading} year={year} />
              <WorkPatternCard data={patterns.data} isLoading={patterns.isLoading} />
              <RoutineDiscovery data={routines.data} isLoading={routines.isLoading} />
            </div>

            {/* Monthly digest — full-width strip */}
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
