"use client";

import type { ActivityCorrelationDay } from "@/modules/health/types";
import { InsightCard } from "@/modules/insights/components/primitives/InsightCard";
import { HoverLayer } from "./HoverLayer";

const GREEN = "hsl(153 70% 53%)";
const BLUE = "hsl(210 90% 62%)";
const ORANGE = "hsl(30 92% 60%)";

const W = 700;
const TOP = 18;
const BASE = 120;

function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}.${Number(d)}`;
}

function visitFill(v: number): string {
  if (v >= 7) return "hsl(210 90% 62% / 0.95)";
  if (v >= 3) return "hsl(210 80% 58% / 0.5)";
  return "hsl(210 40% 45% / 0.4)";
}

/** One data-grounded sentence: do busier-out days walk more? */
function insight(days: ActivityCorrelationDay[]): string | null {
  const withSteps = days.filter((d) => d.steps != null) as (ActivityCorrelationDay & {
    steps: number;
  })[];
  if (withSteps.length < 3) return null;
  const hi = withSteps.reduce((a, b) => (b.visits > a.visits ? b : a));
  const lo = withSteps.reduce((a, b) => (b.visits < a.visits ? b : a));
  if (hi.visits === lo.visits) return null;
  return `외출한 장소가 많은 날일수록 걸음이 늘어납니다 — ${hi.visits}곳 방문 → ${hi.steps.toLocaleString("ko-KR")}보, ${lo.visits}곳 → ${lo.steps.toLocaleString("ko-KR")}보. 코딩 시간은 걸음과 무관하게 대체로 꾸준합니다.`;
}

function Columns({ days, active }: { days: ActivityCorrelationDay[]; active: number | null }) {
  const n = days.length;
  const slot = W / n;
  const bw = slot - 14;
  const maxSteps = Math.max(...days.map((d) => d.steps ?? 0), 1);
  const maxCoding = Math.max(...days.map((d) => d.codingMin ?? 0), 1);
  const todayIdx = n - 1;
  return (
    <svg
      viewBox={`0 0 ${W} 175`}
      preserveAspectRatio="none"
      className="block h-auto w-full"
      style={{ overflow: "visible" }}
    >
      <title>건강 × 활동 14일 교차</title>
      <text
        x={2}
        y={TOP - 6}
        fill="hsl(var(--ink-mute))"
        fontSize={9}
        fontFamily="var(--font-mono)"
      >
        걸음
      </text>
      <text
        x={2}
        y={BASE + 29}
        fill="hsl(var(--ink-mute))"
        fontSize={9}
        fontFamily="var(--font-mono)"
      >
        외출
      </text>
      {days.map((d, i) => {
        const x = i * slot + 7;
        const cx = x + bw / 2;
        const isActive = i === active;
        const emphasize = isActive || (active == null && i === todayIdx);
        const codeW = Math.max(2, ((d.codingMin ?? 0) / maxCoding) * bw);
        return (
          <g key={d.day}>
            {d.steps != null ? (
              <rect
                x={x}
                y={BASE - Math.max(2, (d.steps / maxSteps) * (BASE - TOP))}
                width={bw}
                height={Math.max(2, (d.steps / maxSteps) * (BASE - TOP))}
                rx={2.5}
                fill={GREEN}
                fillOpacity={emphasize ? 1 : 0.5}
                filter={emphasize ? `drop-shadow(0 0 4px ${GREEN})` : undefined}
              />
            ) : (
              <rect x={x} y={BASE - 8} width={bw} height={8} rx={2} fill="hsl(0 0% 22%)" />
            )}
            {/* coding intensity */}
            <rect
              x={cx - codeW / 2}
              y={BASE + 7}
              width={codeW}
              height={3}
              rx={1.5}
              fill={ORANGE}
              fillOpacity={0.85}
            />
            {/* visits */}
            <circle cx={cx} cy={BASE + 26} r={9} fill={visitFill(d.visits)} />
            <text
              x={cx}
              y={BASE + 29.5}
              fill={d.visits >= 3 ? "#000" : "hsl(var(--ink-mute))"}
              fontSize={10}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontWeight={600}
            >
              {d.visits}
            </text>
            <text
              x={cx}
              y={BASE + 50}
              fill={emphasize ? "hsl(var(--ink-dim))" : "hsl(var(--ink-mute))"}
              fontSize={9}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {shortDay(d.day)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

export function CorrelationCard({
  days,
  isLoading,
}: {
  days: ActivityCorrelationDay[] | null;
  isLoading: boolean;
}) {
  return (
    <InsightCard title="연관성 · 건강 × 활동" subtitle="Cistory 교차 — 위치·코딩과 겹쳐보기">
      {isLoading ? (
        <div className="h-44 animate-pulse rounded bg-muted/30" />
      ) : !days || days.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-ink-mute">
          교차할 활동 데이터가 아직 없습니다
        </div>
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-mute">
            <LegendDot color={GREEN} label="걸음(막대)" />
            <LegendDot color={BLUE} label="외출한 장소 수" />
            <LegendDot color={ORANGE} label="코딩 강도" />
          </div>
          <HoverLayer
            items={days}
            render={(active) => <Columns days={days} active={active} />}
            tooltip={(d) => (
              <span className="tabular-mono">
                <span className="text-ink-mute">{shortDay(d.day)}</span>{" "}
                <span className="font-semibold" style={{ color: GREEN }}>
                  {d.steps != null ? `${d.steps.toLocaleString("ko-KR")}보` : "걸음 없음"}
                </span>{" "}
                · <span style={{ color: BLUE }}>외출 {d.visits}</span> ·{" "}
                <span style={{ color: ORANGE }}>
                  코딩 {d.codingMin != null ? `${(d.codingMin / 60).toFixed(1)}h` : "—"}
                </span>
              </span>
            )}
          />
          {insight(days) ? (
            <p className="mt-3.5 rounded-lg border border-hairline bg-white/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-ink-dim">
              {insight(days)}
            </p>
          ) : null}
        </>
      )}
    </InsightCard>
  );
}
