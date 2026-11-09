"use client";

import { type CSSProperties, useState } from "react";
import { formatDateRange, formatDay, formatMonthDay, formatReturn, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExecutionItem, ReturnsResponse } from "../hooks";
import { MIN_ANNUALIZE_DAYS } from "../returns";
import { ordDateKey, ordTime } from "../view-model";
import { Disclosure, marketTone, useElementWidth } from "./parts";

const signed = (n: number) => formatWon(n, { sign: true });

function TwrCurve({ periods }: { periods: ReturnsResponse["twr"]["periods"] }) {
  const [ref, w] = useElementWidth<HTMLDivElement>();
  const h = 140;
  const pts = periods.map((p) => ({ date: p.date, v: p.cumulativeReturn }));
  if (pts.length < 2) return null;
  let min = 0;
  let max = 0;
  for (const p of pts) {
    min = Math.min(min, p.v);
    max = Math.max(max, p.v);
  }
  const span = max - min || 1;
  const x = (j: number) => 1 + (j * (w - 2)) / (pts.length - 1);
  const y = (v: number) => 16 + ((max - v) / span) * (h - 32);
  let pk = 0;
  let lw = 0;
  pts.forEach((p, j) => {
    if (p.v > pts[pk].v) pk = j;
    if (p.v < pts[lw].v) lw = j;
  });
  const path = pts
    .map((p, j) => `${j ? "L" : "M"}${x(j).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join("");
  const anchor = (j: number) => (x(j) < 90 ? "start" : x(j) > w - 90 ? "end" : "middle");
  return (
    <div ref={ref} className="h-[140px] w-full">
      {w > 0 ? (
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="block overflow-visible"
          role="img"
          aria-label={`TWR 누적 수익률 추이, 최고 ${formatReturn(pts[pk].v)}, 최저 ${formatReturn(pts[lw].v)}`}
        >
          <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 3" />
          <text x={w} y={y(0) - 4} textAnchor="end" fontSize={11} fill="var(--ink3)">
            0%
          </text>
          <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" />
          {pts[pk].v > 0 ? (
            <g>
              <circle cx={x(pk)} cy={y(pts[pk].v)} r={3.5} fill="var(--up)" />
              <text
                x={x(pk)}
                y={y(pts[pk].v) - 8}
                textAnchor={anchor(pk)}
                fontSize={12}
                fill="var(--up)"
                fontFamily="var(--font-mono)"
              >
                최고 {formatReturn(pts[pk].v)} · {formatMonthDay(pts[pk].date)}
              </text>
            </g>
          ) : null}
          {pts[lw].v < 0 ? (
            <g>
              <circle cx={x(lw)} cy={y(pts[lw].v)} r={3.5} fill="var(--down)" />
              <text
                x={x(lw)}
                y={y(pts[lw].v) + 18}
                textAnchor={anchor(lw)}
                fontSize={12}
                fill="var(--down)"
                fontFamily="var(--font-mono)"
              >
                최저 {formatReturn(pts[lw].v)} · {formatMonthDay(pts[lw].date)}
              </text>
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-label">{label}</div>
      <div className={cn("num mt-0.5 text-xl leading-7 font-medium lg:mt-1 lg:text-[22px]", tone)}>
        {value}
      </div>
    </div>
  );
}

function Performance({ data, pnlRate }: { data: ReturnsResponse; pnlRate: number }) {
  const total = data.twr.totalReturn;
  if (total === null || !data.startDate || !data.endDate) {
    return (
      <p className="m-0 text-[13px] leading-5 text-ink-2">
        계산하려면 모든 계좌의 평가 기록이 있는 날이 이틀 이상 필요해요.
      </p>
    );
  }
  const days = Math.round(data.twr.days);
  const net = data.cashflows.reduce((s, c) => s + c.amount, 0);
  const market = data.endValue - data.startValue - net;
  const annual = days >= MIN_ANNUALIZE_DAYS;
  const range = formatDateRange(data.startDate, data.endDate);
  const excluded = data.coverage?.excludedDates.length ?? 0;
  return (
    <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-12 lg:gap-x-6">
      <div className="flex flex-col gap-3.5 lg:col-span-5 lg:gap-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-[repeat(3,auto)] lg:justify-start lg:gap-x-8">
          <Stat
            label={`TWR 누적 · ${days}일`}
            value={formatReturn(total)}
            tone={marketTone(total)}
          />
          <Stat label="입출금 제외 손익" value={signed(market)} tone={marketTone(market)} />
          {annual && data.twr.annualizedReturn !== null ? (
            <Stat
              label="TWR 연환산"
              value={formatReturn(data.twr.annualizedReturn)}
              tone={marketTone(data.twr.annualizedReturn)}
            />
          ) : null}
          {annual && data.xirr !== null ? (
            <Stat
              label="XIRR 연환산"
              value={formatReturn(data.xirr)}
              tone={marketTone(data.xirr)}
            />
          ) : null}
        </div>
        <p className="m-0 max-w-[480px] text-[13px] leading-5 text-ink-2 lg:leading-[21px]">
          총 평가손익 <span className="num">{formatReturn(pnlRate)}</span>는 지금 평가금액을
          매입금액과 비교한 값이에요. 운용 성과는 기준이 달라요.{" "}
          <span className="num">{range}</span> 동안 입출금 효과를 빼고{" "}
          <span className="num">{formatWon(data.startValue)}</span>에서{" "}
          <span className="num">{formatWon(data.endValue)}</span>까지 돈이 얼마나 불었는지(TWR)
          {annual
            ? ", 넣은 시점과 금액을 반영하면 연 몇 %였는지(XIRR) 계산해요."
            : " 계산해요. 1년이 안 된 기간은 연환산하지 않아요 — 1년이 지나면 연환산 TWR과 XIRR을 함께 보여드려요."}
        </p>
        {excluded > 0 ? (
          <p className="m-0 text-xs leading-[18px] text-ink-3">
            일부 계좌 기록이 없는 <span className="num">{excluded}</span>일은 빼고 계산했어요.
          </p>
        ) : null}
      </div>
      <div className="mt-2 lg:col-span-6 lg:col-start-7 lg:mt-0">
        <TwrCurve periods={data.twr.periods} />
      </div>
    </div>
  );
}

function Cashflows({ cashflows }: { cashflows: ReturnsResponse["cashflows"] }) {
  const inSum = cashflows.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  const outSum = cashflows.filter((c) => c.amount < 0).reduce((s, c) => s + c.amount, 0);
  const list = [...cashflows].reverse();
  const rowsPerCol = Math.max(1, Math.ceil(list.length / 3));
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2.5 text-xs lg:gap-x-8 lg:pb-3 lg:text-[13px]">
        <span>
          <span className="text-ink-3">입금 </span>
          <span className="num">{signed(inSum)}</span>
        </span>
        <span>
          <span className="text-ink-3">출금 </span>
          <span className="num">{signed(outSum)}</span>
        </span>
        <span className="hidden lg:inline">
          <span className="text-ink-3">순입금 </span>
          <span className="num font-semibold">{signed(inSum + outSum)}</span>
        </span>
      </div>
      <ul
        className="m-0 grid list-none grid-flow-row p-0 lg:grid-flow-col lg:grid-cols-3 lg:gap-x-12 lg:border-t lg:border-line lg:[grid-template-rows:repeat(var(--rows),36px)]"
        style={{ "--rows": rowsPerCol } as CSSProperties}
      >
        {list.map((c) => (
          <li
            key={`${c.date}-${c.amount}`}
            className="flex h-9 max-w-[360px] items-center justify-between border-t border-line text-[13px] lg:border-t-0 lg:border-b"
          >
            <span className="text-ink-2">{formatDay(c.date)}</span>
            <span className="num">{signed(c.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3 text-xs leading-[18px] text-ink-3">
        예수금 변화와 체결의 결제일(T+2)을 맞춰 본 추정치예요. 배당·이자·수수료가 섞이면 조금 어긋날
        수 있어요.
      </p>
    </div>
  );
}

function Executions({ executions }: { executions: ExecutionItem[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {executions.map((e) => {
        const filled = e.filledQty > 0;
        const date = formatDay(ordDateKey(e.ordDt));
        const time = ordTime(e.ordTime);
        const side = e.side === "buy" ? "매수" : "매도";
        const qty = filled ? `${e.filledQty}주 · ${formatWon(e.avgPrice)}` : `주문 ${e.orderQty}주`;
        const amount = e.cancelled ? "취소" : filled ? formatWon(e.filledAmount) : "미체결";
        return (
          <li
            key={e.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-0.5 border-b border-line py-2.5 text-[13px] leading-[18px] lg:h-10 lg:grid-cols-[136px_56px_80px_56px_minmax(0,1fr)_180px_140px] lg:items-center lg:py-0"
          >
            <span className="hidden text-ink-2 lg:inline">{date}</span>
            <span className="num hidden text-ink-3 lg:inline">{time}</span>
            <span className="hidden text-ink-2 lg:inline">{e.accountLabel}</span>
            <span className="hidden lg:inline">
              <span className="inline-flex h-[22px] items-center rounded-full bg-surface px-2 text-[11px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]">
                {side}
              </span>
            </span>
            <span className="truncate font-medium">{e.name}</span>
            <span className="num hidden text-ink-2 lg:inline">{qty}</span>
            <span
              className={cn("num text-right", filled && !e.cancelled ? "text-ink" : "text-ink-3")}
            >
              {amount}
            </span>
            <span className="text-xs text-ink-3 lg:hidden">
              {date} <span className="num">{time}</span> · {e.accountLabel} · {side}
            </span>
            <span className="num text-right text-xs text-ink-3 lg:hidden">{qty}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function PortfolioDisclosures({
  returns,
  returnsError,
  executions,
  pnlRate,
}: {
  returns: ReturnsResponse | null;
  returnsError: string | null;
  executions: ExecutionItem[];
  pnlRate: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const cashflows = returns?.cashflows ?? [];
  const net = cashflows.reduce((s, c) => s + c.amount, 0);
  const range =
    returns?.startDate && returns.endDate
      ? formatDateRange(returns.startDate, returns.endDate)
      : null;
  const unfilled = executions.filter((e) => e.filledQty === 0 && !e.cancelled).length;
  const lastFill = executions.find((e) => e.filledQty > 0);

  return (
    <section aria-label="자세히" className="pb-12 lg:pb-[72px]">
      <Disclosure
        id="pf-perf"
        title="운용 성과"
        summary={
          <>
            입출금을 뺀 기간 수익률(TWR)과 내부수익률(XIRR)
            {range ? (
              <>
                {" "}
                · <span className="num">{range}</span>
              </>
            ) : null}
          </>
        }
        mobileSummary={
          <>
            TWR · XIRR
            {range ? (
              <>
                {" "}
                · <span className="num">{range}</span>
              </>
            ) : null}
          </>
        }
        open={!!open.perf}
        onToggle={() => toggle("perf")}
      >
        {returnsError ? (
          <p role="alert" className="m-0 text-[13px] text-ink-2">
            {returnsError}
          </p>
        ) : returns ? (
          <Performance data={returns} pnlRate={pnlRate} />
        ) : (
          <p className="m-0 text-[13px] text-ink-3">불러오는 중…</p>
        )}
      </Disclosure>

      <Disclosure
        id="pf-cashflows"
        title={
          <>
            입출금 <span className="num">{cashflows.length}건</span>
          </>
        }
        summary={
          <>
            예수금 변화로 계산한 입출금 · 순입금 <span className="num">{signed(net)}</span>
          </>
        }
        mobileSummary={
          <>
            순입금 <span className="num">{signed(net)}</span>
          </>
        }
        open={!!open.cf}
        onToggle={() => toggle("cf")}
      >
        {cashflows.length > 0 ? (
          <Cashflows cashflows={cashflows} />
        ) : (
          <p className="m-0 text-[13px] text-ink-3">기간 안에 찾은 입출금이 없어요.</p>
        )}
      </Disclosure>

      <Disclosure
        id="pf-executions"
        title={
          <>
            최근 체결 <span className="num">{executions.length}건</span>
          </>
        }
        summary={
          <>
            {lastFill ? (
              <>
                마지막 체결{" "}
                <span className="num">{formatMonthDay(ordDateKey(lastFill.ordDt))}</span> ·{" "}
              </>
            ) : null}
            미체결 <span className="num">{unfilled}건</span>
          </>
        }
        mobileSummary={
          <>
            {lastFill ? (
              <>
                마지막 <span className="num">{formatMonthDay(ordDateKey(lastFill.ordDt))}</span> ·{" "}
              </>
            ) : null}
            미체결 <span className="num">{unfilled}건</span>
          </>
        }
        open={!!open.ex}
        onToggle={() => toggle("ex")}
        last
      >
        {executions.length > 0 ? (
          <Executions executions={executions} />
        ) : (
          <p className="m-0 text-[13px] text-ink-3">아직 체결 기록이 없어요.</p>
        )}
      </Disclosure>
    </section>
  );
}
