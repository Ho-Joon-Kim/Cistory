"use client";

import type { HealthSleepSession, SleepStageKey } from "@/modules/health/types";
import { InsightCard } from "@/modules/insights/components/primitives/InsightCard";
import { Hypnogram, SLEEP_STAGE_META } from "./Hypnogram";

const DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
});

/** Whole-minute duration → "N시간 M분" (drops the hour part under 60m). */
function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** Composition display order: deepest → most awake. */
const COMPOSITION_ORDER: SleepStageKey[] = ["deep", "light", "rem", "awake"];

/** One stage's share row — dot + label, proportional track, minutes · percent. */
function StageRow({ stage, minutes, pct }: { stage: SleepStageKey; minutes: number; pct: number }) {
  const meta = SLEEP_STAGE_META[stage];
  return (
    <div className="grid grid-cols-[56px_1fr_auto] items-center gap-2.5">
      <span className="flex items-center gap-1.5 text-[11px] text-ink-mute">
        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: meta.color }} />
        {meta.label}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-white/5">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: meta.color }}
        />
      </span>
      <span className="tabular-mono whitespace-nowrap text-[11px] text-ink-mute">
        <b className="font-semibold text-foreground">{Math.round(minutes)}</b>분·{Math.round(pct)}%
      </span>
    </div>
  );
}

/** The featured night: hypnogram + stage composition, side by side on wide screens. */
function FeaturedNight({ session }: { session: HealthSleepSession }) {
  const stages = session.stages;
  const totalStages = stages ? stages.deep + stages.light + stages.rem + stages.awake : 0;
  const pct = (v: number) => (totalStages > 0 ? (v / totalStages) * 100 : 0);
  const recoveryPct = stages ? Math.round(pct(stages.deep + stages.rem)) : null;
  const asleep = stages ? session.minutes - stages.awake : session.minutes;
  const efficiency = session.minutes > 0 ? Math.round((asleep / session.minutes) * 100) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      {/* hypnogram */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-mute">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "hsl(235 66% 60%)" }} />
            수면 단계 · {DATE_FMT.format(new Date(session.start))}
          </span>
          <span className="tabular-mono text-lg font-semibold text-foreground">
            {duration(session.minutes)}
          </span>
        </div>
        {session.segments && session.segments.length > 0 ? (
          <Hypnogram segments={session.segments} minutes={session.minutes} />
        ) : null}
        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] text-ink-mute">
          {COMPOSITION_ORDER.map((key) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-[3px]"
                style={{ background: SLEEP_STAGE_META[key].color }}
              />
              {SLEEP_STAGE_META[key].label}
            </span>
          ))}
        </div>
      </div>

      {/* composition */}
      {stages ? (
        <div>
          <div className="mb-3.5 flex items-baseline justify-between border-b border-hairline pb-3">
            <span className="text-[10px] uppercase tracking-[0.07em] text-ink-mute">
              회복 수면 · 깊은잠＋렘
            </span>
            <span
              className="tabular-mono text-xl font-semibold"
              style={{ color: "hsl(235 78% 74%)" }}
            >
              {recoveryPct}
              <span className="text-xs text-ink-mute">%</span>
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {COMPOSITION_ORDER.map((key) => (
              <StageRow key={key} stage={key} minutes={stages[key]} pct={pct(stages[key])} />
            ))}
          </div>
          <div className="mt-3.5 flex justify-between text-[10.5px] text-ink-mute tabular-mono">
            <span>잠든 시간 {duration(asleep)}</span>
            {efficiency != null ? <span>수면 효율 {efficiency}%</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Recorded-nights strip — every returned session as a duration bar, honest about
 *  the sparse, months-spanning history; the featured night is highlighted. */
function RecordedNights({
  sessions,
  featuredStart,
}: {
  sessions: HealthSleepSession[];
  featuredStart: string | null;
}) {
  // chronological (oldest → newest), like the other health charts.
  const ordered = [...sessions].reverse();
  const maxMin = Math.max(...ordered.map((s) => s.minutes), 1);
  const STRIP_H = 88;

  return (
    <div className="mt-4 border-t border-hairline pt-3.5">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.07em] text-ink-mute">기록된 수면</span>
        <span className="text-[11px] text-ink-mute">{sessions.length}건 · 측정된 날만</span>
      </div>
      <div
        className="flex items-end gap-2 overflow-x-auto"
        style={{ height: STRIP_H }}
        role="img"
        aria-label="기록된 수면 시간"
      >
        {ordered.map((s) => {
          const featured = s.start === featuredStart;
          const hasStages = !!s.segments?.length;
          const h = Math.max(4, (s.minutes / maxMin) * STRIP_H);
          const bg = featured
            ? "hsl(235 66% 60%)"
            : hasStages
              ? "hsl(220 55% 55% / 0.55)"
              : "hsl(0 0% 40% / 0.45)";
          return (
            <div key={s.start} className="flex min-w-[26px] flex-1 flex-col items-center gap-1.5">
              <span
                className="w-full rounded-[3px]"
                style={{
                  height: h,
                  background: bg,
                  filter: featured ? "drop-shadow(0 0 5px hsl(235 66% 60% / 0.7))" : undefined,
                }}
                title={`${DATE_FMT.format(new Date(s.start))} · ${duration(s.minutes)}${hasStages ? " · 단계기록" : " · 시간만"}`}
              />
              <span className="tabular-mono text-[8.5px] text-ink-mute">
                {DATE_FMT.format(new Date(s.start))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-mute">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: "hsl(220 55% 55%)" }}
          />
          단계기록 있음
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: "hsl(0 0% 45%)" }}
          />
          시간만
        </span>
      </div>
    </div>
  );
}

/** Full sleep card — hypnogram of the latest staged night, its composition, and a
 *  recorded-nights strip. Sleep arrives only via the on-device Health Connect import,
 *  so history is intentionally sparse until that's enabled. */
/** A staged sleep of at least this long counts as a "real night" worth featuring —
 *  keeps the hero off short, fragmented naps. */
const REAL_NIGHT_MIN = 180;

export function SleepCard({ sessions }: { sessions: HealthSleepSession[] }) {
  // sessions arrive newest-first; feature the most recent real night, falling back
  // to the most recent staged record (then the latest night updates the hero once
  // a full night is tracked).
  const staged = sessions.filter((s) => s.segments && s.segments.length > 0);
  const featured = staged.find((s) => s.minutes >= REAL_NIGHT_MIN) ?? staged[0] ?? null;

  return (
    <InsightCard
      schema="cross"
      title="수면"
      subtitle="단계별 하룻밤 · Samsung Health / Health Connect"
    >
      {sessions.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-xs text-ink-mute">
          수면 기록이 아직 없습니다 · 온디바이스 Health Connect 연동 시 채워집니다
        </div>
      ) : (
        <>
          {featured ? (
            <FeaturedNight session={featured} />
          ) : (
            <div className="flex h-20 items-center justify-center text-[11px] text-ink-mute">
              단계가 기록된 밤이 아직 없습니다 — 아래는 측정된 수면 시간입니다
            </div>
          )}
          <RecordedNights sessions={sessions} featuredStart={featured?.start ?? null} />
          <p className="mt-3.5 rounded-lg border border-hairline bg-white/[0.02] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-mute">
            수면은 <b className="font-medium text-foreground">온디바이스 Health Connect 연동</b>
            으로만 들어와 기록이 띄엄띄엄합니다. 연동을 켜면 매일 밤이 단계까지 채워집니다.
          </p>
        </>
      )}
    </InsightCard>
  );
}
