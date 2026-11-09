"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  EvidenceScope,
  LoadingState,
  MetaLine,
  PageContainer,
  PageTitle,
} from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatDateTime, formatMonthDay, formatRelative, formatWon } from "@/lib/format";
import { useAuth } from "@/modules/auth/hooks";
import {
  type AccountOutcome,
  AccountOutcomes,
} from "@/modules/portfolio/components/AccountOutcomes";
import { AssetTrend } from "@/modules/portfolio/components/AssetTrend";
import {
  type HoldingGroup,
  HoldingsByAccount,
} from "@/modules/portfolio/components/HoldingsByAccount";
import { PortfolioDisclosures } from "@/modules/portfolio/components/PortfolioDisclosures";
import { PortfolioHero, type TodayRow } from "@/modules/portfolio/components/PortfolioHero";
import { enterStyle } from "@/modules/portfolio/components/parts";
import { TargetAllocationEditor } from "@/modules/portfolio/components/TargetAllocationEditor";
import { TargetDrift } from "@/modules/portfolio/components/TargetDrift";
import { driftFact, heroFact, holdingsFact } from "@/modules/portfolio/facts";
import {
  type SummaryPosition,
  syncAllAccounts,
  type TargetAllocation,
  useExecutions,
  usePortfolioSummary,
  useReturns,
  useSnapshots,
  useTargetsByAccount,
} from "@/modules/portfolio/hooks";
import { ACCOUNT_TYPE_LABEL } from "@/modules/portfolio/utils";
import {
  buildAssetSeries,
  computeDrift,
  ordDateKey,
  positionReturn,
  previousTradingDate,
} from "@/modules/portfolio/view-model";
import { SyncStatusProvider } from "@/modules/sync/hooks";

const EXECUTION_LIMIT = 15;
const RETURNS_PARAMS = {};
const EXECUTION_PARAMS = { limit: EXECUTION_LIMIT };
const NO_TARGETS: TargetAllocation[] = [];
const NO_POSITIONS: SummaryPosition[] = [];

const secondaryButton =
  "inline-flex h-9 cursor-pointer items-center rounded-control border-0 bg-surface px-3.5 text-[13px] font-semibold text-ink shadow-ring transition-[scale,box-shadow] duration-150 ease-out hover:shadow-ring-hover active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function PortfolioContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { summary, isLoading, error, refresh } = usePortfolioSummary();
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const snapshotParams = useMemo(
    () => ({ from: shiftDateKey(toKstCalendarDate(new Date()), -372) }),
    []
  );
  const { snapshots } = useSnapshots(snapshotParams);
  const { data: returns, error: returnsError } = useReturns(RETURNS_PARAMS);
  const { executions } = useExecutions(EXECUTION_PARAMS);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthLoading, isAuthenticated, router]);

  // Accounts that have a valuation, best outcome first.
  const view = useMemo(() => {
    if (!summary) return null;
    const snapBy = new Map(summary.latestSnapshots.map((s) => [s.accountId, s]));
    const accounts = summary.accounts
      .filter((a) => snapBy.has(a.id))
      .sort((a, b) => (snapBy.get(b.id)?.totalPnl ?? 0) - (snapBy.get(a.id)?.totalPnl ?? 0));
    const accountOfSnapshot = new Map(summary.latestSnapshots.map((s) => [s.id, s.accountId]));
    const positionsBy = new Map<string, typeof summary.positions>();
    for (const p of summary.positions) {
      const acc = accountOfSnapshot.get(p.snapshotId);
      if (!acc) continue;
      positionsBy.set(acc, [...(positionsBy.get(acc) ?? []), p]);
    }
    return { snapBy, accounts, positionsBy };
  }, [summary]);

  const accountIds = useMemo(() => view?.accounts.map((a) => a.id) ?? [], [view]);
  const { byAccount: targetsBy, refresh: refreshTargets } = useTargetsByAccount(accountIds);

  const series = useMemo(() => buildAssetSeries(snapshots, accountIds), [snapshots, accountIds]);

  const model = useMemo(() => {
    if (!summary?.totals || !view || view.accounts.length === 0) return null;
    const { snapBy, accounts, positionsBy } = view;
    const totals = summary.totals;
    const latestDate =
      [...snapBy.values()]
        .map((s) => s.asOfDate)
        .sort()
        .at(-1) ?? toKstCalendarDate(new Date());
    const asOf = { from: latestDate, to: latestDate, label: formatMonthDay(latestDate) };
    const syncedAtIso = accounts
      .map((a) => a.lastSyncedAt)
      .filter((s): s is string => !!s)
      .sort()
      .at(-1);
    const syncedAt = syncedAtIso ? new Date(syncedAtIso) : null;
    const labelOf = (id: string) => accounts.find((a) => a.id === id)?.label ?? "";
    const snap = (id: string) => snapBy.get(id) as NonNullable<ReturnType<typeof snapBy.get>>;

    const outcomes: AccountOutcome[] = accounts.map((a) => {
      const s = snap(a.id);
      return {
        id: a.id,
        label: a.label,
        typeLabel: ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType,
        number: `${a.cano}-${a.acntPrdtCd}`,
        total: s.totalEvalAmount,
        securities: s.securitiesEvalAmount,
        invested: s.totalPurchaseAmount,
        deposit: s.deposit,
        pnl: s.totalPnl,
        holdings: positionsBy.get(a.id)?.length ?? 0,
        todayChange: s.prevDayTotalAsset ? s.totalEvalAmount - s.prevDayTotalAsset : null,
      };
    });

    const todayRows: TodayRow[] = accounts.flatMap((a) => {
      const s = snap(a.id);
      return s.prevDayTotalAsset
        ? [
            {
              id: a.id,
              label: a.label,
              change: s.totalEvalAmount - s.prevDayTotalAsset,
              prev: s.prevDayTotalAsset,
            },
          ]
        : [];
    });

    const allPositions = accounts.flatMap((a) =>
      (positionsBy.get(a.id) ?? []).map((p) => ({
        ...p,
        accountId: a.id,
        rate: positionReturn(p),
      }))
    );
    const best = [...allPositions].sort((a, b) => b.pnl - a.pnl)[0];
    const worst = [...allPositions].sort((a, b) => a.pnl - b.pnl)[0];

    const hero = heroFact({
      accounts: outcomes.map((o) => ({
        id: o.id,
        label: o.label,
        pnl: o.pnl,
        rate: o.invested > 0 ? o.pnl / o.invested : 0,
      })),
      positions: allPositions.map((p) => ({
        accountId: p.accountId,
        accountLabel: labelOf(p.accountId),
        name: p.name,
        pnl: p.pnl,
      })),
      totalPnl: totals.totalPnl,
      totalPurchase: totals.totalPurchaseAmount,
      asOf,
      syncedAt: syncedAt ? `${formatDateTime(syncedAt)} 동기화` : null,
    });

    const holdings = holdingsFact({
      holdings: allPositions.map((p) => ({
        accountId: p.accountId,
        ticker: p.ticker,
        name: p.name,
        pnl: p.pnl,
        rate: p.rate,
      })),
      totalPnl: totals.totalPnl,
      asOf,
    });

    const isFlag = (accountId: string, ticker: string, p?: { accountId: string; ticker: string }) =>
      !!p && p.accountId === accountId && p.ticker === ticker;

    const groups: HoldingGroup[] = accounts.map((a) => {
      const targets = targetsBy[a.id]?.targets ?? [];
      return {
        accountId: a.id,
        label: a.label,
        typeLabel: ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType,
        number: `${a.cano}-${a.acntPrdtCd}`,
        securities: snap(a.id).securitiesEvalAmount,
        rows: [...(positionsBy.get(a.id) ?? [])]
          .sort((x, y) => y.evalAmount - x.evalAmount)
          .map((p) => ({
            ticker: p.ticker,
            name: p.name,
            quantity: p.quantity,
            avgPrice: p.avgPrice,
            currentPrice: p.currentPrice,
            evalAmount: p.evalAmount,
            pnl: p.pnl,
            rate: positionReturn(p),
            weight: p.weight,
            target: targets.find((t) => t.ticker === p.ticker)?.targetWeight ?? null,
            fills: executions
              .filter((e) => e.accountId === a.id && e.ticker === p.ticker && e.filledQty > 0)
              .slice(0, 2)
              .map(
                (e) =>
                  `${formatMonthDay(ordDateKey(e.ordDt))} ${e.filledQty}주 · ${formatWon(e.avgPrice)}`
              ),
            flag:
              best && best.pnl > 0 && isFlag(a.id, p.ticker, best)
                ? "손익 1위"
                : worst && worst.pnl < 0 && isFlag(a.id, p.ticker, worst)
                  ? "손실 1위"
                  : null,
          })),
      };
    });

    const drifts = accounts.flatMap((a) => {
      const entry = targetsBy[a.id];
      if (!entry || entry.targets.length === 0) return [];
      const base = snap(a.id).securitiesEvalAmount;
      const rows = computeDrift(positionsBy.get(a.id) ?? [], entry.targets, base);
      const buys = executions.filter(
        (e) => e.accountId === a.id && e.side === "buy" && e.filledQty > 0 && !e.cancelled
      );
      const lastDay = buys[0]?.ordDt;
      const recentBuys = buys
        .filter((e) => e.ordDt === lastDay)
        .map((e) => ({ date: ordDateKey(e.ordDt), ticker: e.ticker, amount: e.filledAmount }));
      const setAt = entry.updatedAt ? formatMonthDay(new Date(entry.updatedAt)) : null;
      return [
        {
          account: a,
          rows,
          base,
          setAt,
          fact: driftFact({
            accountId: a.id,
            accountLabel: a.label,
            rows,
            recentBuys,
            base,
            targetsSetAt: setAt,
            asOf,
          }),
        },
      ];
    });

    return { totals, outcomes, todayRows, hero, holdings, groups, drifts, syncedAt };
  }, [summary, view, targetsBy, executions]);

  const prevDate = useMemo(
    () => previousTradingDate(series, summary?.totals?.prevDayTotalAsset ?? null),
    [series, summary]
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncAllAccounts();
      if (r.ok) {
        toast.success("포트폴리오를 동기화했어요.");
        refresh();
      } else {
        toast.error("포트폴리오를 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      toast.error("포트폴리오를 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSyncing(false);
    }
  };

  if (isAuthLoading) {
    return (
      <PageContainer as="div">
        <LoadingState />
      </PageContainer>
    );
  }
  if (!isAuthenticated) return null;

  const accountCount = view?.accounts.length ?? 0;
  const syncErrors = view?.accounts.filter((a) => a.lastSyncError) ?? [];
  const editingAccount = view?.accounts.find((a) => a.id === editing) ?? null;

  return (
    <SyncStatusProvider>
      <div className="flex min-h-screen flex-col bg-page">
        <Header />
        <PageContainer>
          <PageTitle
            className="ds-enter"
            title="포트폴리오"
            meta={
              <MetaLine
                items={[
                  accountCount > 0 ? (
                    <span key="count">
                      <span className="hidden lg:inline">한국투자증권 </span>계좌 {accountCount}개
                    </span>
                  ) : null,
                  model?.syncedAt ? (
                    <span key="at" className="whitespace-nowrap">
                      <span className="num">{formatDateTime(model.syncedAt)}</span> 기준
                    </span>
                  ) : null,
                  model?.syncedAt ? (
                    <span key="rel" className="num whitespace-nowrap">
                      {formatRelative(model.syncedAt)}
                    </span>
                  ) : null,
                  syncErrors.length > 0 ? (
                    <span key="err" className="text-warn">
                      {syncErrors.map((a) => a.label).join("·")} 동기화 실패
                    </span>
                  ) : null,
                  accountCount > 0 ? (
                    <button
                      key="sync"
                      type="button"
                      onClick={handleSync}
                      disabled={syncing}
                      className="inline-flex min-h-6 cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 text-sm text-ink-2 underline decoration-ink-3 decoration-dotted underline-offset-[3px] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-60"
                    >
                      {syncing ? "동기화 중…" : "지금 동기화"}
                    </button>
                  ) : null,
                ]}
              />
            }
          />

          {isLoading && !summary ? (
            <LoadingState className="mt-10" />
          ) : error && !summary ? (
            <ErrorState
              className="mt-10"
              title="포트폴리오를 불러오지 못했어요"
              description="잠시 후 다시 시도해 주세요."
              actions={
                <button type="button" onClick={refresh} className={secondaryButton}>
                  다시 시도
                </button>
              }
            />
          ) : !model ? (
            <EmptyState
              className="mt-10"
              title="아직 연결된 계좌가 없어요"
              description="설정에서 한국투자증권 계좌를 연결하면 자산과 보유 종목이 여기에 모여요."
              action={
                <button
                  type="button"
                  onClick={() => router.push("/settings")}
                  className={secondaryButton}
                >
                  설정에서 계좌 연결
                </button>
              }
            />
          ) : (
            <>
              {/* Each host gets its own scope: an AI line only lights/dims its own items. */}
              <EvidenceScope>
                <PortfolioHero
                  total={model.totals.totalEvalAmount}
                  deposit={model.totals.totalDeposit}
                  invested={model.totals.totalPurchaseAmount}
                  pnl={model.totals.totalPnl}
                  todayChange={model.totals.assetIcdcAmt}
                  prevTotal={model.totals.prevDayTotalAsset}
                  prevDate={prevDate}
                  todayRows={model.todayRows}
                  fact={model.hero}
                />
                <AccountOutcomes accounts={model.outcomes} />
              </EvidenceScope>
              <EvidenceScope>
                <AssetTrend series={series} cashflows={returns?.cashflows ?? []} />
              </EvidenceScope>
              <EvidenceScope>
                <HoldingsByAccount groups={model.groups} fact={model.holdings} />
              </EvidenceScope>
              {model.drifts.map((d, i) => (
                <EvidenceScope key={d.account.id}>
                  <TargetDrift
                    following={i > 0}
                    accountId={d.account.id}
                    accountLabel={d.account.label}
                    rows={d.rows}
                    base={d.base}
                    setAt={d.setAt}
                    fact={d.fact}
                    onEdit={() => setEditing(d.account.id)}
                  />
                </EvidenceScope>
              ))}
              <div
                className={model.drifts.length === 0 ? "ds-enter mt-10 lg:mt-14" : "ds-enter"}
                style={enterStyle(4)}
              >
                <PortfolioDisclosures
                  returns={returns}
                  returnsError={returnsError}
                  executions={executions}
                  pnlRate={
                    model.totals.totalPurchaseAmount > 0
                      ? model.totals.totalPnl / model.totals.totalPurchaseAmount
                      : 0
                  }
                />
              </div>
            </>
          )}

          {editingAccount ? (
            <TargetAllocationEditor
              open
              onOpenChange={(o) => {
                if (!o) setEditing(null);
              }}
              account={editingAccount}
              currentPositions={view?.positionsBy.get(editingAccount.id) ?? NO_POSITIONS}
              initialTargets={targetsBy[editingAccount.id]?.targets ?? NO_TARGETS}
              onSaved={() => {
                refreshTargets();
                setEditing(null);
              }}
            />
          ) : null}
        </PageContainer>
      </div>
    </SyncStatusProvider>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense
      fallback={
        <PageContainer as="div">
          <LoadingState />
        </PageContainer>
      }
    >
      <PortfolioContent />
    </Suspense>
  );
}
