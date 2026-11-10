"use client";

import type { ReactNode } from "react";
import { AiLine, HeroNumber, SecondaryNumber } from "@/components/ds";
import { formatCount, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HeroDelta, HeroFoot, HeroModel } from "@/modules/overview/view/hero";
import type { PeriodContext } from "@/modules/overview/view/labels";
import { Delta } from "./Delta";
import { CashPairs, MiniBars, NetBars, WeightLine } from "./MiniCharts";

/*
 * Three columns on PC that share row tracks (label · figure · delta · AI line ·
 * chart · foot), so figures and charts line up across columns: the grid flows
 * column-major over six rows. On phones the same cells simply stack, each
 * column opened by a rule.
 */
const COL = [
  "lg:pr-8",
  "lg:border-l lg:border-line lg:px-8",
  "lg:border-l lg:border-line lg:pl-8",
] as const;

function Label({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="text-label flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {children}
    </span>
  );
}

function Foot({ foot }: { foot: HeroFoot }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 lg:flex-col lg:items-start lg:gap-0 lg:border-t lg:border-line lg:pt-4">
      <span className="text-label lg:mb-1">{foot.label}</span>
      <SecondaryNumber
        value={foot.value}
        unit={foot.unit}
        className="text-base leading-6 lg:text-[22px] lg:leading-7"
      />
      {foot.delta ? (
        <Delta text={foot.delta.text} dir={foot.delta.dir} className="lg:mt-0.5" />
      ) : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] leading-5 text-ink-3">{children}</p>;
}

function DeltaOrNothing({ delta }: { delta: HeroDelta | null }) {
  return delta ? <Delta text={delta.text} dir={delta.dir} /> : <span aria-hidden="true" />;
}

const signed = (n: number) => {
  const abs = Math.abs(n) / 10_000;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${abs.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
};

export function OverviewHero({ hero, ctx }: { hero: HeroModel; ctx: PeriodContext }) {
  const { commits, savings, body } = hero;
  const cell = (col: number, extra?: string) => cn(COL[col], col > 0 && "first:mt-0", extra);
  const opener = (col: number) =>
    cn(cell(col), col > 0 && "mt-8 border-t border-line pt-8 lg:mt-0 lg:border-t-0 lg:pt-0");

  return (
    <div className="grid grid-cols-1 lg:grid-flow-col lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto_minmax(132px,auto)_auto]">
      {/* commits */}
      <div className={opener(0)}>
        <Label dot="var(--brand)">커밋</Label>
      </div>
      <div className={cell(0, "pt-2")}>
        {commits ? (
          <HeroNumber value={commits.value} countUp format={formatCount} />
        ) : (
          <Empty>커밋 기록이 아직 집계되지 않았어요.</Empty>
        )}
      </div>
      <div className={cell(0, "pt-2")}>
        {commits ? <DeltaOrNothing delta={commits.delta} /> : null}
      </div>
      <div className={cell(0, "pt-1.5")}>{commits ? <AiLine fact={commits.fact} /> : null}</div>
      <div className={cell(0, "h-24 pt-5 lg:h-auto")}>
        {commits ? <MiniBars bars={commits.bars} label="기간별 커밋" tag="commits" /> : null}
      </div>
      <div className={cell(0, "pt-4 lg:pt-6")}>{commits ? <Foot foot={commits.foot} /> : null}</div>

      {/* savings */}
      <div className={opener(1)}>
        <Label dot="var(--ink2)">순저축</Label>
      </div>
      <div className={cell(1, "pt-2")}>
        {savings ? (
          <HeroNumber
            value={savings.net / 10_000}
            countUp
            decimals={1}
            format={(v) => signed(v * 10_000)}
            unit="만원"
          />
        ) : (
          <Empty>소비 기록이 아직 집계되지 않았어요.</Empty>
        )}
      </div>
      <div className={cell(1, "pt-2")}>
        {savings ? <DeltaOrNothing delta={savings.delta} /> : null}
      </div>
      <div className={cell(1, "pt-1.5")}>{savings ? <AiLine fact={savings.fact} /> : null}</div>
      <div className={cell(1, "pt-5")}>
        {savings?.pairs ? <CashPairs pairs={savings.pairs} /> : null}
        {savings?.netBars ? <NetBars bars={savings.netBars} label="월별 순저축" /> : null}
      </div>
      <div className={cell(1, "pt-4 lg:pt-6")}>{savings ? <Foot foot={savings.foot} /> : null}</div>

      {/* body */}
      <div className={opener(2)} data-overview-slot="health" tabIndex={-1}>
        <Label dot="var(--health)">체중</Label>
      </div>
      <div className={cell(2, "pt-2")}>
        {body.weight ? (
          <HeroNumber
            value={body.weight.value}
            countUp
            decimals={1}
            format={(v) => v.toFixed(1)}
            unit="kg"
          />
        ) : (
          <Empty>{ctx.label}에는 체중 측정이 없어요.</Empty>
        )}
      </div>
      <div className={cell(2, "pt-2")}>
        {body.weight?.asOf ? (
          <Delta
            text={`${formatMonthDay(body.weight.asOf, { now: ctx.now })} 측정 · ${ctx.label}에는 측정 없음`}
            dir={null}
          />
        ) : body.weight ? (
          <DeltaOrNothing delta={body.weight.delta} />
        ) : null}
      </div>
      <div className={cell(2, "pt-1.5")}>
        {body.weight ? <AiLine fact={body.weight.fact} /> : null}
      </div>
      <div className={cell(2, "pt-5")}>
        {body.weight ? (
          <WeightLine
            points={body.weight.points}
            peak={body.weight.peak}
            axisFrom={body.weight.axisFrom}
            axisTo={body.weight.axisTo}
            now={ctx.now}
          />
        ) : null}
      </div>
      <div className={cell(2, "pt-5 lg:pt-6")}>
        {body.steps ? (
          <div className="grid grid-cols-[minmax(0,1fr)_96px] items-end gap-x-4 border-t border-line pt-4">
            <div>
              <Label dot="var(--health)">걸음 · 하루 평균</Label>
              <div className="mt-1">
                <SecondaryNumber
                  value={body.steps.average}
                  countUp
                  format={formatCount}
                  unit="걸음"
                />
              </div>
              {body.steps.delta ? (
                <Delta text={body.steps.delta.text} dir={body.steps.delta.dir} className="mt-0.5" />
              ) : null}
            </div>
            <div className="h-11">
              <MiniBars
                bars={body.steps.bars}
                label="기간별 하루 평균 걸음"
                tag="steps"
                showLabels={false}
                gap={3}
              />
            </div>
            {body.steps.fact ? (
              <div className="col-span-2 mt-2">
                <AiLine fact={body.steps.fact} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
