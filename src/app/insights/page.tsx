"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/modules/auth/hooks";
import { useInsights } from "@/modules/insights/hooks";
import { Header } from "@/components/Layout/Header";
import { CodingHeatmap } from "@/modules/insights/components/CodingHeatmap";
import { StreakGamification } from "@/modules/insights/components/StreakGamification";
import { WorkPatternCard } from "@/modules/insights/components/WorkPatternCard";
import { ProductivityByLocation } from "@/modules/insights/components/ProductivityByLocation";
import { RoutineDiscovery } from "@/modules/insights/components/RoutineDiscovery";
import { MonthlyDigestCard } from "@/modules/insights/components/MonthlyDigestCard";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

export default function InsightsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const currentYear = new Date().getFullYear();
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : currentYear;

  const { streaks, patterns, routines, digests, commitHeatmap } = useInsights(year);

  // Auth check
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
    <div className="min-h-screen bg-background">
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

        {/* Grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Commit heatmap - full width */}
          <CodingHeatmap
            data={commitHeatmap.data}
            isLoading={commitHeatmap.isLoading}
            year={year}
          />

          {/* Streak gamification */}
          <StreakGamification
            data={streaks.data}
            isLoading={streaks.isLoading}
            year={year}
          />

          {/* Work patterns */}
          <WorkPatternCard
            data={patterns.data}
            isLoading={patterns.isLoading}
          />

          {/* Routine discovery */}
          <RoutineDiscovery
            data={routines.data}
            isLoading={routines.isLoading}
          />

          {/* Productivity by location - placeholder */}
          <ProductivityByLocation />

          {/* Monthly digest - full width */}
          <MonthlyDigestCard
            data={digests.data}
            isLoading={digests.isLoading}
            year={year}
          />
        </div>
      </main>
    </div>
  );
}
