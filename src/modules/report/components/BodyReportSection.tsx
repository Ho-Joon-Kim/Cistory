"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeWeightTrendGeometry,
  formatIndex,
  formatKg,
  formatPct,
  formatSignedDelta,
} from "@/lib/body-format";
import type { BodySectionData } from "../types";

interface BodyReportSectionProps {
  isLoading: boolean;
  bodyData: BodySectionData | null;
}

/** A single period stat: label + value, with an optional neutral delta line. */
function BodyStat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {/* Reserve the line even when empty so the tiles stay aligned. */}
      <div className="mt-0.5 h-4 text-xs text-muted-foreground tabular-nums">{delta ?? ""}</div>
    </div>
  );
}

/**
 * Compact weight trend — raw points + a smoothed "Trend Weight" line. Neutral
 * styling (no red/green weight-change semantics), matching the insights card.
 */
function WeightTrend({ series }: { series: { date: string; weight: number }[] }) {
  if (series.length < 2) return null;

  const W = 320;
  const H = 96;
  const { points, trendPath } = computeWeightTrendGeometry(series, { width: W, height: H, pad: 8 });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-foreground"
      style={{ height: H }}
      preserveAspectRatio="none"
      role="img"
      aria-label="체중 추이"
    >
      <title>체중 추이</title>
      {series.map((s, i) => (
        <circle
          key={s.date}
          cx={points[i].x}
          cy={points[i].y}
          r={1.75}
          className="fill-muted-foreground"
        />
      ))}
      <path
        d={trendPath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">체성분</h2>
      {children}
    </section>
  );
}

/** 리포트 체성분 섹션 — 기간 평균/변화/범위 + 체중 추이. 데이터 없으면 렌더 생략. */
export function BodyReportSection({ isLoading, bodyData }: BodyReportSectionProps) {
  if (isLoading) {
    return (
      <SectionShell>
        <Card>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-[160px] w-full" />
          </CardContent>
        </Card>
      </SectionShell>
    );
  }

  if (!bodyData || bodyData.measurementCount === 0) return null;

  const b = bodyData;

  return (
    <SectionShell>
      <Card>
        <CardContent className="space-y-5 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BodyStat
              label="평균 체중"
              value={formatKg(b.avgWeightKg)}
              delta={formatSignedDelta(b.weightChangeKg, "kg")}
            />
            <BodyStat
              label="평균 체지방률"
              value={formatPct(b.avgFatRatioPct)}
              delta={formatSignedDelta(b.fatRatioChangePct, "%")}
            />
            <BodyStat
              label="평균 근육량"
              value={formatKg(b.avgMuscleMassKg)}
              delta={formatSignedDelta(b.muscleChangeKg, "kg")}
            />
            <BodyStat label="평균 내장지방" value={formatIndex(b.avgVisceralFat, 1)} />
          </div>

          <WeightTrend series={b.weightSeries} />

          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>최소 {formatKg(b.weightMinKg)}</span>
            <span>{b.measurementCount}회 측정</span>
            <span>최대 {formatKg(b.weightMaxKg)}</span>
          </div>
        </CardContent>
      </Card>
    </SectionShell>
  );
}
