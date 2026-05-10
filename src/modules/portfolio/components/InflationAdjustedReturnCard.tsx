"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortfolioSummary, SnapshotPoint } from "../hooks";
import { useSnapshots } from "../hooks";
import { computeInflationAdjusted, formatKRW, pnlColorClass } from "../utils";

interface Props {
  summary: PortfolioSummary;
}

const INFLATION_OPTIONS = [
  { value: "0.02", label: "2%" },
  { value: "0.03", label: "3%" },
  { value: "0.04", label: "4%" },
  { value: "0.05", label: "5%" },
];

const MIN_DAYS = 7;

function pickEarliestPerAccount(snapshots: SnapshotPoint[]): SnapshotPoint[] {
  const earliest = new Map<string, SnapshotPoint>();
  for (const s of snapshots) {
    const prev = earliest.get(s.accountId);
    if (!prev || s.asOfDate < prev.asOfDate) earliest.set(s.accountId, s);
  }
  return Array.from(earliest.values());
}

function formatDuration(years: number): string {
  const totalMonths = Math.round(years * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0 && m === 0) return "오늘";
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년`;
  return `${y}년 ${m}개월`;
}

export function InflationAdjustedReturnCard({ summary }: Props) {
  const [inflationRate, setInflationRate] = useState(0.03);
  const { snapshots, isLoading } = useSnapshots({ from: "2020-01-01" });

  const baseline = useMemo(() => {
    if (snapshots.length === 0) return null;
    const earliest = pickEarliestPerAccount(snapshots);
    if (earliest.length === 0) return null;
    const startPurchase = earliest.reduce((s, x) => s + x.totalPurchaseAmount, 0);
    const startDate = earliest.reduce(
      (min, x) => (x.asOfDate < min ? x.asOfDate : min),
      earliest[0].asOfDate
    );
    return { startPurchase, startDate };
  }, [snapshots]);

  const currentTotal = summary.totals?.totalEvalAmount ?? 0;
  const currentPurchase = summary.totals?.totalPurchaseAmount ?? 0;

  const result = useMemo(() => {
    if (!baseline || baseline.startPurchase <= 0) return null;
    return computeInflationAdjusted({
      startPurchase: baseline.startPurchase,
      startDate: baseline.startDate,
      currentTotal,
      inflationRate,
    });
  }, [baseline, currentTotal, inflationRate]);

  const tooNew = (() => {
    if (!result) return false;
    return result.years * 365.25 < MIN_DAYS;
  })();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">
          물가상승률 대비 실질 이득
        </CardTitle>
        <Select value={inflationRate.toString()} onValueChange={(v) => setInflationRate(Number(v))}>
          <SelectTrigger size="sm" className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INFLATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                연 {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading && snapshots.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">불러오는 중…</div>
        ) : !baseline ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            스냅샷 데이터가 아직 없습니다
          </div>
        ) : !result ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            매입금액 정보가 없어 계산할 수 없습니다
          </div>
        ) : tooNew ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            최소 1주일 이상 동기화된 데이터가 필요합니다
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">투입금액 (시작 매입액)</div>
              <div className="text-lg font-bold mt-1">{formatKRW(baseline.startPurchase)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {baseline.startDate} 이후 {formatDuration(result.years)} 보유
              </div>
              {currentPurchase !== baseline.startPurchase && (
                <div className="text-xs text-muted-foreground mt-1">
                  현재 매입액 {formatKRW(currentPurchase, { compact: true })}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                물가 보정 시 ({(inflationRate * 100).toFixed(0)}% 가정)
              </div>
              <div className="text-lg font-bold mt-1 text-orange-600 dark:text-orange-400">
                {formatKRW(result.inflated)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                같은 돈을 그냥 묻어뒀으면 이만큼이 됐어야 함
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">현재 자산</div>
              <div className="text-lg font-bold mt-1">{formatKRW(currentTotal)}</div>
              <div className={`text-sm font-semibold mt-1 ${pnlColorClass(result.realGain)}`}>
                실질 {result.realGain >= 0 ? "+" : ""}
                {formatKRW(result.realGain, { compact: true })}
                {result.realGainRate !== null && (
                  <span className="ml-1">
                    ({result.realGainRate >= 0 ? "+" : ""}
                    {result.realGainRate.toFixed(2)}%)
                  </span>
                )}
              </div>
              <div className="mt-2">
                {result.outperformedInflation ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                    물가 이김
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    물가 못 이김
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
