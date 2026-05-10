"use client";

import { Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const DRIFT_THRESHOLD_PP = 5;

function buildColorMap(tickers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  tickers.forEach((t, i) => {
    map.set(t, CHART_COLORS[i % CHART_COLORS.length]);
  });
  return map;
}

interface DriftBarRow {
  ticker: string;
  name: string;
  color: string;
  beforePp: number; // current - target (음수=오버, 양수=언더)
  afterPp: number;
  improvedAbs: number; // |before| - |after| (양수면 개선)
}

/**
 * 종목별 편차를 0 기준 좌우 발산 막대로 표시.
 * 매수 전(진한) + 매수 후(옅은) 두 색상으로 효과 시각화.
 */
function DriftDivergingBars({ rows, hasCash }: { rows: DriftBarRow[]; hasCash: boolean }) {
  const maxAbs = Math.max(
    0.5,
    ...rows.map((r) => Math.max(Math.abs(r.beforePp), Math.abs(r.afterPp)))
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>← 과매수 (현재가 목표보다 큼)</span>
        <span>부족 (매수 필요) →</span>
      </div>
      <div className="border rounded-md p-3 space-y-2.5">
        {rows.map((r) => {
          const beforeWidthPct = (Math.abs(r.beforePp) / maxAbs) * 50;
          const afterWidthPct = (Math.abs(r.afterPp) / maxAbs) * 50;
          const beforeRight = r.beforePp >= 0;
          const afterRight = r.afterPp >= 0;
          return (
            <div key={r.ticker} className="grid grid-cols-[160px_1fr_90px] gap-2 items-center">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: r.color }}
                />
                <div className="text-sm truncate">{r.name}</div>
              </div>
              <div className="relative h-6">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                {/* 매수 전 (진한) */}
                <div
                  className="absolute top-0 h-3 rounded-sm"
                  style={{
                    width: `${beforeWidthPct}%`,
                    [beforeRight ? "left" : "right"]: "50%",
                    backgroundColor: beforeRight
                      ? "rgb(220 38 38 / 0.85)"
                      : "rgb(37 99 235 / 0.85)",
                  }}
                  title={`매수 전: ${r.beforePp >= 0 ? "+" : ""}${r.beforePp.toFixed(2)}%p`}
                />
                {/* 매수 후 (옅은) - hasCash일 때만 */}
                {hasCash && (
                  <div
                    className="absolute bottom-0 h-3 rounded-sm border"
                    style={{
                      width: `${afterWidthPct}%`,
                      [afterRight ? "left" : "right"]: "50%",
                      backgroundColor: afterRight
                        ? "rgb(220 38 38 / 0.25)"
                        : "rgb(37 99 235 / 0.25)",
                      borderColor: afterRight ? "rgb(220 38 38 / 0.5)" : "rgb(37 99 235 / 0.5)",
                    }}
                    title={`매수 후: ${r.afterPp >= 0 ? "+" : ""}${r.afterPp.toFixed(2)}%p`}
                  />
                )}
              </div>
              <div className="text-right text-xs">
                {hasCash ? (
                  <div>
                    <div className={pnlColorClass(-r.beforePp)}>
                      {r.beforePp >= 0 ? "+" : ""}
                      {r.beforePp.toFixed(2)}
                    </div>
                    <div className="text-muted-foreground">
                      → {r.afterPp >= 0 ? "+" : ""}
                      {r.afterPp.toFixed(2)}
                    </div>
                  </div>
                ) : (
                  <div className={pnlColorClass(-r.beforePp)}>
                    {r.beforePp >= 0 ? "+" : ""}
                    {r.beforePp.toFixed(2)}%p
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hasCash && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2.5 rounded-sm bg-blue-600/85" />
            매수 전
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2.5 rounded-sm bg-blue-600/25 border border-blue-600/50" />
            매수 후
          </div>
        </div>
      )}
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
    const tickers = [...rebalance.rows]
      .sort((a, b) => b.targetWeight - a.targetWeight)
      .map((r) => r.ticker);
    return buildColorMap(tickers);
  }, [rebalance]);

  const driftRows: DriftBarRow[] = useMemo(() => {
    if (!rebalance) return [];
    return rebalance.rows.map((r) => {
      const beforePp = (r.currentWeight - r.targetWeight) * 100;
      const afterPp = (r.afterWeight - r.targetWeight) * 100;
      return {
        ticker: r.ticker,
        name: r.name,
        color: colorMap.get(r.ticker) ?? "#cbd5e1",
        beforePp,
        afterPp,
        improvedAbs: Math.abs(beforePp) - Math.abs(afterPp),
      };
    });
  }, [rebalance, colorMap]);

  if (summary.accounts.length === 0) return null;

  const hasCash = cashToInvest > 0;

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
              {/* 추가 매수액 입력 + KPI */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
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
                <div className="flex gap-6 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">평균 편차</div>
                    {hasCash ? (
                      <div className="font-semibold mt-0.5">
                        {(rebalance.avgDriftBefore * 100).toFixed(2)}%p
                        <span className="text-muted-foreground mx-1">→</span>
                        <span
                          className={
                            rebalance.avgDriftAfter < rebalance.avgDriftBefore
                              ? "text-green-600 dark:text-green-400"
                              : ""
                          }
                        >
                          {(rebalance.avgDriftAfter * 100).toFixed(2)}%p
                        </span>
                      </div>
                    ) : (
                      <div className="font-semibold mt-0.5">
                        {(rebalance.avgDriftBefore * 100).toFixed(2)}%p
                      </div>
                    )}
                  </div>
                  {hasCash && (
                    <div>
                      <div className="text-xs text-muted-foreground">실제 매수</div>
                      <div className="font-semibold mt-0.5">
                        {formatKRW(rebalance.totalActualBuy, { compact: true })}
                        <span className="text-xs text-muted-foreground ml-1">
                          / {formatKRW(cashToInvest, { compact: true })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 다이버징 편차 바 차트 */}
              <DriftDivergingBars rows={driftRows} hasCash={hasCash} />

              {/* 통합 테이블 */}
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2">종목</th>
                      <th className="text-right px-3 py-2">현재 %</th>
                      <th className="text-right px-3 py-2">목표 %</th>
                      {hasCash && <th className="text-right px-3 py-2 bg-muted/30">매수 후 %</th>}
                      {hasCash && <th className="text-right px-3 py-2">매수금액</th>}
                      {hasCash && <th className="text-right px-3 py-2">주식 수</th>}
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
                                <div className="text-xs text-muted-foreground">
                                  {r.ticker}
                                  {r.status === "missing-price" && (
                                    <span className="ml-1 text-amber-600">⚠ 신규</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td
                            className={`text-right px-3 py-2 ${overThreshold ? "font-semibold" : ""}`}
                          >
                            {(r.currentWeight * 100).toFixed(2)}%
                          </td>
                          <td className="text-right px-3 py-2">
                            {(r.targetWeight * 100).toFixed(2)}%
                          </td>
                          {hasCash && (
                            <td className="text-right px-3 py-2 bg-muted/30 font-semibold">
                              {(r.afterWeight * 100).toFixed(2)}%
                            </td>
                          )}
                          {hasCash && (
                            <td className="text-right px-3 py-2 text-muted-foreground">
                              {r.actualBuyAmount > 0
                                ? formatKRW(r.actualBuyAmount, { compact: true })
                                : "—"}
                            </td>
                          )}
                          {hasCash && (
                            <td className="text-right px-3 py-2 font-semibold">
                              {r.status === "buy"
                                ? `${r.buyShares}주`
                                : r.status === "missing-price"
                                  ? "?"
                                  : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {hasCash && (
                <div className="text-xs text-muted-foreground">
                  잔여 현금{" "}
                  <span className="font-semibold text-foreground">
                    {formatKRW(rebalance.remainingCash, { compact: true })}
                  </span>{" "}
                  · 정수 주식 매수의 한계로 일부 잔액이 남을 수 있습니다
                </div>
              )}

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
