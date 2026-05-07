"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SummaryPosition } from "../hooks";
import { formatKRW, inferCategory } from "../utils";

interface Props {
  positions: SummaryPosition[];
}

export function CategoryBreakdown({ positions }: Props) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    for (const p of positions) {
      const cat = inferCategory(p.name);
      map.set(cat, (map.get(cat) ?? 0) + p.evalAmount);
      total += p.evalAmount;
    }
    return Array.from(map.entries())
      .map(([category, value]) => ({
        category,
        value,
        weight: total > 0 ? value / total : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          카테고리별 비중
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">데이터가 없습니다</div>
        ) : (
          <div className="space-y-3">
            {data.map((d) => (
              <div key={d.category} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <div className="font-medium">{d.category}</div>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>{formatKRW(d.value, { compact: true })}</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {(d.weight * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${d.weight * 100}%` }}
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
