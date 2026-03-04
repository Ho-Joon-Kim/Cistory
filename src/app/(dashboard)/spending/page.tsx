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
import { useTransactions } from "@/modules/spending/hooks";
import type { SpendingFilters } from "@/modules/spending/hooks";
import { Header } from "@/components/Layout/Header";
import { Loader2, Wallet, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDate } from "@/lib/utils";

function getDefaultDateRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().split("T")[0];
  return { from, to };
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

export default function SpendingPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const defaultRange = getDefaultDateRange();
  const [filters, setFilters] = useState<SpendingFilters>({
    from: defaultRange.from,
    to: defaultRange.to,
  });

  const { transactions, summary, isLoading, hasMore, loadMore } = useTransactions({
    filters,
    enabled: isAuthenticated,
  });

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
        <div className="flex flex-wrap items-center gap-3 mb-6">
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
        </div>

        {/* 거래 내역 리스트 */}
        {isLoading && transactions.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : transactions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>소비 내역이 없습니다.</p>
              <p className="text-sm mt-2">
                설정에서 Toss 알림 연동을 확인해주세요.
              </p>
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

            {/* 더 보기 */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <Button variant="outline" onClick={loadMore} disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  더 보기
                </Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
