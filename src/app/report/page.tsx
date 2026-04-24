"use client";

import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequireAuth } from "@/modules/auth/hooks";
import { ActivityHeatmap } from "@/modules/report/components/ActivityHeatmap";
import { AiCodeRatio } from "@/modules/report/components/AiCodeRatio";
import { CategoryBreakdownChart } from "@/modules/report/components/CategoryBreakdownChart";
import { ContextSwitchingCard } from "@/modules/report/components/ContextSwitchingCard";
import { DeepWorkCard } from "@/modules/report/components/DeepWorkCard";
import { FirstVisitCards } from "@/modules/report/components/FirstVisitCards";
import { NarrativeSection } from "@/modules/report/components/NarrativeSection";
import { OverseasTripCards } from "@/modules/report/components/OverseasTripCards";
import { PlaceProductivityCard } from "@/modules/report/components/PlaceProductivityCard";
import { ScratchMapStats } from "@/modules/report/components/ScratchMapStats";
import { StatCards } from "@/modules/report/components/StatCards";
import { SubwayUsageCard } from "@/modules/report/components/SubwayUsageCard";
import { StreakHighlight } from "@/modules/report/components/StreakHighlight";
import { TopPlaces } from "@/modules/report/components/TopPlaces";
import { WeekdayHourBubble } from "@/modules/report/components/WeekdayHourBubble";
import { WorkLifeBalanceCard } from "@/modules/report/components/WorkLifeBalanceCard";
import { useMonthlyReport, useYearlyReport } from "@/modules/report/hooks";
import { useScratchMap } from "@/modules/report/hooks/useScratchMap";
import type {
  CodingSectionData,
  CrossAnalysisData,
  EnrichedCodingSectionData,
  EnrichedCommitsSectionData,
  LocationSectionData,
  YearlyCodingSectionData,
  YearlyCommitsSectionData,
  YearlyReportData,
} from "@/modules/report/types";
import { SyncStatusProvider } from "@/modules/sync/hooks";

// Dynamic imports for recharts-based components
const CommitChart = dynamic(
  () => import("@/modules/report/components/CommitChart").then((m) => m.CommitChart),
  { ssr: false }
);
const CodingTimeChart = dynamic(
  () => import("@/modules/report/components/CodingTimeChart").then((m) => m.CodingTimeChart),
  { ssr: false }
);
const ProjectDonut = dynamic(
  () => import("@/modules/report/components/ProjectDonut").then((m) => m.ProjectDonut),
  { ssr: false }
);
const LanguagePie = dynamic(
  () => import("@/modules/report/components/LanguagePie").then((m) => m.LanguagePie),
  { ssr: false }
);
const CommitTypeBreakdown = dynamic(
  () =>
    import("@/modules/report/components/CommitTypeBreakdown").then((m) => m.CommitTypeBreakdown),
  { ssr: false }
);
const DistanceChart = dynamic(
  () => import("@/modules/report/components/DistanceChart").then((m) => m.DistanceChart),
  { ssr: false }
);
const MonthlyTrendChart = dynamic(
  () => import("@/modules/report/components/MonthlyTrendChart").then((m) => m.MonthlyTrendChart),
  { ssr: false }
);
const LanguageEvolution = dynamic(
  () => import("@/modules/report/components/LanguageEvolution").then((m) => m.LanguageEvolution),
  { ssr: false }
);
const ProjectTimeline = dynamic(
  () => import("@/modules/report/components/ProjectTimeline").then((m) => m.ProjectTimeline),
  { ssr: false }
);
const LocationHeatmap = dynamic(
  () => import("@/modules/report/components/LocationHeatmap").then((m) => m.LocationHeatmap),
  { ssr: false }
);
const TravelMap = dynamic(
  () => import("@/modules/report/components/TravelMap").then((m) => m.TravelMap),
  { ssr: false }
);
const ScratchMap = dynamic(
  () => import("@/modules/report/components/ScratchMap").then((m) => m.ScratchMap),
  { ssr: false }
);

type ReportType = "monthly" | "yearly";

function ReportContent() {
  const searchParams = useSearchParams();
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();

  const [reportType, setReportType] = useState<ReportType>(
    () => (searchParams.get("type") as ReportType) || "monthly"
  );
  const [period, setPeriod] = useState<string>(
    () => searchParams.get("period") || new Date().toISOString().slice(0, 7)
  );

  // Sync URL
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("type", reportType);
    url.searchParams.set("period", period);
    window.history.replaceState(null, "", url.toString());
  }, [reportType, period]);

  const yearMonth = reportType === "monthly" ? period : null;
  const year = reportType === "yearly" ? period.slice(0, 4) : null;

  const monthly = useMonthlyReport(yearMonth);
  const yearly = useYearlyReport(year);
  const scratchMap = useScratchMap(reportType === "yearly" && year ? Number(year) : undefined);

  // Pick the active report based on type
  const report = reportType === "monthly" ? monthly : yearly;

  const navigate = useCallback(
    (direction: -1 | 1) => {
      if (reportType === "monthly") {
        const [y, m] = period.split("-").map(Number);
        const d = new Date(y, m - 1 + direction, 1);
        setPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      } else {
        setPeriod(String(Number(period.slice(0, 4)) + direction));
      }
    },
    [reportType, period]
  );

  const switchType = useCallback(
    (type: ReportType) => {
      setReportType(type);
      if (type === "yearly") {
        setPeriod(period.slice(0, 4));
      } else {
        const current = new Date().toISOString().slice(0, 7);
        setPeriod(period.length === 4 ? `${period}-01` : current);
      }
    },
    [period]
  );

  const periodLabel = useMemo(() => {
    if (reportType === "monthly") {
      const [y, m] = period.split("-");
      return `${y}년 ${Number(m)}월`;
    }
    return `${period.slice(0, 4)}년`;
  }, [reportType, period]);

  // Yearly monthly trend — computed from all 3 sections
  const monthlyTrend = useMemo(() => {
    if (reportType !== "yearly" || !year) return null;
    const c = yearly.commits.data as YearlyCommitsSectionData | null;
    const co = yearly.coding.data as YearlyCodingSectionData | null;
    const l = yearly.location.data as LocationSectionData | null;
    if (!c || !co || !l) return null;

    const trend: YearlyReportData["monthlyTrend"] = [];
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, "0")}`;
      const monthStart = `${monthStr}-01`;
      const monthEnd =
        m === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;

      const mCommits = c.dailyCommits.filter((d) => d.date >= monthStart && d.date < monthEnd);
      const mCoding = co.dailyCodingSeconds.filter(
        (d) => d.date >= monthStart && d.date < monthEnd
      );
      const mDist = l.dailyDistances.filter((d) => d.date >= monthStart && d.date < monthEnd);

      trend.push({
        month: monthStr,
        commits: mCommits.reduce((s, d) => s + d.count, 0),
        codingSeconds: mCoding.reduce((s, d) => s + d.seconds, 0),
        distanceMeters: mDist.reduce((s, d) => s + d.meters, 0),
        activeDays: mCommits.length,
      });
    }
    return trend;
  }, [reportType, year, yearly.commits.data, yearly.coding.data, yearly.location.data]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const commitsData = report.commits.data;
  const codingData = report.coding.data;
  const locationData = report.location.data;
  const enrichedCommitsData = report.enrichedCommits.data;
  const enrichedCodingData = report.enrichedCoding.data;
  const enrichedLocationData = report.enrichedLocation.data;
  const crossAnalysisData = report.crossAnalysis.data;

  // All sections done loading but no data at all
  const allDone = !report.isLoading;
  const noData = allDone && !report.hasAnyData;

  return (
    <SyncStatusProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Header showSync={false} />

        <main className="flex-1 container mx-auto px-4 py-6 max-w-5xl">
          {/* Period selector */}
          <ReportPeriodSelector
            reportType={reportType}
            periodLabel={periodLabel}
            onSwitchType={switchType}
            onNavigate={navigate}
          />

          {/* No data state */}
          {noData ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <p className="text-muted-foreground">{periodLabel} 데이터가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* AI Narrative */}
              {report.narrative ? (
                <NarrativeSection narrative={report.narrative} />
              ) : (
                <Card>
                  <CardContent className="flex items-center justify-between py-4">
                    <span className="text-sm text-muted-foreground">AI가 작성하는 회고문</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={report.generateNarrative}
                      disabled={report.isGeneratingNarrative || report.isLoading}
                    >
                      {report.isGeneratingNarrative ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {report.isGeneratingNarrative ? "생성 중..." : "회고문 생성"}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Stat Cards — progressively fills in */}
              <StatCards
                commits={commitsData}
                coding={codingData}
                location={locationData}
                sparklines={
                  enrichedCommitsData || enrichedCodingData || enrichedLocationData
                    ? {
                        commits: enrichedCommitsData?.sparklines?.commits,
                        activeDays: enrichedCommitsData?.sparklines?.activeDays,
                        codingTime: enrichedCodingData?.sparklines?.codingTime,
                        distance: enrichedLocationData?.sparklines?.distance,
                      }
                    : undefined
                }
                sameMonthLastYear={
                  enrichedCommitsData?.sameMonthLastYear ||
                  enrichedCodingData?.sameMonthLastYear ||
                  enrichedLocationData?.sameMonthLastYear
                    ? {
                        commits: enrichedCommitsData?.sameMonthLastYear,
                        coding: enrichedCodingData?.sameMonthLastYear,
                        distance: enrichedLocationData?.sameMonthLastYear,
                      }
                    : undefined
                }
              />

              {/* Commits Section */}
              <CommitsSection
                isLoading={report.commits.isLoading}
                commitsData={commitsData}
                enrichedData={enrichedCommitsData}
              />

              {/* Coding Section */}
              <CodingSection
                isLoading={report.coding.isLoading}
                codingData={codingData as CodingSectionData | null}
                enrichedData={enrichedCodingData}
              />

              {/* Location Section */}
              <LocationSection
                isLoading={report.location.isLoading}
                locationData={locationData as LocationSectionData | null}
                crossAnalysisData={crossAnalysisData}
                period={period}
                reportType={reportType}
              />

              {/* Scratch Map (yearly only) */}
              {reportType === "yearly" && scratchMap.data && scratchMap.data.regions.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">방문 지도</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                      <Card>
                        <CardContent className="pt-4">
                          <div className="h-[400px]">
                            <ScratchMap regions={scratchMap.data.regions} />
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                    <div>
                      <ScratchMapStats
                        totalRegions={scratchMap.data.totalRegions}
                        totalCells={scratchMap.data.totalCells}
                        regions={scratchMap.data.regions}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Yearly-only sections */}
              {reportType === "yearly" && (
                <YearlySections
                  monthlyTrend={monthlyTrend}
                  isLoading={report.isLoading}
                  yearlyCommitsData={yearly.commits.data as YearlyCommitsSectionData | null}
                  yearlyCodingData={yearly.coding.data as YearlyCodingSectionData | null}
                  period={period}
                />
              )}

              {report.error && (
                <p className="text-sm text-destructive text-center">{report.error}</p>
              )}
            </div>
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}

export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ReportContent />
    </Suspense>
  );
}

// --- Extracted sub-components ---

function ReportPeriodSelector({
  reportType,
  periodLabel,
  onSwitchType,
  onNavigate,
}: {
  reportType: ReportType;
  periodLabel: string;
  onSwitchType: (type: ReportType) => void;
  onNavigate: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <Button
          variant={reportType === "monthly" ? "default" : "outline"}
          size="sm"
          onClick={() => onSwitchType("monthly")}
        >
          월간
        </Button>
        <Button
          variant={reportType === "yearly" ? "default" : "outline"}
          size="sm"
          onClick={() => onSwitchType("yearly")}
        >
          연간
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/report/comparison">비교</a>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => onNavigate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium text-sm min-w-[100px] text-center">{periodLabel}</span>
        <Button variant="ghost" size="icon" onClick={() => onNavigate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CommitsSection({
  isLoading,
  commitsData,
  enrichedData,
}: {
  isLoading: boolean;
  commitsData: ReturnType<typeof useMonthlyReport>["commits"]["data"];
  enrichedData?: EnrichedCommitsSectionData | null;
}) {
  if (isLoading) return <SectionSkeleton title="커밋 활동" />;
  if (!commitsData) return null;

  return (
    <>
      {commitsData.dailyCommits.length > 0 && (
        <Section title="활동 히트맵">
          <ActivityHeatmap
            dailyCommits={commitsData.dailyCommits}
            startDate={commitsData.dailyCommits[0].date}
            endDate={commitsData.dailyCommits[commitsData.dailyCommits.length - 1].date}
          />
        </Section>
      )}

      <Section title="커밋 활동">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {commitsData.dailyCommits.length > 0 && (
            <ChartCard title="일별 커밋">
              <CommitChart dailyCommits={commitsData.dailyCommits} />
            </ChartCard>
          )}
          {commitsData.projectBreakdown.length > 0 && (
            <ChartCard title="프로젝트별 커밋">
              <ProjectDonut projects={commitsData.projectBreakdown} />
            </ChartCard>
          )}
          {commitsData.commitTypeBreakdown.length > 0 && (
            <ChartCard title="커밋 유형">
              <CommitTypeBreakdown breakdown={commitsData.commitTypeBreakdown} />
            </ChartCard>
          )}
          <ChartCard title="코딩 시간대 패턴">
            <WeekdayHourBubble
              commitsByDayOfWeek={commitsData.commitsByDayOfWeek}
              commitsByHour={commitsData.commitsByHour}
            />
          </ChartCard>
        </div>
        <div className="mt-6">
          <StreakHighlight
            maxStreak={commitsData.maxStreak}
            activeDays={commitsData.activeDays}
            totalDays={commitsData.totalDaysInMonth}
          />
        </div>
        {enrichedData?.workLifeBalance && (
          <div className="mt-6">
            <WorkLifeBalanceCard metrics={enrichedData.workLifeBalance} />
          </div>
        )}
      </Section>
    </>
  );
}

function CodingSection({
  isLoading,
  codingData,
  enrichedData,
}: {
  isLoading: boolean;
  codingData: CodingSectionData | null;
  enrichedData?: EnrichedCodingSectionData | null;
}) {
  if (isLoading) return <SectionSkeleton title="코딩 활동" />;
  if (!codingData) return null;

  return (
    <Section title="코딩 활동">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {codingData.dailyCodingSeconds.length > 0 && (
          <ChartCard title="일별 코딩 시간">
            <CodingTimeChart dailyCodingSeconds={codingData.dailyCodingSeconds} />
          </ChartCard>
        )}
        {codingData.languageBreakdown.length > 0 && (
          <ChartCard title="언어별 코딩 시간">
            <LanguagePie languages={codingData.languageBreakdown} />
          </ChartCard>
        )}
        {(codingData.aiCodeStats.aiLines > 0 || codingData.aiCodeStats.humanLines > 0) && (
          <AiCodeRatio
            aiLines={codingData.aiCodeStats.aiLines}
            humanLines={codingData.aiCodeStats.humanLines}
          />
        )}
        {enrichedData?.categoryBreakdown && enrichedData.categoryBreakdown.length > 0 && (
          <CategoryBreakdownChart categories={enrichedData.categoryBreakdown} />
        )}
      </div>
      {enrichedData && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {enrichedData.deepWorkStats?.totalSessions > 0 && (
            <DeepWorkCard
              sessions={enrichedData.deepWorkSessions}
              stats={enrichedData.deepWorkStats}
            />
          )}
          {enrichedData.contextSwitching && (
            <ContextSwitchingCard metrics={enrichedData.contextSwitching} />
          )}
        </div>
      )}
    </Section>
  );
}

function LocationSection({
  isLoading,
  locationData,
  crossAnalysisData,
  period,
  reportType,
}: {
  isLoading: boolean;
  locationData: LocationSectionData | null;
  crossAnalysisData?: CrossAnalysisData | null;
  period: string;
  reportType: "monthly" | "yearly";
}) {
  if (isLoading) return <SectionSkeleton title="이동/생활" />;
  if (
    !locationData ||
    (locationData.dailyDistances.length === 0 && locationData.topPlaces.length === 0)
  ) {
    return null;
  }

  // Derive YYYY-MM-DD bounds from `period` for the subway-usage card.
  const subwayRange = (() => {
    if (reportType === "monthly") {
      const [y, m] = period.split("-").map(Number);
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { from, to };
    }
    return { from: `${period}-01-01`, to: `${period}-12-31` };
  })();

  return (
    <Section title="이동/생활">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {locationData.dailyDistances.length > 0 && (
          <ChartCard title="일별 이동거리">
            <DistanceChart dailyDistances={locationData.dailyDistances} />
          </ChartCard>
        )}
        {locationData.locationHeatmapPoints.length > 0 && (
          <ChartCard title="활동 히트맵 지도">
            <div className="h-[300px]">
              <LocationHeatmap
                points={locationData.locationHeatmapPoints}
                className="h-full w-full"
              />
            </div>
          </ChartCard>
        )}
      </div>

      {locationData.topPlaces.length > 0 && (
        <div className="mt-6">
          <TopPlaces places={locationData.topPlaces} />
        </div>
      )}

      {crossAnalysisData?.placeProductivity && crossAnalysisData.placeProductivity.length > 0 && (
        <div className="mt-6">
          <PlaceProductivityCard places={crossAnalysisData.placeProductivity} />
        </div>
      )}

      {locationData.overseasTrips.length > 0 && (
        <div className="mt-6 space-y-6">
          <OverseasTripCards trips={locationData.overseasTrips} />
          <ChartCard title="해외여행 지도">
            <div className="h-[400px]">
              <TravelMap
                trips={locationData.overseasTrips}
                topPlaces={locationData.topPlaces}
                className="h-full w-full"
              />
            </div>
          </ChartCard>
        </div>
      )}

      {((locationData.newCities && locationData.newCities.length > 0) ||
        (locationData.newCountries && locationData.newCountries.length > 0)) && (
        <div className="mt-6">
          <FirstVisitCards cities={locationData.newCities} countries={locationData.newCountries} />
        </div>
      )}

      <div className="mt-6">
        <SubwayUsageCard from={subwayRange.from} to={subwayRange.to} />
      </div>
    </Section>
  );
}

function YearlySections({
  monthlyTrend,
  isLoading,
  yearlyCommitsData,
  yearlyCodingData,
  period,
}: {
  monthlyTrend: YearlyReportData["monthlyTrend"] | null;
  isLoading: boolean;
  yearlyCommitsData: YearlyCommitsSectionData | null;
  yearlyCodingData: YearlyCodingSectionData | null;
  period: string;
}) {
  return (
    <>
      {/* Monthly trend — needs all 3 sections */}
      {monthlyTrend ? (
        <Section title="연간 추이">
          <div className="grid grid-cols-1 gap-6">
            {monthlyTrend.length > 0 && (
              <ChartCard title="월별 추이">
                <MonthlyTrendChart monthlyTrend={monthlyTrend} />
              </ChartCard>
            )}
          </div>
        </Section>
      ) : isLoading ? (
        <SectionSkeleton title="연간 추이" />
      ) : null}

      {/* Project timeline — from commits section */}
      {yearlyCommitsData && yearlyCommitsData.projectTimeline?.length > 0 && (
        <Section title="프로젝트 타임라인">
          <ChartCard title="프로젝트 타임라인">
            <ProjectTimeline
              projects={yearlyCommitsData.projectTimeline}
              year={period.slice(0, 4)}
            />
          </ChartCard>
        </Section>
      )}

      {/* Language evolution — from coding section */}
      {yearlyCodingData && yearlyCodingData.quarterlyLanguages?.length > 0 && (
        <Section title="분기별 언어 변화">
          <ChartCard title="분기별 언어 변화">
            <LanguageEvolution quarterlyLanguages={yearlyCodingData.quarterlyLanguages} />
          </ChartCard>
        </Section>
      )}
    </>
  );
}

// --- Shared utility components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-[200px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-[200px] w-full" />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
