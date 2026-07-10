"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes, formatDate, toLocalDateString } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/modules/spending/categories";
import { CategorySpendingChart } from "@/modules/spending/components/CategorySpendingChart";
import { MonthlySpendingBar } from "@/modules/spending/components/MonthlySpendingBar";
import { SpendingTrendChart } from "@/modules/spending/components/SpendingTrendChart";
import type {
  Bucket,
  CleanupItem,
  ReparseItem,
  SpendingFilters,
  TransactionItem,
} from "@/modules/spending/hooks";
import {
  useCleanup,
  useDeleteTransaction,
  useNotificationLogs,
  useReparse,
  useSpendingTrend,
  useTransactions,
  useUpdateTransactionCategory,
  useUpdateTransactionOverride,
} from "@/modules/spending/hooks";

type Tab = "transactions" | "notifications";

function getDefaultDateRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = toLocalDateString(now);
  return { from, to };
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

function toDateStr(d: Date): string {
  return toLocalDateString(d);
}

interface DatePreset {
  label: string;
  getRange: () => { from: string; to: string };
}

const DATE_PRESETS: DatePreset[] = [
  {
    label: "오늘",
    getRange: () => {
      const now = toDateStr(new Date());
      return { from: now, to: now };
    },
  },
  {
    label: "이번 달",
    getRange: () => {
      const now = new Date();
      return {
        from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        to: toDateStr(now),
      };
    },
  },
  {
    label: "1개월",
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
  {
    label: "3개월",
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
  {
    label: "6개월",
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
  {
    label: "9개월",
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 9);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
  {
    label: "1년",
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
];

function CleanupItemRow({ item }: { item: CleanupItem }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <div className="flex-shrink-0 mt-0.5">
        <Trash2 className="h-3.5 w-3.5 text-red-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-red-600">{item.reason}</span>
          <span className="text-[11px] text-muted-foreground">{formatBytes(item.bytes)}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {item.title || "(제목 없음)"} — {item.text || "(내용 없음)"}
        </p>
      </div>
    </div>
  );
}

function ReparseItemRow({ item }: { item: ReparseItem }) {
  const actionIcon = {
    create: <Plus className="h-3.5 w-3.5 text-green-500" />,
    update: <Pencil className="h-3.5 w-3.5 text-blue-500" />,
    skip: <X className="h-3.5 w-3.5 text-muted-foreground" />,
  };
  const actionLabel = {
    create: "신규",
    update: "수정",
    skip: "무시",
  };
  const actionColor = {
    create: "text-green-600",
    update: "text-blue-600",
    skip: "text-muted-foreground",
  };

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <div className="flex-shrink-0 mt-0.5">{actionIcon[item.action]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${actionColor[item.action]}`}>
            {actionLabel[item.action]}
          </span>
          {item.parsed && (
            <span className="text-xs text-muted-foreground">
              {item.parsed.type === "withdrawal" ? "출금" : "입금"}{" "}
              {formatAmount(item.parsed.amount)}원 · {item.parsed.merchant}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {item.title || "(제목 없음)"} — {item.text || "(내용 없음)"}
        </p>
        {item.reason && <p className="text-[11px] text-muted-foreground/70">{item.reason}</p>}
      </div>
    </div>
  );
}

const BUCKET_LABEL: Record<Bucket, string> = {
  spending: "소비",
  income: "수입",
  ignore: "무시",
};

function BucketBadge({ bucket }: { bucket: Bucket }) {
  const className =
    bucket === "spending"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : bucket === "income"
        ? "bg-green-500/10 text-green-600 dark:text-green-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 ${className}`}>
      {BUCKET_LABEL[bucket]}
    </span>
  );
}

function TransactionRow({
  tx,
  onChangeCategory,
  onChangeOverride,
}: {
  tx: TransactionItem;
  onChangeCategory: (id: string, value: ExpenseCategory) => void;
  onChangeOverride: (id: string, value: "include" | "exclude" | null) => void;
}) {
  const isIgnored = tx.bucket === "ignore";
  const amountSign = tx.type === "withdrawal" ? "-" : "+";
  const amountColor = isIgnored
    ? "text-muted-foreground"
    : tx.bucket === "spending"
      ? "text-red-500"
      : "text-green-500";

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-1.5 ${
        isIgnored ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
        {tx.type === "withdrawal" ? (
          <ArrowUpRight className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
        ) : (
          <ArrowDownLeft className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
        )}
        <span className="text-sm font-medium truncate max-w-full">{tx.merchant}</span>
        <BucketBadge bucket={tx.bucket} />
        {tx.bucket === "spending" && (
          <Select
            value={tx.category ?? undefined}
            onValueChange={(value) => onChangeCategory(tx.id, value as ExpenseCategory)}
          >
            <SelectTrigger
              className="h-5 w-auto min-w-[62px] border-0 bg-muted px-1.5 text-[10px] shadow-none"
              size="sm"
            >
              <SelectValue placeholder="분류 중" />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tx.spendingOverride && (
          <span
            className="text-[10px] px-1 py-0.5 rounded-sm bg-primary/10 text-primary flex-shrink-0"
            title={tx.spendingOverride === "include" ? "수동: 소비 포함" : "수동: 집계 제외"}
          >
            수동
          </span>
        )}
        <span className="text-xs text-muted-foreground flex-shrink-0">{tx.accountName}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {formatDate(tx.transactedAt)}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className={`text-sm tabular-nums font-medium ${amountColor}`}>
          {amountSign}
          {formatAmount(tx.amount)}원
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => onChangeOverride(tx.id, "exclude")}
              disabled={tx.spendingOverride === "exclude"}
            >
              집계에서 제외
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onChangeOverride(tx.id, "include")}
              disabled={tx.spendingOverride === "include"}
            >
              소비로 포함
            </DropdownMenuItem>
            {tx.spendingOverride && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChangeOverride(tx.id, null)}>
                  기본값으로 되돌리기
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function SpendingPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const defaultRange = getDefaultDateRange();
  const [tab, setTab] = useState<Tab>("transactions");
  const [activePreset, setActivePreset] = useState<string>("이번 달");
  const [filters, setFilters] = useState<SpendingFilters>({
    from: defaultRange.from,
    to: defaultRange.to,
  });

  const {
    transactions,
    summary,
    isLoading,
    hasMore,
    loadMore,
    refresh: refreshTransactions,
  } = useTransactions({
    filters,
    enabled: isAuthenticated,
  });

  const {
    logs,
    total: logsTotal,
    isLoading: logsLoading,
    hasMore: logsHasMore,
    loadMore: logsLoadMore,
    refresh: refreshLogs,
  } = useNotificationLogs({
    filters: { from: filters.from, to: filters.to },
    enabled: isAuthenticated && tab === "notifications",
  });

  const {
    preview,
    apply,
    result: reparseResult,
    progress: reparseProgress,
    isLoading: reparseLoading,
    clear: clearReparse,
  } = useReparse();

  const { deleteTransaction, isDeleting } = useDeleteTransaction();
  const { updateOverride } = useUpdateTransactionOverride();
  const { updateCategory } = useUpdateTransactionCategory();

  const handleChangeOverride = async (id: string, value: "include" | "exclude" | null) => {
    const success = await updateOverride(id, value);
    if (success) {
      toast.success(
        value === "include"
          ? "소비로 포함했습니다"
          : value === "exclude"
            ? "집계에서 제외했습니다"
            : "기본값으로 되돌렸습니다"
      );
      refreshTransactions();
    } else {
      toast.error("저장에 실패했습니다");
    }
  };

  const handleChangeCategory = async (id: string, value: ExpenseCategory) => {
    const success = await updateCategory(id, value);
    if (success) {
      toast.success(`${EXPENSE_CATEGORY_LABELS[value]}(으)로 분류했습니다`);
      refreshTransactions();
    } else {
      toast.error("카테고리 저장에 실패했습니다");
    }
  };

  const {
    preview: cleanupPreview,
    execute: cleanupExecute,
    result: cleanupResult,
    progress: cleanupProgress,
    isLoading: cleanupLoading,
    clear: clearCleanup,
  } = useCleanup();

  const { data: trendData } = useSpendingTrend();

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

  const handleApply = async () => {
    await apply();
    refreshTransactions();
    refreshLogs();
  };

  return (
    <div className="min-h-screen bg-background">
      <Header showSync={false} />

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">소비</h1>
          <p className="text-sm text-muted-foreground mt-1">Toss 알림으로 수집된 소비/입금 내역</p>
        </div>

        {summary.categoryBreakdown.length > 0 && (
          <Card className="mb-5">
            <CardContent className="px-4 py-4">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">카테고리별 지출</p>
                <p className="text-[11px] text-muted-foreground">선택 기간 기준</p>
              </div>
              <CategorySpendingChart data={summary.categoryBreakdown} />
            </CardContent>
          </Card>
        )}

        {/* 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground">총 출금</p>
              <p className="text-base font-semibold text-red-500">
                {formatAmount(summary.totalWithdrawal)}원
              </p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground">총 입금</p>
              <p className="text-base font-semibold text-green-500">
                {formatAmount(summary.totalDeposit)}원
              </p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground">출금 건수</p>
              <p className="text-base font-semibold">{summary.withdrawalCount}건</p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground">입금 건수</p>
              <p className="text-base font-semibold">{summary.depositCount}건</p>
            </CardContent>
          </Card>
        </div>

        {/* 소비 추세 차트 */}
        {trendData && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <Card className="lg:col-span-2">
              <CardContent className="px-3 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">이번 달 누적 지출</p>
                </div>
                <SpendingTrendChart
                  data={trendData.cumulativeCurve}
                  todayDayNumber={trendData.forecast.todayDayNumber}
                  predictedTotal={trendData.forecast.predictedTotal}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3">
                <p className="text-sm font-medium mb-2">월별 지출</p>
                <MonthlySpendingBar data={trendData.monthlyBars} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* 기간 프리셋 */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const range = preset.getRange();
                setFilters((prev) => ({ ...prev, from: range.from, to: range.to }));
                setActivePreset(preset.label);
              }}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                activePreset === preset.label
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* 필터 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="date"
            value={filters.from || ""}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, from: e.target.value }));
              setActivePreset("");
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={filters.to || ""}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, to: e.target.value }));
              setActivePreset("");
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs"
          />
          {tab === "transactions" && (
            <Select
              value={filters.type || "all"}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  type: value === "all" ? undefined : (value as "withdrawal" | "deposit"),
                }))
              }
            >
              <SelectTrigger className="w-[90px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="withdrawal">출금</SelectItem>
                <SelectItem value="deposit">입금</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 mb-4 border-b">
          <button
            type="button"
            onClick={() => setTab("transactions")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === "transactions"
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" />
            거래내역
          </button>
          <button
            type="button"
            onClick={() => setTab("notifications")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === "notifications"
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bell className="h-4 w-4" />
            원본 알림
            {logsTotal > 0 && <span className="text-xs text-muted-foreground">({logsTotal})</span>}
          </button>
        </div>

        {/* 거래내역 탭 */}
        {tab === "transactions" &&
          (isLoading && transactions.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>소비 내역이 없습니다.</p>
                <p className="text-sm mt-2">설정에서 Toss 알림 연동을 확인해주세요.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-0 divide-y">
                  {transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      onChangeCategory={handleChangeCategory}
                      onChangeOverride={handleChangeOverride}
                    />
                  ))}
                </CardContent>
              </Card>
              {hasMore && (
                <div className="flex justify-center py-3">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}더
                    보기
                  </Button>
                </div>
              )}
            </>
          ))}

        {/* 원본 알림 탭 */}
        {tab === "notifications" && (
          <>
            {/* 재파싱 섹션 */}
            <Card className="mb-4">
              <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">알림 재파싱</p>
                    <p className="text-xs text-muted-foreground">
                      파서가 업데이트된 경우, 기존 알림을 다시 파싱하여 누락된 거래를 복구합니다.
                    </p>
                  </div>
                  {!reparseResult && !reparseProgress ? (
                    <Button variant="outline" size="sm" onClick={preview} disabled={reparseLoading}>
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      미리보기
                    </Button>
                  ) : reparseResult?.dryRun ? (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={clearReparse}>
                        취소
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={
                          reparseLoading ||
                          (reparseResult.created === 0 && reparseResult.updated === 0)
                        }
                      >
                        {reparseLoading && !reparseProgress ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <Check className="h-4 w-4 mr-1.5" />
                        )}
                        적용 (
                        {[
                          reparseResult.created > 0 && `${reparseResult.created}건 신규`,
                          reparseResult.updated > 0 && `${reparseResult.updated}건 수정`,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        )
                      </Button>
                    </div>
                  ) : reparseResult ? (
                    <Button variant="ghost" size="sm" onClick={clearReparse}>
                      닫기
                    </Button>
                  ) : null}
                </div>

                {/* 진행 상황 */}
                {reparseProgress && (
                  <div className="mt-3 border-t pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">
                        {reparseProgress.processed} / {reparseProgress.total}건 처리 중...
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {reparseProgress.total > 0
                          ? Math.round((reparseProgress.processed / reparseProgress.total) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: `${reparseProgress.total > 0 ? (reparseProgress.processed / reparseProgress.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex gap-3 mt-2 text-[11px]">
                      <span className="text-green-600">신규 {reparseProgress.created}</span>
                      <span className="text-blue-600">수정 {reparseProgress.updated}</span>
                      <span className="text-muted-foreground">무시 {reparseProgress.skipped}</span>
                    </div>
                  </div>
                )}

                {/* 재파싱 결과 */}
                {reparseResult && (
                  <div className="mt-3 border-t pt-3">
                    <div className="flex gap-4 mb-3 text-xs">
                      <span>
                        전체 <strong>{reparseResult.total}</strong>
                      </span>
                      <span className="text-green-600">
                        신규 <strong>{reparseResult.created}</strong>
                      </span>
                      <span className="text-blue-600">
                        수정 <strong>{reparseResult.updated}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        무시 <strong>{reparseResult.skipped}</strong>
                      </span>
                      {reparseResult.failed > 0 && (
                        <span className="text-red-600">
                          실패 <strong>{reparseResult.failed}</strong>
                        </span>
                      )}
                      {!reparseResult.dryRun && (
                        <Badge variant="default" className="text-[10px]">
                          적용 완료
                        </Badge>
                      )}
                    </div>

                    {/* 변경 사항만 표시 (create/update) */}
                    {reparseResult.items.filter((i) => i.action !== "skip").length > 0 && (
                      <div className="max-h-60 overflow-y-auto">
                        {reparseResult.items
                          .filter((i) => i.action !== "skip")
                          .map((item) => (
                            <ReparseItemRow key={item.logId} item={item} />
                          ))}
                      </div>
                    )}

                    {/* 무시된 항목 요약 */}
                    {reparseResult.skipped > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        + {reparseResult.skipped}건 무시됨 (파싱 불가 또는 중복)
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 알림 정리 섹션 */}
            <Card className="mb-4">
              <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">알림 정리</p>
                    <p className="text-xs text-muted-foreground">
                      재파싱 후에도 파싱 불가능한 알림(광고, 이벤트 등)을 삭제합니다.
                    </p>
                  </div>
                  {!cleanupResult && !cleanupProgress && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cleanupPreview}
                      disabled={cleanupLoading}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      미리보기
                    </Button>
                  )}
                  {cleanupResult && !cleanupResult.dryRun && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        clearCleanup();
                        refreshLogs();
                      }}
                    >
                      닫기
                    </Button>
                  )}
                </div>

                {/* 진행 상황 */}
                {cleanupProgress && (
                  <div className="mt-3 border-t pt-3">
                    {cleanupProgress.phase === "reparse" && (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-muted-foreground">
                            1단계: 재파싱 중... {cleanupProgress.reparseProcessed} /{" "}
                            {cleanupProgress.reparseTotal}건
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {(cleanupProgress.reparseTotal ?? 0) > 0
                              ? Math.round(
                                  ((cleanupProgress.reparseProcessed ?? 0) /
                                    (cleanupProgress.reparseTotal ?? 1)) *
                                    100
                                )
                              : 0}
                            %
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{
                              width: `${(cleanupProgress.reparseTotal ?? 0) > 0 ? ((cleanupProgress.reparseProcessed ?? 0) / (cleanupProgress.reparseTotal ?? 1)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex gap-3 mt-2 text-[11px]">
                          <span className="text-green-600">
                            신규 {cleanupProgress.reparseCreated ?? 0}
                          </span>
                          <span className="text-blue-600">
                            수정 {cleanupProgress.reparseUpdated ?? 0}
                          </span>
                        </div>
                      </>
                    )}
                    {cleanupProgress.phase === "cleanup" && (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-muted-foreground">
                            2단계: 삭제 중... {cleanupProgress.deleted} /{" "}
                            {cleanupProgress.deletableTotal}건
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {(cleanupProgress.deletableTotal ?? 0) > 0
                              ? Math.round(
                                  ((cleanupProgress.deleted ?? 0) /
                                    (cleanupProgress.deletableTotal ?? 1)) *
                                    100
                                )
                              : 0}
                            %
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-red-500 transition-all duration-300"
                            style={{
                              width: `${(cleanupProgress.deletableTotal ?? 0) > 0 ? ((cleanupProgress.deleted ?? 0) / (cleanupProgress.deletableTotal ?? 1)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 정리 결과 */}
                {cleanupResult && (
                  <div className="mt-3 border-t pt-3">
                    {/* 재파싱 결과 요약 */}
                    <div className="flex gap-4 mb-2 text-xs">
                      <span>
                        재파싱: 신규 <strong>{cleanupResult.reparseCreated}</strong>건, 수정{" "}
                        <strong>{cleanupResult.reparseUpdated}</strong>건
                      </span>
                    </div>

                    {cleanupResult.dryRun ? (
                      <>
                        {/* 삭제 대상 요약 */}
                        <div className="flex items-center gap-2 mb-3 text-xs">
                          <span className="text-red-600">
                            삭제 대상: <strong>{cleanupResult.deletable}</strong>건 (~
                            {formatBytes(cleanupResult.estimatedBytes)})
                          </span>
                        </div>

                        {/* 삭제 대상 목록 */}
                        {cleanupResult.items.length > 0 && (
                          <div className="max-h-60 overflow-y-auto mb-3">
                            {cleanupResult.items.map((item) => (
                              <CleanupItemRow key={item.logId} item={item} />
                            ))}
                          </div>
                        )}

                        {cleanupResult.deletable === 0 ? (
                          <div className="flex items-center gap-2 text-xs text-green-600">
                            <Check className="h-3.5 w-3.5" />
                            삭제할 알림이 없습니다.
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={clearCleanup}>
                              취소
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                await cleanupExecute();
                                refreshLogs();
                              }}
                              disabled={cleanupLoading}
                            >
                              {cleanupLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-1.5" />
                              )}
                              삭제 ({cleanupResult.deletable}건, ~
                              {formatBytes(cleanupResult.estimatedBytes)})
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <Check className="h-3.5 w-3.5" />
                        {cleanupResult.deleted}건 삭제 완료 (~
                        {formatBytes(cleanupResult.estimatedBytes)} 확보)
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 알림 로그 리스트 */}
            {logsLoading && logs.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>수신된 알림이 없습니다.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardContent className="p-0 divide-y">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between gap-3 px-3 py-1.5"
                      >
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${log.parsed ? "bg-green-500" : "bg-muted-foreground/40"}`}
                          />
                          <span className="text-sm truncate">{log.title || "(제목 없음)"}</span>
                          <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                            {log.text || ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {log.parsed && log.transactionId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-red-500"
                              disabled={isDeleting}
                              onClick={async () => {
                                const success = await deleteTransaction(log.transactionId!);
                                if (success) {
                                  toast.success("거래 기록이 삭제되었습니다");
                                  refreshTransactions();
                                  refreshLogs();
                                } else {
                                  toast.error("삭제에 실패했습니다");
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDate(log.receivedAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {logsHasMore && (
                  <div className="flex justify-center py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={logsLoadMore}
                      disabled={logsLoading}
                    >
                      {logsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      더 보기
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
