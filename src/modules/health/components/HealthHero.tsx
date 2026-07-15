"use client";

import type { HealthSummary } from "@/modules/health/types";
import type { BodyResult } from "@/modules/insights/service";

/** 'YYYY-MM-DD' → 'M.D'. */
function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}.${Number(d)}`;
}

/** Most recent non-null point of a metric, with its day. */
function latest(
  summary: HealthSummary,
  key: string,
  agg: "sum" | "avg"
): { day: string; value: number } | null {
  const m = summary.metrics.find((x) => x.key === key);
  if (!m) return null;
  for (let i = m.points.length - 1; i >= 0; i--) {
    const v = agg === "sum" ? m.points[i].sum : m.points[i].avg;
    if (v != null) return { day: m.points[i].day, value: v };
  }
  return null;
}

function Stat({
  label,
  value,
  unit,
  glow,
  when,
  caption,
}: {
  label: string;
  value: string;
  unit: string;
  glow: string;
  when?: string;
  caption?: string;
}) {
  return (
    <div className="border-hairline px-4 py-4 first:pl-0.5 [&:not(:first-child)]:border-l max-[640px]:[&:nth-child(3)]:border-l-0 max-[640px]:[&:nth-child(n+3)]:border-t">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-mute">{label}</div>
      <div
        className="mt-2 tabular-mono text-[32px] font-semibold leading-none"
        style={{ color: glow }}
      >
        {value}
        <span className="ml-1 text-sm font-medium text-ink-mute">{unit}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-mute">
        {when ? (
          <span className="tabular-mono rounded bg-muted/60 px-1.5 py-px text-[10.5px]">
            {when}
          </span>
        ) : null}
        {caption ? <span>{caption}</span> : null}
      </div>
    </div>
  );
}

/** Latest-value snapshot band across sources (dates differ per metric, shown per stat). */
export function HealthHero({ summary, body }: { summary: HealthSummary; body: BodyResult | null }) {
  const steps = latest(summary, "steps", "sum");
  const rhr = latest(summary, "resting_heart_rate", "avg");
  const exercise = latest(summary, "exercise", "sum");
  const weight = body && body.measurementCount > 0 ? body.weight.latest : null;

  return (
    <div className="mb-8 grid grid-cols-2 border-y border-hairline sm:grid-cols-4">
      <Stat
        label="걸음"
        value={steps ? Math.round(steps.value).toLocaleString("ko-KR") : "—"}
        unit="걸음"
        glow="hsl(153 70% 53%)"
        when={steps ? shortDay(steps.day) : undefined}
        caption={steps ? undefined : "데이터 없음"}
      />
      <Stat
        label="안정시 심박"
        value={rhr ? String(Math.round(rhr.value)) : "—"}
        unit="bpm"
        glow="hsl(0 72% 62%)"
        when={rhr ? shortDay(rhr.day) : undefined}
        caption={rhr ? undefined : "측정 대기"}
      />
      <Stat
        label="활동"
        value={exercise ? String(Math.round(exercise.value)) : "—"}
        unit="분"
        glow="hsl(30 92% 60%)"
        when={exercise ? shortDay(exercise.day) : undefined}
        caption={exercise ? undefined : "기록 없음"}
      />
      <Stat
        label="체중"
        value={weight != null ? weight.toFixed(1) : "—"}
        unit="kg"
        glow="hsl(263 72% 72%)"
        when={body?.latestMeasuredAt ? shortDay(body.latestMeasuredAt.slice(0, 10)) : undefined}
        caption={
          weight != null && body
            ? `체지방 ${body.fatRatioPct.latest?.toFixed(1) ?? "—"}%`
            : "측정 대기"
        }
      />
    </div>
  );
}
