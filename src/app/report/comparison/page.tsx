"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequireAuth } from "@/modules/auth/hooks";
import { YearComparisonDashboard } from "@/modules/report/components/YearComparisonDashboard";
import { useYearComparison } from "@/modules/report/hooks";
import { SyncStatusProvider } from "@/modules/sync/hooks";

const ComparisonChart = dynamic(
  () => import("@/modules/report/components/ComparisonChart").then((m) => m.ComparisonChart),
  { ssr: false }
);

const currentYear = new Date().getFullYear();

function ComparisonContent() {
  const [year1, setYear1] = useState(String(currentYear - 1));
  const [year2, setYear2] = useState(String(currentYear));
  const { data, isLoading, error } = useYearComparison(year1, year2);

  const adjustYear = (which: "year1" | "year2", delta: number) => {
    if (which === "year1") {
      const next = Number(year1) + delta;
      if (next >= 2020 && next < Number(year2)) setYear1(String(next));
    } else {
      const next = Number(year2) + delta;
      if (next > Number(year1) && next <= currentYear) setYear2(String(next));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Year selectors */}
      <div className="flex items-center justify-center gap-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => adjustYear("year1", -1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold w-16 text-center">{year1}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => adjustYear("year1", 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <span className="text-muted-foreground font-medium">vs</span>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => adjustYear("year2", -1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold w-16 text-center">{year2}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => adjustYear("year2", 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-lg" />
        </div>
      )}

      {/* Error */}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      {/* Data */}
      {data && !isLoading && (
        <div className="space-y-6">
          <YearComparisonDashboard data={data} />
          <ComparisonChart data={data} />
        </div>
      )}

      {/* No data */}
      {!data && !isLoading && !error && (
        <p className="text-center text-sm text-muted-foreground">
          연도를 선택하면 비교 데이터가 표시됩니다.
        </p>
      )}
    </div>
  );
}

export default function ComparisonPage() {
  useRequireAuth();

  return (
    <SyncStatusProvider>
      <div className="min-h-screen bg-background">
        <Header />
        <ComparisonContent />
      </div>
    </SyncStatusProvider>
  );
}
