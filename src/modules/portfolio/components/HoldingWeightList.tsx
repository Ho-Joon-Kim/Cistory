"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SummaryPosition } from "../hooks";
import { formatKRW, formatPercent, pnlColorClass } from "../utils";

interface Props {
  positions: SummaryPosition[];
  topN?: number;
}

export function HoldingWeightList({ positions, topN = 10 }: Props) {
  const aggregated = useMemo(() => {
    // Aggregate positions across accounts by ticker, weighted by KRW
    const map = new Map<
      string,
      { ticker: string; name: string; evalAmount: number; pnl: number; pnlRate: number | null }
    >();
    for (const p of positions) {
      const existing = map.get(p.ticker);
      if (existing) {
        existing.evalAmount += p.evalAmount;
        existing.pnl += p.pnl;
      } else {
        map.set(p.ticker, {
          ticker: p.ticker,
          name: p.name,
          evalAmount: p.evalAmount,
          pnl: p.pnl,
          pnlRate: p.pnlRate,
        });
      }
    }
    const total = Array.from(map.values()).reduce((s, p) => s + p.evalAmount, 0);
    return Array.from(map.values())
      .map((p) => ({ ...p, weight: total > 0 ? p.evalAmount / total : 0 }))
      .sort((a, b) => b.evalAmount - a.evalAmount)
      .slice(0, topN);
  }, [positions, topN]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">종목별 비중</CardTitle>
      </CardHeader>
      <CardContent>
        {aggregated.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">데이터가 없습니다</div>
        ) : (
          <div className="space-y-2">
            {aggregated.map((p) => (
              <div key={p.ticker} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="flex-shrink-0 font-semibold tabular-nums">
                    {(p.weight * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <div>{p.ticker}</div>
                  <div className="flex gap-2">
                    <span>{formatKRW(p.evalAmount, { compact: true })}</span>
                    <span className={pnlColorClass(p.pnl)}>{formatPercent(p.pnlRate)}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${p.weight * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
