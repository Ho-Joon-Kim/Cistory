"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState, PageContainer, PageTitle } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { toKstCalendarDate } from "@/lib/date-key";
import { useAuth } from "@/modules/auth/hooks";
import { resolveComparisonYears } from "@/modules/overview/comparison";
import { ComputingState } from "@/modules/overview/components/ComputingState";
import { OverviewComparison } from "@/modules/overview/components/OverviewComparison";
import { OverviewView } from "@/modules/overview/components/view/OverviewView";
import { PeriodControls } from "@/modules/overview/components/view/PeriodControls";
import type { HistoryPeriodType } from "@/modules/overview/history";
import {
  type OverviewPeriodSelection,
  resolveOverviewPeriod,
  useOverviewHistory,
  useOverviewSnapshot,
} from "@/modules/overview/hooks";
import { focusOverviewSection } from "@/modules/overview/section-focus";
import { periodContext, periodMeta, periodTitle } from "@/modules/overview/view/labels";
import { buildOverviewModel } from "@/modules/overview/view/model";
import { shouldShowOverviewFailure } from "@/modules/overview/view-state";
import { SyncStatusProvider } from "@/modules/sync/hooks";

/**
 * The redesigned overview offers 주·월·년. A legacy `recent` link (or none at all)
 * lands on the current month.
 */
function resolveSelection(
  rawType: string | null,
  rawKey: string | null,
  now: Date
): { periodType: HistoryPeriodType; periodKey: string } {
  const type = rawType === "week" || rawType === "month" || rawType === "year" ? rawType : "month";
  const selection = resolveOverviewPeriod(type, type === rawType ? rawKey : null, now);
  return selection as { periodType: HistoryPeriodType; periodKey: string };
}

function OverviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [now] = useState(() => new Date());
  const today = toKstCalendarDate(now);
  const rawPeriodType = searchParams.get("periodType");
  const rawPeriodKey = searchParams.get("periodKey");
  const isComparison = searchParams.get("mode") === "comparison";
  const comparisonYears = resolveComparisonYears(
    searchParams.get("year1"),
    searchParams.get("year2"),
    now
  );
  const selection: { periodType: HistoryPeriodType; periodKey: string } = isComparison
    ? { periodType: "year", periodKey: comparisonYears.year2 }
    : resolveSelection(rawPeriodType, rawPeriodKey, now);
  const { snapshot, error, isLoading, recompute } = useOverviewSnapshot(
    selection.periodType,
    selection.periodKey,
    isAuthenticated && !isComparison
  );
  const ready = snapshot && "domains" in snapshot ? snapshot : null;
  const history = useOverviewHistory(
    selection.periodType,
    selection.periodKey,
    isAuthenticated && !isComparison,
    ready?.computedAt ?? null
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
    if (isComparison || requestedSection !== "health" || !ready) return;
    const frame = window.requestAnimationFrame(() => {
      focusOverviewSection("health");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isComparison, requestedSection, ready]);

  const model = useMemo(
    () =>
      ready
        ? buildOverviewModel({
            periodType: selection.periodType,
            periodKey: selection.periodKey,
            computedAt: ready.computedAt,
            domains: ready.domains,
            history,
            today,
            now,
          })
        : null,
    [ready, history, selection.periodType, selection.periodKey, today, now]
  );
  const ctx = periodContext(selection.periodType, selection.periodKey, today, now);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-page">
        <PageContainer>
          <LoadingState label="로그인 상태 확인 중" />
        </PageContainer>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  let body: ReactNode;
  if (isComparison) {
    body = (
      <div className="mt-8">
        <OverviewComparison
          {...comparisonYears}
          enabled={isAuthenticated}
          onYearsChange={changeComparisonYears}
        />
      </div>
    );
  } else if (error) {
    body = (
      <div className="mt-10">
        <ComputingState status="failed" error={error} onRecompute={() => void recompute()} />
      </div>
    );
  } else if (isLoading || !snapshot) {
    body = (
      <div className="mt-10">
        <ComputingState status="loading" />
      </div>
    );
  } else if (!model || !ready) {
    body = (
      <div className="mt-10">
        <ComputingState status={snapshot.status === "computing" ? "computing" : "pending"} />
      </div>
    );
  } else {
    body = (
      <>
        {shouldShowOverviewFailure(ready) ? (
          <div className="mt-8">
            <ComputingState
              status="failed"
              error="일부 영역을 계산하지 못했어요. 다시 계산을 요청해 주세요."
              onRecompute={() => void recompute()}
            />
          </div>
        ) : null}
        <OverviewView key={`${selection.periodType}:${selection.periodKey}`} model={model} />
      </>
    );
  }

  return (
    <SyncStatusProvider>
      <div className="min-h-screen bg-page text-ink">
        <Header />
        <PageContainer>
          <PageTitle
            className="ds-enter"
            title={isComparison ? "연간 비교" : periodTitle(ctx)}
            meta={isComparison ? null : periodMeta(ctx, ready?.computedAt ?? null)}
            actions={
              isComparison ? null : (
                <PeriodControls
                  periodType={selection.periodType}
                  periodKey={selection.periodKey}
                  onChange={changePeriod}
                  now={now}
                />
              )
            }
          />
          {body}
        </PageContainer>
      </div>
    </SyncStatusProvider>
  );
}

export default function OverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-page">
          <PageContainer>
            <LoadingState label="개요 준비 중" />
          </PageContainer>
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
