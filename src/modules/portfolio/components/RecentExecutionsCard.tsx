"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExecutions } from "../hooks";
import { formatKRW, pnlColorClass } from "../utils";

function formatDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function RecentExecutionsCard({ limit = 15 }: { limit?: number }) {
  const { executions, isLoading } = useExecutions({ limit });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          최근 체결 내역
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">불러오는 중…</div>
        ) : executions.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">체결 내역이 없습니다</div>
        ) : (
          <div className="space-y-2">
            {executions.map((e) => {
              const sideLabel = e.side === "buy" ? "매수" : "매도";
              const sideColor =
                e.side === "buy"
                  ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30"
                  : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30";
              return (
                <div key={e.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="text-xs text-muted-foreground tabular-nums w-24 flex-shrink-0">
                    {formatDate(e.ordDt)}
                  </div>
                  <div
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${sideColor} flex-shrink-0`}
                  >
                    {sideLabel}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.accountLabel} · {e.filledQty.toLocaleString()}주 @{" "}
                      {e.avgPrice.toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums flex-shrink-0 ${pnlColorClass(
                      e.side === "buy" ? -1 : 1
                    )}`}
                  >
                    {formatKRW(e.filledAmount, { compact: true })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
