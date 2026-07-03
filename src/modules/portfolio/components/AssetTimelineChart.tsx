"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSnapshots } from "../hooks";
import { formatKRW, parseKstDate } from "../utils";
import { toLocalDateString } from "@/lib/utils";

const RANGES = [
  { key: "30", label: "30일", days: 30 },
  { key: "90", label: "90일", days: 90 },
  { key: "365", label: "1년", days: 365 },
] as const;

const INFLATION_OPTIONS = [
  { value: "0.02", label: "2%" },
  { value: "0.03", label: "3%" },
  { value: "0.04", label: "4%" },
  { value: "0.05", label: "5%" },
];

function ymdAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalDateString(d);
}

interface AggregatedPoint {
  date: string;
  total: number;
  purchase: number;
  pnl: number;
  inflated?: number;
}

export function AssetTimelineChart() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");
  const [inflationRate, setInflationRate] = useState(0.03);
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const { snapshots, isLoading } = useSnapshots({ from: ymdAgo(days) });

  const data = useMemo(() => {
    const byDate = new Map<string, AggregatedPoint>();
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
    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length > 1) {
      const first = sorted[0];
      const startMs = parseKstDate(first.date).getTime();
      const startPurchase = first.purchase;
      for (const row of sorted) {
        const yrs = (parseKstDate(row.date).getTime() - startMs) / (365.25 * 86_400_000);
        row.inflated = startPurchase * (1 + inflationRate) ** yrs;
      }
    }

    return sorted;
  }, [snapshots, inflationRate]);

  const showInflation = data.length > 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">자산 추이</CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={inflationRate.toString()}
            onValueChange={(v) => setInflationRate(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INFLATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  물가 {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <ChartContainer config={{}} className="h-[200px] md:h-[260px] w-full">
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
                            : name === "inflated"
                              ? "물가 보정 매입액"
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
                {showInflation && (
                  <Area
                    type="monotone"
                    dataKey="inflated"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    fillOpacity={0}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
