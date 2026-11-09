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
import { useReturns } from "../hooks";
import { computeInflationAdjusted, formatKRW, pnlColorClass } from "../utils";

const INFLATION_OPTIONS = [
  { value: "0.02", label: "2%" },
  { value: "0.03", label: "3%" },
  { value: "0.04", label: "4%" },
  { value: "0.05", label: "5%" },
];

const MIN_DAYS = 7;

function formatDuration(years: number): string {
  const totalMonths = Math.round(years * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0 && m === 0) return "오늘";
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년`;
  return `${y}년 ${m}개월`;
}

/**
 * Real gain vs. inflation over the same tracked window as the returns card:
 * the starting total asset (RETURNS_EPOCH-anchored) and each inferred
 * deposit/withdrawal are inflated from their own dates, so later deposits are
 * a contribution to beat rather than profit.
 */
export function InflationAdjustedReturnCard() {
  const [inflationRate, setInflationRate] = useState(0.03);
  const { data, isLoading } = useReturns({});

  const result = useMemo(() => {
    if (!data?.startDate || !data.endDate || data.startValue <= 0) return null;
    return computeInflationAdjusted({
      startValue: data.startValue,
      startDate: data.startDate,
      endValue: data.endValue,
      endDate: data.endDate,
      cashflows: data.cashflows,
      inflationRate,
    });
  }, [data, inflationRate]);

  const tooNew = result !== null && result.years * 365.25 < MIN_DAYS;
  const netCashflow = result && data ? result.contributed - data.startValue : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">
          물가상승률 대비 실질 이득
        </CardTitle>
        <Select value={inflationRate.toString()} onValueChange={(v) => setInflationRate(Number(v))}>
          <SelectTrigger size="sm" className="h-8 w-[110px]" aria-label="물가 상승률">
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
        {isLoading && !data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">불러오는 중…</div>
        ) : !data || !result ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            스냅샷 데이터가 아직 없습니다
          </div>
        ) : tooNew ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            최소 1주일 이상 동기화된 데이터가 필요합니다
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">투입금액 (시작 자산 + 순입금)</div>
              <div className="text-lg font-bold mt-1 tabular-nums">
                {formatKRW(result.contributed)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {data.startDate} 총자산 {formatKRW(data.startValue, { compact: true })}
                {netCashflow !== 0 &&
                  ` · 이후 순입금 ${formatKRW(netCashflow, { compact: true, sign: true })}`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDuration(result.years)} 동안
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                물가 보정 시 ({(inflationRate * 100).toFixed(0)}% 가정)
              </div>
              <div className="text-lg font-bold mt-1 tabular-nums text-orange-600 dark:text-orange-400">
                {formatKRW(result.inflated)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                넣은 돈이 각각 넣은 날부터 물가만큼만 올랐다면
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">현재 자산</div>
              <div className="text-lg font-bold mt-1 tabular-nums">{formatKRW(data.endValue)}</div>
              <div
                className={`text-sm font-semibold mt-1 tabular-nums ${pnlColorClass(result.realGain)}`}
              >
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
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gain/10 text-gain">
                    물가 이김
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-loss/10 text-loss">
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
