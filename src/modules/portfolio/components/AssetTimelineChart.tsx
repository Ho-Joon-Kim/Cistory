"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useSnapshots } from "../hooks";
import { formatKRW } from "../utils";

const RANGES = [
  { key: "30", label: "30일", days: 30 },
  { key: "90", label: "90일", days: 90 },
  { key: "365", label: "1년", days: 365 },
] as const;

function ymdAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function AssetTimelineChart() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const { snapshots, isLoading } = useSnapshots({ from: ymdAgo(days) });

  // Aggregate by date across accounts
  const data = useMemo(() => {
    const byDate = new Map<string, { date: string; total: number; purchase: number; pnl: number }>();
    for (const s of snapshots) {
      const existing = byDate.get(s.asOfDate) ?? {
        date: s.asOfDate,
        total: 0,
        purchase: 0,
        pnl: 0,
      };
      existing.total += s.totalEvalAmount;
      existing.purchase += s.totalPurchaseAmount;
      existing.pnl += s.totalPnl;
      byDate.set(s.asOfDate, existing);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [snapshots]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-medium text-muted-foreground">자산 추이</CardTitle>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? "default" : "outline"}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">불러오는 중…</div>
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            스냅샷 데이터가 아직 없습니다
          </div>
        ) : (
          <ChartContainer config={{}} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    v >= 100_000_000
                      ? `${Math.round(v / 100_000_000)}억`
                      : v >= 10000
                        ? `${Math.round(v / 10000)}만`
                        : String(v)
                  }
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => [
                        formatKRW(Number(value)),
                        name === "total"
                          ? "총자산"
                          : name === "purchase"
                            ? "매입금액"
                            : String(name),
                      ]}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#totalGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="purchase"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
