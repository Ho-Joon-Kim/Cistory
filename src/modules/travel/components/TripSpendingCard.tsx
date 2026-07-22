import { ReceiptText, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isExpenseCategory, SPENDING_CATEGORY_LABELS } from "@/modules/spending/categories";
import { formatWon } from "../format";
import type { TravelTripDetail } from "../hooks";

type TripSpending = TravelTripDetail["spending"];

const KST_TRANSACTION_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getCategoryLabel(category: string | null): string {
  if (!category || category === "uncategorized") return SPENDING_CATEGORY_LABELS.uncategorized;
  return isExpenseCategory(category) ? SPENDING_CATEGORY_LABELS[category] : category;
}

function formatKstTransactionTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "시간 정보 없음" : KST_TRANSACTION_FORMATTER.format(date);
}

export function TripSpendingCard({ spending }: { spending: TripSpending }) {
  const categories = [...spending.categories].sort(
    (left, right) => right.total - left.total || left.category.localeCompare(right.category)
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4" aria-hidden="true" />
          지출
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs text-muted-foreground">총비용</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatWon(spending.total)}</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs text-muted-foreground">1일 평균</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatWon(spending.dailyAverage)}
            </p>
          </div>
        </div>

        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">지출 내역이 없습니다</p>
        ) : (
          <ul className="space-y-3" aria-label="카테고리별 지출">
            {categories.map((category) => (
              <li
                key={category.category}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>
                  {getCategoryLabel(category.category)}
                  <span className="ml-1 text-xs text-muted-foreground">{category.count}건</span>
                </span>
                <span className="font-medium tabular-nums">{formatWon(category.total)}</span>
              </li>
            ))}
          </ul>
        )}

        {spending.transactions.length > 0 ? (
          <details className="group border-t pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              개별 거래 {spending.transactions.length}건
            </summary>
            <ul className="mt-4 space-y-3">
              {spending.transactions.map((transaction) => (
                <li key={transaction.id} className="flex items-start justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{transaction.merchant || "사용처 미상"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatKstTransactionTime(transaction.transactedAt)} ·{" "}
                      {transaction.accountName}
                      {" · "}
                      {getCategoryLabel(transaction.category)}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatWon(transaction.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
