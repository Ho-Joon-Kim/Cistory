"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useMemo } from "react";
import { EmptyState, ErrorState, LoadingState, PageContainer, PageTitle } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { formatDateTime, formatDay, formatRelative } from "@/lib/format";
import { GENERIC_ERROR_MESSAGE, sameErrorCopy } from "@/lib/user-error";
import { useAuth } from "@/modules/auth/hooks";
import { ActivitySection } from "@/modules/health/components/ActivitySection";
import { DetailsSheet } from "@/modules/health/components/DetailsSheet";
import { HeartRhythmCard } from "@/modules/health/components/HeartRhythmCard";
import { HeroRow } from "@/modules/health/components/HeroRow";
import { WorkoutsSection } from "@/modules/health/components/WorkoutsSection";
import {
  type HealthSummary,
  useActivityCorrelation,
  useBody,
  useHealthSummary,
} from "@/modules/health/hooks";
import { activityWindow, detailRows, kstToday } from "@/modules/health/view-model";

/** Staged entrance: `ds-enter` (reduced motion → fade) with 100ms steps. */
const delay = (step: number): CSSProperties => ({ animationDelay: `${step * 100}ms` });

function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 cursor-pointer items-center rounded-[9px] border-0 bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-ring transition-[scale,box-shadow] duration-150 ease-out hover:shadow-ring-hover active:scale-[.96] focus-visible:outline-2 focus-visible:outline-brand"
    >
      {children}
    </button>
  );
}

function Notice({
  tone = "neutral",
  title,
  description,
  action,
}: {
  tone?: "warn" | "neutral";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "warn" ? "status" : undefined}
      className={`mt-6 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ${tone === "warn" ? "bg-warn-soft" : "bg-sunken"}`}
    >
      <div className="min-w-0 flex-1 text-sm leading-[1.375rem]">
        <p className={`m-0 font-semibold ${tone === "warn" ? "text-warn" : "text-ink"}`}>{title}</p>
        <p className="m-0 text-ink-2">{description}</p>
      </div>
      {action}
    </div>
  );
}

type BodyQuery = ReturnType<typeof useBody>;
type CorrelationQuery = ReturnType<typeof useActivityCorrelation>;

function HealthBody({
  summary,
  body,
  correlation,
}: {
  summary: HealthSummary;
  body: BodyQuery;
  correlation: CorrelationQuery;
}) {
  const router = useRouter();
  const goSettings = () => router.push("/settings");
  const today = kstToday();
  const win = useMemo(
    () => activityWindow(today, summary.lastSyncedAt),
    [today, summary.lastSyncedAt]
  );
  const rows = useMemo(() => detailRows(summary.metrics, win.days), [summary.metrics, win]);

  if (!summary.hasConnection && !summary.hasAnyHistory) {
    return (
      <EmptyState
        className="mt-8 border-t border-line pt-8"
        title="아직 건강 데이터가 연결되지 않았어요"
        description="Google Health (Fitbit)를 연결하면 수면·심박·걸음 추이를 볼 수 있어요."
        action={<Button onClick={goSettings}>설정에서 연결하기</Button>}
      />
    );
  }

  const backfilling = summary.hasConnection && !summary.backfillCompletedAt;
  const rhr = summary.metrics.find((m) => m.key === "resting_heart_rate");

  return (
    <>
      {summary.status === "needs_reauth" ? (
        <Notice
          tone="warn"
          title="Google Health (Fitbit) 다시 연결 필요"
          description="다시 연결해야 새 데이터를 가져올 수 있어요."
          action={<Button onClick={goSettings}>다시 연결</Button>}
        />
      ) : null}
      {!summary.hasConnection && summary.hasAnyHistory ? (
        <Notice
          title="연결 해제됨 · 과거 데이터 유지"
          description="연결은 해제되었지만 이전에 수집한 데이터는 그대로 보관되어 있어요."
          action={<Button onClick={goSettings}>다시 연결</Button>}
        />
      ) : null}
      {backfilling ? (
        <Notice
          title={
            summary.hasAnyHistory
              ? "과거 데이터를 아직 처리하고 있어요"
              : "동기화 중 · 과거 데이터 처리 중"
          }
          description="처음 연결 후 과거 기록을 가져오고 있어요. 잠시 후 추이가 채워져요."
        />
      ) : null}

      <HeroRow
        className="ds-enter mt-6 lg:mt-8"
        style={delay(1)}
        sessions={summary.sleepSessions}
        rhr={rhr}
        days={win.days}
        today={today}
        body={body.data}
        bodyLoading={body.isLoading}
        bodyError={body.error}
        onBodyRetry={body.refresh}
      />
      <ActivitySection
        className="ds-enter mt-10 lg:mt-16"
        style={delay(2)}
        metrics={summary.metrics}
        win={win}
        correlation={correlation.days}
        lastSyncedAt={summary.lastSyncedAt}
      />
      <WorkoutsSection
        className="ds-enter mt-11 lg:mt-[72px]"
        style={delay(3)}
        workouts={summary.workouts}
      />
      {summary.rhythm ? (
        <HeartRhythmCard
          className="ds-enter mt-11 lg:mt-[72px]"
          style={delay(4)}
          rhythm={summary.rhythm}
        />
      ) : null}
      <DetailsSheet
        className="ds-enter mt-8 border-t border-line pt-1 lg:mt-14 lg:pt-2"
        style={delay(4)}
        rows={rows}
        body={body.data}
      />
    </>
  );
}

function Meta({
  summary,
  measuredAt,
}: {
  summary: HealthSummary | null;
  measuredAt: string | null;
}) {
  return (
    <>
      <span className="text-[0.8125rem] leading-5 sm:text-sm sm:leading-[1.375rem]">
        {formatDay(kstToday())}
        {summary?.lastSyncedAt ? ` · Fitbit ${formatRelative(summary.lastSyncedAt)} 동기화` : ""}
      </span>
      {measuredAt ? (
        <span className="block text-[0.8125rem] leading-5 sm:inline sm:text-sm sm:leading-[1.375rem]">
          <span className="hidden sm:inline"> · </span>
          Withings {formatDateTime(new Date(measuredAt))} 측정
        </span>
      ) : null}
    </>
  );
}

const LOAD_ERROR_TITLE = "건강 데이터를 불러오지 못했어요";

export default function HealthPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { summary, isLoading, error, refresh } = useHealthSummary();
  const body = useBody();
  // Started with the summary rather than inside HealthBody, which only mounts once
  // the summary has landed — that chained the two requests.
  const correlation = useActivityCorrelation();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  if (!isAuthLoading && !isAuthenticated) return null;

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <Header />
      <PageContainer>
        <div className="ds-enter">
          <PageTitle
            title="건강"
            meta={<Meta summary={summary} measuredAt={body.data?.latestMeasuredAt ?? null} />}
          />
        </div>
        {isAuthLoading || (isLoading && !summary) ? (
          <LoadingState className="mt-8" label="건강 데이터를 불러오는 중" />
        ) : summary ? (
          <>
            {error ? (
              <p role="alert" className="mt-4 text-sm text-danger">
                새 데이터를 불러오지 못했어요. 잠시 후 자동으로 다시 시도해요.
              </p>
            ) : null}
            <HealthBody summary={summary} body={body} correlation={correlation} />
          </>
        ) : (
          <ErrorState
            className="mt-8"
            title={LOAD_ERROR_TITLE}
            description={
              error && !sameErrorCopy(error, LOAD_ERROR_TITLE) ? error : GENERIC_ERROR_MESSAGE
            }
            actions={<Button onClick={refresh}>다시 시도</Button>}
          />
        )}
      </PageContainer>
    </div>
  );
}
