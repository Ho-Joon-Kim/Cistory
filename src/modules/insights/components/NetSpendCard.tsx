"use client";

import type { NetSpendResult } from "../service";
import { InsightCard, InsightCardEmpty } from "./primitives/InsightCard";
import { Stat } from "./primitives/Stat";

interface NetSpendCardProps {
  data: NetSpendResult | null;
  isLoading: boolean;
}

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

function formatKrw(amount: number): string {
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}천만`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}만`;
  return amount.toLocaleString();
}

/** 순지출 + 월별 막대 + 톱 가맹점. */
export function NetSpendCard({ data, isLoading }: NetSpendCardProps) {
  if (isLoading) {
    return (
      <InsightCard schema="spending" title="순지출" subtitle="월별 입출금 + 톱 가맹점">
        <div className="h-48 animate-pulse bg-muted/20 rounded" />
      </InsightCard>
    );
  }

  if (!data || (data.totalIn === 0 && data.totalOut === 0)) {
    return (
      <InsightCard schema="spending" title="순지출" subtitle="월별 입출금 + 톱 가맹점">
        <InsightCardEmpty message="결제 데이터가 없습니다" />
      </InsightCard>
    );
  }

  const max = Math.max(...data.monthlyOut, ...data.monthlyIn, 1);

  return (
    <InsightCard schema="spending" title="순지출" subtitle="자체 이체 제외 · 월별 입출금">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="수입" value={formatKrw(data.totalIn)} suffix="원" tone="green" glow />
        <Stat label="지출" value={formatKrw(data.totalOut)} suffix="원" tone="orange" glow />
        <Stat
          label="순"
          value={formatKrw(Math.abs(data.net))}
          suffix={data.net >= 0 ? "원 +" : "원 −"}
          tone={data.net >= 0 ? "green" : "red"}
          glow
        />
      </div>

      <div className="flex items-end gap-1 h-20 mb-4">
        {data.monthlyOut.map((out, i) => {
          const inAmt = data.monthlyIn[i];
          const outH = (out / max) * 80;
          const inH = (inAmt / max) * 80;
          return (
            <div key={MONTHS[i]} className="flex-1 flex flex-col items-center gap-0.5">
              <div className="w-full flex items-end gap-0.5 h-20">
                <div
                  className="flex-1 bg-[hsl(var(--accent-green)/0.7)] rounded-t-sm"
                  style={{ height: `${inH}px`, minHeight: inAmt > 0 ? "1px" : "0" }}
                  title={`수입 ${formatKrw(inAmt)}`}
                />
                <div
                  className="flex-1 bg-[hsl(var(--accent-orange)/0.7)] rounded-t-sm"
                  style={{ height: `${outH}px`, minHeight: out > 0 ? "1px" : "0" }}
                  title={`지출 ${formatKrw(out)}`}
                />
              </div>
              <div className="text-[9px] text-ink-mute tabular-mono">{MONTHS[i]}</div>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute mb-2">톱 가맹점</div>
      <ul className="space-y-1.5">
        {data.topMerchants.map((m) => (
          <li key={m.merchant} className="flex justify-between items-baseline gap-2 text-sm">
            <span className="text-foreground truncate">{m.merchant}</span>
            <span className="tabular-mono text-ink-dim shrink-0">
              {formatKrw(m.amount)}
              <span className="text-[10px] text-ink-mute ml-1">×{m.count}</span>
            </span>
          </li>
        ))}
      </ul>
    </InsightCard>
  );
}
