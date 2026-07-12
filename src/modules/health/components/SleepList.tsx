"use client";

import { Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthSleepSession, SleepStages } from "@/modules/health/types";

const DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// depth → label + color (deep darkest → awake lightest), in bar order.
const DEPTHS: { key: keyof SleepStages; label: string; bar: string; dot: string }[] = [
  { key: "deep", label: "깊은잠", bar: "bg-indigo-700", dot: "bg-indigo-700" },
  { key: "light", label: "얕은잠", bar: "bg-indigo-400", dot: "bg-indigo-400" },
  { key: "rem", label: "렘", bar: "bg-violet-400", dot: "bg-violet-400" },
  { key: "awake", label: "각성", bar: "bg-muted-foreground/40", dot: "bg-muted-foreground/40" },
];

function StageBar({ stages }: { stages: SleepStages }) {
  const total = DEPTHS.reduce((sum, d) => sum + stages[d.key], 0);
  if (total <= 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full">
        {DEPTHS.map((d) =>
          stages[d.key] > 0 ? (
            <div
              key={d.key}
              className={d.bar}
              style={{ width: `${(stages[d.key] / total) * 100}%` }}
              title={`${d.label} ${Math.round(stages[d.key])}분`}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {DEPTHS.filter((d) => stages[d.key] > 0).map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1 tabular-nums">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${d.dot}`} />
            {d.label} {Math.round(stages[d.key])}분
          </span>
        ))}
      </div>
    </div>
  );
}

export function SleepList({ sessions }: { sessions: HealthSleepSession[] }) {
  if (!sessions?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">최근 수면</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {sessions.map((s) => {
          const d = new Date(s.start);
          return (
            <div key={s.start} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">
                <Moon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{duration(s.minutes)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {DATE_FMT.format(d)} {TIME_FMT.format(d)}
                  </span>
                </div>
                {s.stages ? <StageBar stages={s.stages} /> : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
