"use client";

import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SummaryAccount } from "../hooks";
import { useReturns } from "../hooks";
import { formatKRW, pnlColorClass } from "../utils";

interface Props {
  accounts: SummaryAccount[];
}

const RANGES = [
  { key: "all", label: "전체", days: null },
  { key: "30", label: "30일", days: 30 },
  { key: "90", label: "90일", days: 90 },
  { key: "365", label: "1년", days: 365 },
] as const;

function ymdAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtPct(value: number | null, fractionDigits = 2): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(fractionDigits)}%`;
}

function pctColorClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return pnlColorClass(v);
}

export function ReturnsCard({ accounts }: Props) {
  const [accountId, setAccountId] = useState<string>("all");
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("all");
  const [showCashflows, setShowCashflows] = useState(false);

  const params = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey);
    return {
      accountId: accountId === "all" ? undefined : accountId,
      from: range?.days ? ymdAgo(range.days) : undefined,
    };
  }, [accountId, rangeKey]);

  const { data, isLoading } = useReturns(params);

  const hasData = data && data.twr.totalReturn !== null;
  const shortPeriod = data && data.twr.days < 30;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium text-muted-foreground">
            적립식 수익률
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground">
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                <p>
                  <b>TWR</b>: 입금 타이밍을 제거한 순수 운용 성과. 펀드/벤치마크와 비교할 때 사용.
                </p>
                <p className="mt-1">
                  <b>XIRR</b>: 현금흐름까지 반영한 실제 체감 수익률(연환산 IRR).
                </p>
                <p className="mt-1 text-muted-foreground">
                  입금/출금은 매일 스냅샷의 예수금·매입금액 변화로 추정합니다.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger size="sm" className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 계좌</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={rangeKey === r.key ? "default" : "outline"}
                onClick={() => setRangeKey(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">불러오는 중…</div>
        ) : !hasData ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            계산에 필요한 스냅샷 데이터가 부족합니다 (2일 이상 필요)
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">TWR (누적)</div>
                <div className={`text-2xl font-bold mt-1 ${pctColorClass(data.twr.totalReturn)}`}>
                  {fmtPct(data.twr.totalReturn)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {data.startDate} → {data.endDate} ({Math.round(data.twr.days)}일)
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">TWR (연환산)</div>
                <div
                  className={`text-2xl font-bold mt-1 ${pctColorClass(data.twr.annualizedReturn)}`}
                >
                  {fmtPct(data.twr.annualizedReturn)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {shortPeriod ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      기간이 짧아 변동성 큼
                    </Badge>
                  ) : (
                    "Time-Weighted Return"
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">XIRR (연환산)</div>
                <div className={`text-2xl font-bold mt-1 ${pctColorClass(data.xirr)}`}>
                  {fmtPct(data.xirr)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Money-Weighted Return</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <div>
                시작 총자산: <span className="font-medium">{formatKRW(data.startValue)}</span>
              </div>
              <div>
                현재 총자산: <span className="font-medium">{formatKRW(data.endValue)}</span>
              </div>
              <div>
                추정 현금흐름 합계:{" "}
                <span className="font-medium">
                  {formatKRW(
                    data.cashflows.reduce((s, c) => s + c.amount, 0),
                    { sign: true }
                  )}
                </span>
              </div>
            </div>

            {data.cashflows.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowCashflows((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showCashflows ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  감지된 현금흐름 {data.cashflows.length}건
                </button>
                {showCashflows && (
                  <div className="mt-2 space-y-1 text-xs">
                    {data.cashflows.map((cf) => (
                      <div
                        key={`${cf.date}-${cf.amount}`}
                        className="flex justify-between items-center py-1 border-b last:border-b-0"
                      >
                        <span className="text-muted-foreground">{cf.date}</span>
                        <span className={`font-medium ${pnlColorClass(cf.amount)}`}>
                          {cf.amount > 0 ? "입금 " : "출금 "}
                          {formatKRW(Math.abs(cf.amount), { compact: true })}
                        </span>
                      </div>
                    ))}
                    <p className="pt-1 text-[10px] text-muted-foreground">
                      예수금·매입금액 변화로 역산한 추정치입니다. 배당/이자/수수료가 큰 경우 1~2%
                      노이즈가 섞일 수 있습니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
