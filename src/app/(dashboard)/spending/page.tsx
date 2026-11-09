"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
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
  NotificationLogItem,
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

const TYPE_LABEL: Record<string, string> = {
  withdrawal: "출금",
  deposit: "입금",
  cancel: "결제 취소",
};

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

/** Two-line preview of a raw notification the user judges before a bulk action. */
function NotificationPreview({ title, text }: { title: string | null; text: string | null }) {
  const full = `${title || "(제목 없음)"} — ${text || "(내용 없음)"}`;
  return (
    <p className="text-xs text-muted-foreground line-clamp-2 break-words" title={full}>
      {full}
    </p>
  );
}

function CleanupItemRow({ item }: { item: CleanupItem }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <div className="flex-shrink-0 mt-0.5">
        <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-destructive">{item.reason}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(item.bytes)}
          </span>
        </div>
        <NotificationPreview title={item.title} text={item.text} />
      </div>
    </div>
  );
}

function ReparseItemRow({ item }: { item: ReparseItem }) {
  const actionIcon = {
    create: <Plus className="h-3.5 w-3.5 text-success" aria-hidden="true" />,
    update: <Pencil className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />,
    skip: <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
  };
  const actionLabel = {
    create: "신규",
    update: "수정",
    skip: "무시",
  };
  const actionColor = {
    create: "text-success",
    update: "text-blue-600 dark:text-blue-400",
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
            <span className="text-xs text-muted-foreground tabular-nums">
              {TYPE_LABEL[item.parsed.type] ?? item.parsed.type} {formatAmount(item.parsed.amount)}
              원 · {item.parsed.merchant}
            </span>
          )}
        </div>
        <NotificationPreview title={item.title} text={item.text} />
        {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
      </div>
    </div>
  );
}

function NotificationLogRow({
  log,
  isDeleting,
  onDelete,
}: {
  log: NotificationLogItem;
  isDeleting: boolean;
  onDelete: (transactionId: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-1.5">
      <details className="group min-w-0 flex-1">
        <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-90"
            aria-hidden="true"
          />
          <span
            className={`flex flex-shrink-0 items-center gap-1 text-xs ${
              log.parsed ? "text-success" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                log.parsed ? "bg-success" : "bg-muted-foreground/40"
              }`}
              aria-hidden="true"
            />
            {log.parsed ? "분석됨" : "미분석"}
          </span>
          <span className="text-sm truncate" title={log.title || undefined}>
            {log.title || "(제목 없음)"}
          </span>
          {log.text && (
            <span
              className="text-xs text-muted-foreground truncate hidden sm:inline group-open:hidden"
              aria-hidden="true"
            >
              {log.text}
            </span>
          )}
        </summary>
        <p className="mt-1 pl-5 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {log.text || "(내용 없음)"}
        </p>
      </details>
      <div className="flex items-center gap-2 flex-shrink-0">
        {log.parsed && log.transactionId && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="거래 기록 삭제"
            className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isDeleting}
            onClick={() => onDelete(log.transactionId!)}
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
          </Button>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDate(log.receivedAt)}
        </span>
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
      ? "bg-destructive/10 text-destructive"
      : bucket === "income"
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 ${className}`}>
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
      ? "text-destructive"
      : "text-success";

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-1.5 ${
        isIgnored ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
        {tx.type === "withdrawal" ? (
          <ArrowUpRight className="h-3.5 w-3.5 text-destructive flex-shrink-0" aria-hidden="true" />
        ) : (
          <ArrowDownLeft className="h-3.5 w-3.5 text-success flex-shrink-0" aria-hidden="true" />
        )}
        <span className="text-sm font-medium truncate max-w-full" title={tx.merchant}>
          {tx.merchant}
        </span>
        <BucketBadge bucket={tx.bucket} />
        {tx.bucket === "spending" && (
          <Select
            value={tx.category ?? undefined}
            onValueChange={(value) => onChangeCategory(tx.id, value as ExpenseCategory)}
          >
            <SelectTrigger
              aria-label="지출 카테고리"
              className="h-5 w-auto min-w-[62px] border-0 bg-muted px-1.5 text-xs shadow-none"
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
            className="text-xs px-1 py-0.5 rounded-sm bg-primary/10 text-primary flex-shrink-0"
            title={tx.spendingOverride === "include" ? "수동: 소비 포함" : "수동: 집계 제외"}
          >
            수동
          </span>
        )}
        <span className="text-xs text-muted-foreground flex-shrink-0">{tx.accountName}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
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
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="거래 메뉴 열기">
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
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
          ? "거래가 소비에 포함되었습니다."
          : value === "exclude"
            ? "거래가 집계에서 제외되었습니다."
            : "거래가 기본 분류로 되돌려졌습니다."
      );
      refreshTransactions();
    } else {
      toast.error("변경 사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    if (!window.confirm("이 알림으로 기록된 거래를 삭제할까요? 소비 집계에서 바로 빠집니다.")) {
      return;
    }
    const success = await deleteTransaction(transactionId);
    if (success) {
      toast.success("거래 기록이 삭제되었습니다.");
      refreshTransactions();
      refreshLogs();
    } else {
      toast.error("거래 기록을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleChangeCategory = async (id: string, value: ExpenseCategory) => {
    const success = await updateCategory(id, value);
    if (success) {
      toast.success(`카테고리가 '${EXPENSE_CATEGORY_LABELS[value]}' 항목으로 변경되었습니다.`);
      refreshTransactions();
    } else {
      toast.error("카테고리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
      <div role="status" className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">로딩 중…</span>
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
      <Header />

      <main id="main" className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">소비</h1>
          <p className="text-sm text-muted-foreground mt-1">Toss 알림으로 수집된 소비/입금 내역</p>
        </div>

        {summary.categoryBreakdown.length > 0 && (
          <Card className="mb-5 gap-0 py-0">
            <CardContent className="px-4 py-3">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">카테고리별 지출</p>
                <p className="text-xs text-muted-foreground">선택 기간 기준</p>
              </div>
              <CategorySpendingChart data={summary.categoryBreakdown} />
            </CardContent>
          </Card>
        )}

        {/* 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">총 출금</p>
              <p className="text-base font-semibold text-destructive tabular-nums">
                {formatAmount(summary.totalWithdrawal)}원
              </p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">총 입금</p>
              <p className="text-base font-semibold text-success tabular-nums">
                {formatAmount(summary.totalDeposit)}원
              </p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">출금 건수</p>
              <p className="text-base font-semibold tabular-nums">{summary.withdrawalCount}건</p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">입금 건수</p>
              <p className="text-base font-semibold tabular-nums">{summary.depositCount}건</p>
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
              aria-pressed={activePreset === preset.label}
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
            aria-label="시작일"
            value={filters.from || ""}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, from: e.target.value }));
              setActivePreset("");
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-base shadow-xs sm:text-sm"
          />
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            ~
          </span>
          <input
            type="date"
            aria-label="종료일"
            value={filters.to || ""}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, to: e.target.value }));
              setActivePreset("");
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-base shadow-xs sm:text-sm"
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
              <SelectTrigger className="w-[90px]" size="sm" aria-label="거래 유형">
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
            aria-pressed={tab === "transactions"}
            onClick={() => setTab("transactions")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === "transactions"
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" aria-hidden="true" />
            거래내역
          </button>
          <button
            type="button"
            aria-pressed={tab === "notifications"}
            onClick={() => setTab("notifications")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === "notifications"
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            원본 알림
            {logsTotal > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">({logsTotal})</span>
            )}
          </button>
        </div>

        {/* 거래내역 탭 */}
        {tab === "transactions" &&
          (isLoading && transactions.length === 0 ? (
            <div role="status" className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">로딩 중…</span>
            </div>
          ) : transactions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>소비 내역이 없습니다.</p>
                <p className="text-sm mt-2">설정에서 Toss 알림 연결을 확인해 주세요.</p>
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
            {/* 알림 다시 분석 섹션 */}
            <Card className="mb-4">
              <CardContent className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">알림 다시 분석</p>
                    <p className="text-xs text-muted-foreground">
                      분석 규칙이 바뀐 경우, 기존 알림을 다시 분석해 누락된 거래를 복구합니다.
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
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {reparseProgress.processed} / {reparseProgress.total}건 처리 중…
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {reparseProgress.total > 0
                          ? Math.round((reparseProgress.processed / reparseProgress.total) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{
                          width: `${reparseProgress.total > 0 ? (reparseProgress.processed / reparseProgress.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex gap-3 mt-2 text-xs tabular-nums">
                      <span className="text-success">신규 {reparseProgress.created}</span>
                      <span className="text-blue-600 dark:text-blue-400">
                        수정 {reparseProgress.updated}
                      </span>
                      <span className="text-muted-foreground">무시 {reparseProgress.skipped}</span>
                    </div>
                  </div>
                )}

                {/* 다시 분석 결과 */}
                {reparseResult && (
                  <div className="mt-3 border-t pt-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs tabular-nums">
                      <span>
                        전체 <strong>{reparseResult.total}</strong>
                      </span>
                      <span className="text-success">
                        신규 <strong>{reparseResult.created}</strong>
                      </span>
                      <span className="text-blue-600 dark:text-blue-400">
                        수정 <strong>{reparseResult.updated}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        무시 <strong>{reparseResult.skipped}</strong>
                      </span>
                      {reparseResult.failed > 0 && (
                        <span className="text-destructive">
                          실패 <strong>{reparseResult.failed}</strong>
                        </span>
                      )}
                      {!reparseResult.dryRun && (
                        <Badge variant="default" className="text-xs">
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
                        + {reparseResult.skipped}건 무시됨 (분석 불가 또는 중복)
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 알림 정리 섹션 */}
            <Card className="mb-4">
              <CardContent className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">알림 정리</p>
                    <p className="text-xs text-muted-foreground">
                      다시 분석해도 거래로 인식되지 않는 알림(광고, 이벤트 등)을 삭제합니다.
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
                          <span className="text-xs text-muted-foreground tabular-nums">
                            1단계: 다시 분석 중… {cleanupProgress.reparseProcessed} /{" "}
                            {cleanupProgress.reparseTotal}건
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
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
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{
                              width: `${(cleanupProgress.reparseTotal ?? 0) > 0 ? ((cleanupProgress.reparseProcessed ?? 0) / (cleanupProgress.reparseTotal ?? 1)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex gap-3 mt-2 text-xs tabular-nums">
                          <span className="text-success">
                            신규 {cleanupProgress.reparseCreated ?? 0}
                          </span>
                          <span className="text-blue-600 dark:text-blue-400">
                            수정 {cleanupProgress.reparseUpdated ?? 0}
                          </span>
                        </div>
                      </>
                    )}
                    {cleanupProgress.phase === "cleanup" && (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            2단계: 삭제 중… {cleanupProgress.deleted} /{" "}
                            {cleanupProgress.deletableTotal}건
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
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
                            className="h-full rounded-full bg-destructive transition-[width] duration-300"
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
                    {/* 다시 분석 결과 요약 */}
                    <div className="flex gap-4 mb-2 text-xs tabular-nums">
                      <span>
                        다시 분석: 신규 <strong>{cleanupResult.reparseCreated}</strong>건, 수정{" "}
                        <strong>{cleanupResult.reparseUpdated}</strong>건
                      </span>
                    </div>

                    {cleanupResult.dryRun ? (
                      <>
                        {/* 삭제 대상 요약 */}
                        <div className="flex items-center gap-2 mb-3 text-xs tabular-nums">
                          <span className="text-destructive">
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
                          <div className="flex items-center gap-2 text-xs text-success">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
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
                      <div className="flex items-center gap-2 text-xs text-success tabular-nums">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
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
              <div role="status" className="flex justify-center py-12">
                <Loader2
                  className="h-8 w-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">로딩 중…</span>
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
                      <NotificationLogRow
                        key={log.id}
                        log={log}
                        isDeleting={isDeleting}
                        onDelete={handleDeleteTransaction}
                      />
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
