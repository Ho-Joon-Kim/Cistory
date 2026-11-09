"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKRW, formatPercent, pnlColorClass } from "../utils";

interface Props {
  totalEval: number;
  deposit: number;
  pnl: number;
  pnlRate: number;
  prevDayTotalAsset: number | null;
  assetIcdc: number | null;
  accountCount: number;
  positionCount: number;
}

export function PortfolioOverviewCard(props: Props) {
  const dailyChangeRate =
    props.prevDayTotalAsset && props.assetIcdc
      ? (props.assetIcdc / props.prevDayTotalAsset) * 100
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">총 자산</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {formatKRW(props.totalEval)}
          </div>
          {props.assetIcdc !== null && (
            <div className={`text-sm mt-1 tabular-nums ${pnlColorClass(props.assetIcdc)}`}>
              {props.assetIcdc > 0 ? "▲" : props.assetIcdc < 0 ? "▼" : "—"}{" "}
              {formatKRW(props.assetIcdc, { sign: true })}{" "}
              {dailyChangeRate !== null && `(${formatPercent(dailyChangeRate)})`}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 pt-2 border-t min-[360px]:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">평가손익</div>
            <div className={`text-base font-semibold tabular-nums ${pnlColorClass(props.pnl)}`}>
              {formatKRW(props.pnl, { sign: true })}
            </div>
            <div className={`text-xs tabular-nums ${pnlColorClass(props.pnl)}`}>
              {formatPercent(props.pnlRate)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">예수금</div>
            <div className="text-base font-semibold tabular-nums">{formatKRW(props.deposit)}</div>
            <div className="text-xs text-muted-foreground">
              계좌 {props.accountCount}개 · 종목 {props.positionCount}개
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
