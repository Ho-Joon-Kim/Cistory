"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SummaryAccount, SummaryPosition, SummarySnapshot } from "../hooks";
import { ACCOUNT_TYPE_LABEL, CHART_COLORS, formatKRW } from "../utils";

interface Props {
  accounts: SummaryAccount[];
  latestSnapshots: SummarySnapshot[];
  positions: SummaryPosition[];
}

const TOP_N = 8;

interface SliceDatum {
  name: string;
  ticker: string;
  value: number;
  pct: number;
  fill: string;
}

export function AccountHoldingsPieChart({ accounts, latestSnapshots, positions }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id ?? "");

  const account = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0] ?? null;
  const snapshot = account
    ? (latestSnapshots.find((s) => s.accountId === account.id) ?? null)
    : null;

  const accountPositions = useMemo(() => {
    if (!snapshot) return [];
    return positions.filter((p) => p.snapshotId === snapshot.id);
  }, [positions, snapshot]);

  const data = useMemo<SliceDatum[]>(() => {
    if (accountPositions.length === 0) return [];
    const total = accountPositions.reduce((s, p) => s + p.evalAmount, 0);
    if (total <= 0) return [];

    const sorted = [...accountPositions].sort((a, b) => b.evalAmount - a.evalAmount);
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);

    const slices: SliceDatum[] = top.map((p, i) => ({
      name: p.name || p.ticker,
      ticker: p.ticker,
      value: p.evalAmount,
      pct: (p.evalAmount / total) * 100,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));

    if (rest.length > 0) {
      const restSum = rest.reduce((s, p) => s + p.evalAmount, 0);
      slices.push({
        name: `기타 (${rest.length}종)`,
        ticker: "_other",
        value: restSum,
        pct: (restSum / total) * 100,
        fill: "#cbd5e1",
      });
    }

    return slices;
  }, [accountPositions]);

  if (accounts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">
          계좌별 종목 비중
        </CardTitle>
        {accounts.length > 1 ? (
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger size="sm" className="h-8 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                  <span className="text-xs text-muted-foreground ml-1">
                    {ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          account && (
            <div className="text-sm text-muted-foreground">
              {account.label}
              <span className="ml-2 text-xs">
                {ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType}
              </span>
            </div>
          )
        )}
      </CardHeader>
      <CardContent>
        {!snapshot ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            동기화된 데이터가 없습니다
          </div>
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            보유 종목이 없습니다
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="relative flex-shrink-0">
              <ChartContainer config={{}} className="h-[260px] w-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <ChartTooltip
                      content={<ChartTooltipContent hideLabel />}
                      formatter={(value: number) => formatKRW(value)}
                    />
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={80}
                      outerRadius={120}
                      strokeWidth={2}
                      startAngle={90}
                      endAngle={-270}
                    >
                      {data.map((d) => (
                        <Cell key={d.ticker} fill={d.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-xl font-bold">
                  {formatKRW(snapshot.totalEvalAmount, { compact: true })}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  총 {accountPositions.length}종목
                </div>
              </div>
            </div>
            <div className="flex-1 w-full space-y-1.5 max-h-[260px] overflow-y-auto pr-2">
              {data.map((d) => (
                <div key={d.ticker} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: d.fill }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    {d.ticker !== "_other" && (
                      <div className="text-xs text-muted-foreground">{d.ticker}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{d.pct.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">
                      {formatKRW(d.value, { compact: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
