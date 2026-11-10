"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  EvidenceScope,
  LoadingState,
  MetaLine,
  PageContainer,
  PageTitle,
  Segmented,
} from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { toKstCalendarDate } from "@/lib/date-key";
import { pickOne } from "@/lib/facts/pick";
import { formatCount, formatDateRange, formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type SpendingCategoryKey,
} from "@/modules/spending/categories";
import { BulkPanels } from "@/modules/spending/components/BulkPanels";
import { CashFlow } from "@/modules/spending/components/CashFlow";
import { CategoryPanel } from "@/modules/spending/components/CategoryPanel";
import { Ledger, type LedgerActions } from "@/modules/spending/components/Ledger";
import { MonthlyChart } from "@/modules/spending/components/MonthlyChart";
import { NotificationList } from "@/modules/spending/components/NotificationList";
import { BlockTitle, enter, SectionTitle } from "@/modules/spending/components/parts";
import {
  type CompareMode,
  SpendingHero,
  SpendingHeroSkeleton,
} from "@/modules/spending/components/SpendingHero";
import {
  useDeleteTransaction,
  useNotificationLogs,
  useSpendingTrend,
  useTransactions,
  useUpdateTransactionCategory,
  useUpdateTransactionOverride,
} from "@/modules/spending/hooks";
import {
  averageBaseline,
  chartSplitFact,
  type FlagContext,
  groupLedger,
  type HeroModel,
  heroPaceFact,
  LEDGER_PERIODS,
  type LedgerPeriod,
  monthAnnotations,
  monthMaxCharge,
  periodRange,
  previousMonth,
  SPLIT_CATEGORY,
  sameDayRefs,
  toMonthBars,
  topMerchantFact,
  txDayKey,
} from "@/modules/spending/view-model";

type Tab = "ledger" | "raw";

/** Days of the ledger shown before "더 보기", and how many each press adds. */
const FIRST_DAYS = 3;
const MORE_DAYS = 7;

function MoreButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 h-11 w-full cursor-pointer rounded-[10px] border-0 bg-sunken text-sm font-semibold text-ink transition-[scale,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand active:scale-[0.98] [@media(hover:hover)]:hover:bg-track"
    >
      {children}
    </button>
  );
}

/** Switches the ledger to the raw Toss notifications — a quiet control, not a heading. */
function ViewToggle({
  raw,
  onToggle,
  className,
}: {
  raw: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={raw}
      aria-controls={raw ? "spending-panel-raw" : "spending-panel-ledger"}
      onClick={onToggle}
      className={cn(
        "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] border-0 bg-transparent px-2.5 text-[0.8125rem] font-semibold text-ink-2 transition-[scale,background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand active:scale-[.96] sm:h-9 [@media(hover:hover)]:hover:bg-track [@media(hover:hover)]:hover:text-ink",
        className
      )}
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {raw ? (
          <path d="M15 18l-6-6 6-6" />
        ) : (
          <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
          </>
        )}
      </svg>
      {raw ? "거래 내역" : "원본 알림"}
    </button>
  );
}

export default function SpendingPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const today = toKstCalendarDate(new Date());
  const monthFrom = `${today.slice(0, 7)}-01`;

  const trend = useSpendingTrend(isAuthenticated);
  const month = useTransactions({
    filters: { from: monthFrom, to: today, bucket: "spending" },
    perPage: 200,
    enabled: isAuthenticated,
  });
  const latest = useNotificationLogs({ perPage: 1, enabled: isAuthenticated });

  const [mode, setMode] = useState<CompareMode>("all");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ledger");
  const [period, setPeriod] = useState<LedgerPeriod>("month");
  const [shownDays, setShownDays] = useState(FIRST_DAYS);
  const range = periodRange(period, today);

  const ledger = useTransactions({ filters: range, perPage: 100, enabled: isAuthenticated });
  const logs = useNotificationLogs({
    filters: range,
    enabled: isAuthenticated && tab === "raw",
  });

  const { deleteTransaction } = useDeleteTransaction();
  const { updateOverride } = useUpdateTransactionOverride();
  const { updateCategory } = useUpdateTransactionCategory();

  const data = trend.data;
  const bars = useMemo(() => (data ? toMonthBars(data) : []), [data]);
  const current = bars.find((b) => b.isCurrent);
  const average = useMemo(() => averageBaseline(bars), [bars]);
  const threshold = data?.forecast.oneOffThreshold ?? null;

  const hero: HeroModel | null = useMemo(() => {
    if (!data) return null;
    const total = data.forecast.currentMonthActualTotal;
    const health = current?.health ?? 0;
    const counts = month.summary.categoryBreakdown;
    const healthCount = counts.find((c) => c.category === SPLIT_CATEGORY)?.count ?? 0;
    const healthRows = month.transactions.filter((t) => t.category === SPLIT_CATEGORY);
    const day = Math.max(1, data.forecast.todayDayNumber);
    const rest = Math.max(0, total - health);
    return {
      monthLabel: `${Number(today.slice(5, 7))}월`,
      day,
      daysInMonth: data.forecast.daysInMonth,
      total,
      health,
      healthCount: Math.max(healthCount, health > 0 ? 1 : 0),
      healthItem:
        healthRows.length === 1
          ? { merchant: healthRows[0].merchant, dayKey: txDayKey(healthRows[0]) }
          : null,
      rest,
      restCount: Math.max(0, month.summary.spendingCount - healthCount),
      perDay: Math.round(rest / day),
      previous: previousMonth(bars, current),
      average,
      sameDay: sameDayRefs(data.references, day),
    };
  }, [data, current, bars, average, month.summary, month.transactions, today]);

  const paceFact = hero ? pickOne([heroPaceFact(hero, monthFrom, today)]) : null;
  const chartFact = pickOne([chartSplitFact(bars, threshold)]);
  const catFact = hero
    ? pickOne([
        topMerchantFact(month.transactions, hero.rest, hero.monthLabel, hero.day, {
          from: monthFrom,
          to: today,
        }),
      ])
    : null;
  const annotations = useMemo(
    () => monthAnnotations(bars, average?.total ?? null),
    [bars, average]
  );

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<SpendingCategoryKey, number>> = {};
    for (const c of month.summary.categoryBreakdown) {
      counts[c.category ?? "uncategorized"] = c.count;
    }
    return counts;
  }, [month.summary.categoryBreakdown]);

  const selected =
    bars.find((b) => b.key === selectedMonth) ?? current ?? bars[bars.length - 1] ?? null;

  const flagCtx: FlagContext = {
    oneOffThreshold: threshold,
    monthTotal: hero?.total ?? 0,
    monthRest: hero?.rest ?? 0,
    monthRestCount: hero?.restCount ?? 0,
    monthMaxId: monthMaxCharge(month.transactions, threshold)?.id ?? null,
    monthLabel: hero?.monthLabel ?? "이번 달",
    refundTotal: ledger.summary.flow.refundTotal,
    refundCount: ledger.summary.flow.refundCount,
    spendTotal: ledger.summary.totalSpending,
  };

  // When more pages exist, the oldest loaded day may be cut mid-day: hold it
  // back so every shown day header carries its full totals.
  const allDays = groupLedger(ledger.transactions);
  const completeDays = ledger.hasMore && allDays.length > 1 ? allDays.slice(0, -1) : allDays;
  const visibleDays = completeDays.slice(0, shownDays);
  const hiddenDays = completeDays.slice(shownDays);
  const hiddenCount = hiddenDays.reduce((s, d) => s + d.count, 0);
  const txCount =
    ledger.summary.spendingCount + ledger.summary.incomeCount + ledger.summary.ignoredCount;

  const refreshAll = () => {
    ledger.refresh();
    month.refresh();
    trend.refresh();
  };

  const actions: LedgerActions = {
    onCategory: async (id: string, value: ExpenseCategory) => {
      const ok = await updateCategory(id, value);
      if (ok) {
        toast.success(`카테고리를 '${EXPENSE_CATEGORY_LABELS[value]}'(으)로 바꿨어요.`);
        refreshAll();
      } else toast.error("카테고리를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return ok;
    },
    onOverride: async (id, value) => {
      const ok = await updateOverride(id, value);
      if (ok) {
        toast.success(
          value === "include"
            ? "이 거래를 소비에 넣었어요."
            : value === "exclude"
              ? "이 거래를 집계에서 뺐어요."
              : "기본 분류로 되돌렸어요."
        );
        refreshAll();
      } else toast.error("변경 사항을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return ok;
    },
    onDelete: async (id) => {
      const ok = await deleteTransaction(id);
      if (ok) {
        toast.success("거래 기록을 삭제했어요.");
        refreshAll();
        logs.refresh();
      } else toast.error("거래 기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return ok;
    },
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-page">
        <PageContainer>
          <LoadingState />
        </PageContainer>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const latestAt = latest.logs[0]?.receivedAt;
  const showMore = () => {
    setShownDays((n) => n + MORE_DAYS);
    if (ledger.hasMore && hiddenDays.length < MORE_DAYS) ledger.loadMore();
  };
  const moreLabel =
    hiddenDays.length > 0
      ? `${hiddenDays.length}일 · ${formatCount(hiddenCount)}건 더 보기`
      : "더 보기";
  const hasNoData = !trend.isLoading && !trend.error && data && bars.length === 0;

  return (
    <div className="min-h-screen bg-page">
      <Header />
      <PageContainer className="flex flex-col gap-12 lg:gap-16">
        <div {...enter(0)} className="ds-enter">
          <PageTitle
            title="소비"
            meta={
              <MetaLine
                items={[
                  `${today.slice(0, 4)}년 ${Number(today.slice(5, 7))}월`,
                  formatDateRange(monthFrom, today),
                  latestAt ? (
                    <span key="latest" title={formatDateTime(new Date(latestAt))}>
                      최근 알림 {formatRelative(latestAt)}
                    </span>
                  ) : null,
                ]}
              />
            }
          />
        </div>

        {trend.error && !data ? (
          <ErrorState
            title="소비 추이를 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요. 거래 내역은 아래에서 볼 수 있어요."
            actions={
              <button
                type="button"
                onClick={trend.refresh}
                className="h-9 cursor-pointer rounded-[9px] border-0 bg-surface px-3.5 text-[0.8125rem] font-semibold shadow-ring"
              >
                다시 시도
              </button>
            }
          />
        ) : !data || !hero ? (
          <SpendingHeroSkeleton />
        ) : hasNoData ? (
          <EmptyState
            title="아직 기록된 소비가 없어요"
            description="Toss 알림이 들어오면 이번 달 지출과 지난달 비교가 여기에 쌓여요."
            action={
              <Link
                href="/settings"
                className="inline-flex h-9 items-center rounded-[9px] bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-ring"
              >
                Toss 알림 연결 확인
              </Link>
            }
          />
        ) : (
          <>
            <div className="-mt-6 lg:-mt-6">
              <SpendingHero
                hero={hero}
                trend={data}
                paceFact={paceFact}
                mode={mode}
                onModeChange={setMode}
              />
            </div>

            {selected ? (
              <section
                {...enter(3)}
                className="ds-enter flex flex-col gap-6"
                aria-labelledby="spending-months"
              >
                <SectionTitle>
                  <span id="spending-months">월별 지출</span>
                </SectionTitle>
                <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,824fr)_minmax(0,400fr)] lg:gap-6">
                  <EvidenceScope>
                    <MonthlyChart
                      bars={bars}
                      average={average}
                      annotations={annotations}
                      selectedKey={selected.key}
                      onSelect={setSelectedMonth}
                      today={hero.day}
                      fact={chartFact}
                    />
                  </EvidenceScope>
                  <EvidenceScope>
                    <CategoryPanel
                      month={selected}
                      today={hero.day}
                      counts={selected.isCurrent ? categoryCounts : undefined}
                      fact={catFact}
                    />
                  </EvidenceScope>
                </div>
              </section>
            ) : null}
          </>
        )}

        <section
          {...enter(4)}
          className="ds-enter flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,718fr)_minmax(0,506fr)] lg:gap-x-6 lg:gap-y-4"
          aria-label="거래 기록"
        >
          {tab === "ledger" ? (
            // Phones: 돈의 흐름 is its own serif section before 거래 내역 (mock order).
            // Desktop: it sits in the right column beside the ledger.
            <aside
              className="mb-8 flex flex-col gap-2 lg:col-start-2 lg:row-start-2 lg:mb-0 lg:pt-3"
              aria-labelledby="spending-flow"
            >
              <SectionTitle className="lg:hidden">
                <span id="spending-flow">돈의 흐름</span>
              </SectionTitle>
              <BlockTitle className="hidden lg:block" as="h3">
                돈의 흐름
              </BlockTitle>
              <span className="text-label">{formatDateRange(range.from, range.to)}</span>
              <CashFlow summary={ledger.summary} />
            </aside>
          ) : null}

          <div className="flex flex-col gap-4 lg:col-span-2 lg:row-start-1 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle className="flex items-baseline gap-2">
                <span id={`spending-tab-${tab}`}>
                  {tab === "ledger" ? "거래 내역" : "원본 알림"}
                </span>
                {tab === "ledger" ? (
                  ledger.isLoading && txCount === 0 ? null : (
                    <span className="num font-sans text-sm leading-[1.375rem] font-normal tracking-normal text-ink-2">
                      {formatCount(txCount)}건
                    </span>
                  )
                ) : logs.total != null ? (
                  <span className="num font-sans text-sm leading-[1.375rem] font-normal tracking-normal text-ink-2">
                    {formatCount(logs.total)}건
                  </span>
                ) : null}
              </SectionTitle>
              <ViewToggle
                raw={tab === "raw"}
                onToggle={() => setTab(tab === "raw" ? "ledger" : "raw")}
                className="lg:hidden"
              />
            </div>
            <div className="flex items-center gap-3">
              <ViewToggle
                raw={tab === "raw"}
                onToggle={() => setTab(tab === "raw" ? "ledger" : "raw")}
                className="hidden lg:inline-flex"
              />
              <Segmented
                items={LEDGER_PERIODS}
                value={period}
                onChange={(value) => {
                  setPeriod(value);
                  setShownDays(FIRST_DAYS);
                }}
                ariaLabel="기간"
                className="w-full sm:w-[300px]"
              />
            </div>
          </div>

          {tab === "ledger" ? (
            <div id="spending-panel-ledger" className="min-w-0 lg:col-start-1 lg:row-start-2">
              <div className="min-w-0">
                {ledger.error && ledger.transactions.length === 0 ? (
                  <ErrorState
                    title="거래 내역을 불러오지 못했어요"
                    description="잠시 후 다시 시도해 주세요."
                    actions={
                      <button
                        type="button"
                        onClick={ledger.refresh}
                        className="h-9 cursor-pointer rounded-[9px] border-0 bg-surface px-3.5 text-[0.8125rem] font-semibold shadow-ring"
                      >
                        다시 시도
                      </button>
                    }
                  />
                ) : ledger.isLoading && ledger.transactions.length === 0 ? (
                  <LoadingState variant="rows" rows={6} />
                ) : visibleDays.length === 0 ? (
                  <EmptyState
                    className="pt-5"
                    title="이 기간에 기록된 거래가 없어요"
                    description="Toss 알림이 들어오지 않았거나 거래로 분석되지 않았어요. 원본 알림에서 확인할 수 있어요."
                  />
                ) : (
                  <>
                    <Ledger days={visibleDays} ctx={flagCtx} actions={actions} />
                    {hiddenDays.length > 0 || ledger.hasMore ? (
                      <MoreButton onClick={showMore}>{moreLabel}</MoreButton>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div
              id="spending-panel-raw"
              className="flex flex-col gap-4 lg:col-span-2 lg:row-start-2"
            >
              <BulkPanels
                onChanged={() => {
                  logs.refresh();
                  refreshAll();
                }}
              />
              {logs.isLoading && logs.logs.length === 0 ? (
                <LoadingState variant="rows" rows={6} />
              ) : logs.logs.length === 0 ? (
                <EmptyState
                  className="pt-5"
                  title="이 기간에 받은 알림이 없어요"
                  description="MacroDroid가 Toss 알림을 보내면 원문이 여기에 쌓여요."
                />
              ) : (
                <>
                  <NotificationList logs={logs.logs} onDeleteTransaction={actions.onDelete} />
                  {logs.hasMore ? <MoreButton onClick={logs.loadMore}>더 보기</MoreButton> : null}
                </>
              )}
            </div>
          )}
        </section>
      </PageContainer>
    </div>
  );
}
