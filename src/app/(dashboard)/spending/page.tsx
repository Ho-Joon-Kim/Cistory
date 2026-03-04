"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequireAuth } from "@/modules/auth/hooks";
import { useTransactions, useNotificationLogs, useReparse } from "@/modules/spending/hooks";
import type { SpendingFilters, ReparseItem } from "@/modules/spending/hooks";
import { Header } from "@/components/Layout/Header";
import {
  Loader2,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  RefreshCw,
  Check,
  X,
  Plus,
  Pencil,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

type Tab = "transactions" | "notifications";

function getDefaultDateRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().split("T")[0];
  return { from, to };
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR");
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

export default function SpendingPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const defaultRange = getDefaultDateRange();
  const [tab, setTab] = useState<Tab>("transactions");
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

  const { preview, apply, result: reparseResult, isLoading: reparseLoading, clear: clearReparse } =
    useReparse();

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

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">총 출금</p>
              <p className="text-lg font-semibold text-red-500">
                {formatAmount(summary.totalWithdrawal)}원
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">총 입금</p>
              <p className="text-lg font-semibold text-green-500">
                {formatAmount(summary.totalDeposit)}원
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">출금 건수</p>
              <p className="text-lg font-semibold">{summary.withdrawalCount}건</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">입금 건수</p>
              <p className="text-lg font-semibold">{summary.depositCount}건</p>
            </CardContent>
          </Card>
        </div>

        {/* 필터 */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="date"
            value={filters.from || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          />
          <span className="text-sm text-muted-foreground">~</span>
          <input
            type="date"
            value={filters.to || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
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
              <SelectTrigger className="w-[100px]">
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
            {logsTotal > 0 && (
              <span className="text-xs text-muted-foreground">({logsTotal})</span>
            )}
          </button>
        </div>

        {/* 거래내역 탭 */}
        {tab === "transactions" && (
          <>
            {isLoading && transactions.length === 0 ? (
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
              <div className="grid gap-2">
                {transactions.map((tx) => (
                  <Card key={tx.id}>
                    <CardContent className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0">
                            {tx.type === "withdrawal" ? (
                              <ArrowUpRight className="h-4 w-4 text-red-500" />
                            ) : (
                              <ArrowDownLeft className="h-4 w-4 text-green-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{tx.merchant}</p>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {tx.type === "withdrawal" ? "출금" : "입금"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {tx.accountName} · {formatDate(tx.transactedAt)}
                            </p>
                          </div>
                        </div>
                        <p
                          className={`text-sm font-semibold flex-shrink-0 ${
                            tx.type === "withdrawal" ? "text-red-500" : "text-green-500"
                          }`}
                        >
                          {tx.type === "withdrawal" ? "-" : "+"}
                          {formatAmount(tx.amount)}원
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {hasMore && (
                  <div className="flex justify-center py-4">
                    <Button variant="outline" onClick={loadMore} disabled={isLoading}>
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      더 보기
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 원본 알림 탭 */}
        {tab === "notifications" && (
          <>
            {/* 재파싱 섹션 */}
            <Card className="mb-4">
              <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">알림 재파싱</p>
                    <p className="text-xs text-muted-foreground">
                      파서가 업데이트된 경우, 기존 알림을 다시 파싱하여 누락된 거래를 복구합니다.
                    </p>
                  </div>
                  {!reparseResult ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={preview}
                      disabled={reparseLoading}
                    >
                      {reparseLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                      )}
                      미리보기
                    </Button>
                  ) : reparseResult.dryRun ? (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={clearReparse}>
                        취소
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={reparseLoading || reparseResult.created === 0}
                      >
                        {reparseLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <Check className="h-4 w-4 mr-1.5" />
                        )}
                        적용 ({reparseResult.created}건 신규)
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={clearReparse}>
                      닫기
                    </Button>
                  )}
                </div>

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

                    {/* 무시된 항목 요약 (접기/펼치기 없이 개수만) */}
                    {reparseResult.skipped > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        + {reparseResult.skipped}건 무시됨 (파싱 불가 또는 중복)
                      </p>
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
              <div className="grid gap-2">
                {logs.map((log) => (
                  <Card key={log.id}>
                    <CardContent className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium truncate">
                              {log.title || "(제목 없음)"}
                            </p>
                            <Badge
                              variant={log.parsed ? "secondary" : "outline"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {log.parsed ? "파싱됨" : "미파싱"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {log.text || "(내용 없음)"}
                          </p>
                          <p className="text-[11px] text-muted-foreground/70 mt-1">
                            {formatDate(log.receivedAt)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {logsHasMore && (
                  <div className="flex justify-center py-4">
                    <Button variant="outline" onClick={logsLoadMore} disabled={logsLoading}>
                      {logsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      더 보기
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
