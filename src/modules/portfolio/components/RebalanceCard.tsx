"use client";

import { Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortfolioSummary, SummaryAccount, SummaryPosition } from "../hooks";
import { useTargetAllocations } from "../hooks";
import {
  ACCOUNT_TYPE_LABEL,
  CHART_COLORS,
  computeRebalance,
  formatKRW,
  pnlColorClass,
} from "../utils";
import { TargetAllocationEditor } from "./TargetAllocationEditor";

interface Props {
  summary: PortfolioSummary;
}

const DRIFT_THRESHOLD_PP = 5; // 5%p 절대 편차 시 강조

interface ColoredSlice {
  ticker: string;
  name: string;
  value: number;
  fill: string;
}

function buildColorMap(tickers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  tickers.forEach((t, i) => {
    map.set(t, CHART_COLORS[i % CHART_COLORS.length]);
  });
  return map;
}

function MiniDonut({
  title,
  total,
  slices,
}: {
  title: string;
  total: number;
  slices: ColoredSlice[];
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <div className="relative">
        <ChartContainer config={{}} className="h-[160px] w-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent hideLabel />}
                formatter={(v: number) => formatKRW(v)}
              />
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={75}
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
              >
                {slices.map((s) => (
                  <Cell key={s.ticker} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-sm font-semibold">{formatKRW(total, { compact: true })}</div>
        </div>
      </div>
    </div>
  );
}

export function RebalanceCard({ summary }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(summary.accounts[0]?.id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");

  const account: SummaryAccount | null =
    summary.accounts.find((a) => a.id === selectedAccountId) ?? summary.accounts[0] ?? null;
  const snapshot = account
    ? (summary.latestSnapshots.find((s) => s.accountId === account.id) ?? null)
    : null;

  const accountPositions: SummaryPosition[] = useMemo(() => {
    if (!snapshot) return [];
    return summary.positions.filter((p) => p.snapshotId === snapshot.id);
  }, [summary.positions, snapshot]);

  const {
    targets,
    isLoading: targetsLoading,
    refresh: refreshTargets,
  } = useTargetAllocations(account?.id ?? null);

  const totalEval = snapshot?.totalEvalAmount ?? 0;

  const cashToInvest = Math.max(0, Number(cashInput) || 0);

  const rebalance = useMemo(() => {
    if (targets.length === 0 || !snapshot) return null;
    return computeRebalance({
      positions: accountPositions.map((p) => ({
        ticker: p.ticker,
        name: p.name,
        quantity: p.quantity,
        currentPrice: p.currentPrice,
        evalAmount: p.evalAmount,
      })),
      targets,
      cashToInvest,
    });
  }, [accountPositions, targets, cashToInvest, snapshot]);

  const colorMap = useMemo(() => {
    if (!rebalance) return new Map<string, string>();
    // 색상 매핑: 목표 비중이 큰 순서대로 (현재/목표 도넛이 같은 색)
    const tickers = [...rebalance.rows]
      .sort((a, b) => b.targetWeight - a.targetWeight)
      .map((r) => r.ticker);
    return buildColorMap(tickers);
  }, [rebalance]);

  const currentSlices: ColoredSlice[] = useMemo(() => {
    if (!rebalance) return [];
    return rebalance.rows
      .filter((r) => r.currentEval > 0)
      .map((r) => ({
        ticker: r.ticker,
        name: r.name,
        value: r.currentEval,
        fill: colorMap.get(r.ticker) ?? "#cbd5e1",
      }));
  }, [rebalance, colorMap]);

  const targetSlices: ColoredSlice[] = useMemo(() => {
    if (!rebalance) return [];
    const totalAfter = rebalance.totalAfter;
    return rebalance.rows
      .filter((r) => r.targetWeight > 0)
      .map((r) => ({
        ticker: r.ticker,
        name: r.name,
        value: r.targetWeight * totalAfter,
        fill: colorMap.get(r.ticker) ?? "#cbd5e1",
      }));
  }, [rebalance, colorMap]);

  if (summary.accounts.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium text-muted-foreground">
            목표 비중 · 리밸런싱
          </CardTitle>
          <div className="flex items-center gap-2">
            {summary.accounts.length > 1 && (
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger size="sm" className="h-8 w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {summary.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                      <span className="text-xs text-muted-foreground ml-1">
                        {ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditorOpen(true)}
              disabled={!account}
            >
              <Settings2 className="h-4 w-4 mr-1" />
              목표 설정
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!snapshot ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              동기화된 데이터가 없습니다
            </div>
          ) : targetsLoading && targets.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">불러오는 중…</div>
          ) : targets.length === 0 ? (
            <div className="border-2 border-dashed rounded-md p-8 text-center">
              <div className="text-sm text-muted-foreground mb-3">
                이 계좌의 목표 비중이 아직 설정되지 않았습니다
              </div>
              <Button onClick={() => setEditorOpen(true)}>목표 비중 설정하기</Button>
            </div>
          ) : !rebalance ? null : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <MiniDonut title="현재 비중" total={totalEval} slices={currentSlices} />
                <MiniDonut
                  title={
                    cashToInvest > 0
                      ? `목표 비중 (+${formatKRW(cashToInvest, { compact: true })} 매수 후)`
                      : "목표 비중"
                  }
                  total={rebalance.totalAfter}
                  slices={targetSlices}
                />
              </div>

              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2">종목</th>
                      <th className="text-right px-3 py-2">현재 %</th>
                      <th className="text-right px-3 py-2">목표 %</th>
                      <th className="text-right px-3 py-2">편차 (%p)</th>
                      <th className="text-right px-3 py-2">필요 매수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalance.rows.map((r) => {
                      const driftPp = (r.targetWeight - r.currentWeight) * 100;
                      const overThreshold = Math.abs(driftPp) >= DRIFT_THRESHOLD_PP;
                      return (
                        <tr key={r.ticker} className="border-b last:border-b-0">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: colorMap.get(r.ticker) }}
                              />
                              <div>
                                <div className="font-medium">{r.name}</div>
                                <div className="text-xs text-muted-foreground">{r.ticker}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-right px-3 py-2">
                            {(r.currentWeight * 100).toFixed(2)}%
                          </td>
                          <td className="text-right px-3 py-2">
                            {(r.targetWeight * 100).toFixed(2)}%
                          </td>
                          <td
                            className={`text-right px-3 py-2 ${
                              overThreshold ? "font-semibold" : ""
                            } ${pnlColorClass(driftPp)}`}
                          >
                            {driftPp >= 0 ? "+" : ""}
                            {driftPp.toFixed(2)}
                          </td>
                          <td className="text-right px-3 py-2 text-muted-foreground">
                            {r.buyAmount > 0 ? formatKRW(r.buyAmount, { compact: true }) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border rounded-md p-4 space-y-3">
                <div>
                  <label htmlFor="cash-to-invest" className="text-sm font-medium block mb-1.5">
                    추가 매수액 (원)
                  </label>
                  <Input
                    id="cash-to-invest"
                    type="number"
                    min="0"
                    step="10000"
                    value={cashInput}
                    onChange={(e) => setCashInput(e.target.value)}
                    placeholder="예: 1000000"
                    className="max-w-[260px]"
                  />
                </div>

                {cashToInvest > 0 && (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="text-left px-3 py-2">종목</th>
                            <th className="text-right px-3 py-2">현재가</th>
                            <th className="text-right px-3 py-2">매수금액</th>
                            <th className="text-right px-3 py-2">매수 주식 수</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rebalance.rows
                            .filter((r) => r.status === "buy" || r.status === "missing-price")
                            .map((r) => (
                              <tr key={r.ticker} className="border-b last:border-b-0">
                                <td className="px-3 py-2">
                                  <div className="font-medium">{r.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {r.ticker}
                                    {r.status === "missing-price" && (
                                      <span className="ml-1 text-amber-600">⚠ 신규 종목</span>
                                    )}
                                  </div>
                                </td>
                                <td className="text-right px-3 py-2">
                                  {r.currentPrice > 0 ? formatKRW(r.currentPrice) : "—"}
                                </td>
                                <td className="text-right px-3 py-2">
                                  {r.status === "buy"
                                    ? formatKRW(r.actualBuyAmount)
                                    : formatKRW(r.buyAmount)}
                                </td>
                                <td className="text-right px-3 py-2 font-semibold">
                                  {r.status === "buy" ? `${r.buyShares}주` : "?"}
                                </td>
                              </tr>
                            ))}
                          {rebalance.rows.every(
                            (r) => r.status !== "buy" && r.status !== "missing-price"
                          ) && (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-3 py-4 text-center text-muted-foreground text-xs"
                              >
                                추가 매수가 필요한 종목이 없습니다
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-sm border-t pt-3">
                      <div className="text-muted-foreground">
                        총 매수액 {formatKRW(rebalance.totalActualBuy, { compact: true })} · 잔여
                        현금{" "}
                        <span className="font-semibold">
                          {formatKRW(rebalance.remainingCash, { compact: true })}
                        </span>
                      </div>
                    </div>

                    {rebalance.warnings.length > 0 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 space-y-1">
                        {rebalance.warnings.map((w) => (
                          <div key={w}>• {w}</div>
                        ))}
                        <div className="text-muted-foreground">
                          신규 종목은 첫 매수 후 자동 동기화되면 수량을 정확히 계산할 수 있습니다
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {account && (
        <TargetAllocationEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          account={account}
          currentPositions={accountPositions}
          initialTargets={targets}
          onSaved={refreshTargets}
        />
      )}
    </>
  );
}
