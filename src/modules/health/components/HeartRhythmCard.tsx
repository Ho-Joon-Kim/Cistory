"use client";

import { HeartPulse } from "lucide-react";
import { ecgClassificationLabel } from "@/modules/health/rhythm";
import type { HealthRhythm } from "@/modules/health/types";
import { InsightCard } from "@/modules/insights/components/primitives/InsightCard";

const WHEN_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function Empty({ children }: { children: string }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

/**
 * ECG + irregular-rhythm results (optional Google Health scopes). Rendered only
 * when the summary carries `rhythm` (at least one scope granted). We relay the
 * DEVICE's classification verbatim in Korean — nothing here re-reads a trace or
 * scores anything, and the card says so.
 */
export function HeartRhythmCard({ rhythm }: { rhythm: HealthRhythm }) {
  return (
    <InsightCard
      title={
        <span className="flex items-center gap-1.5">
          <HeartPulse className="h-4 w-4 text-red-500" />
          심전도 · 불규칙 심박
        </span>
      }
      subtitle="의료 진단이 아닙니다 — 기기 판정 결과를 그대로 보여 줍니다"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {rhythm.ecg ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink-dim">심전도 (ECG)</h3>
            {rhythm.ecg.length === 0 ? (
              <Empty>측정 기록이 아직 없습니다</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {rhythm.ecg.map((r) => (
                  <li key={r.start} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">
                      {WHEN_FMT.format(new Date(r.start))}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        {ecgClassificationLabel(r.classification)}
                      </span>
                      {r.bpm != null ? (
                        <span className="tabular-mono text-ink-mute">{Math.round(r.bpm)} bpm</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {rhythm.irn ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink-dim">불규칙 심박 알림</h3>
            {rhythm.irn.length === 0 ? (
              <Empty>알림 기록이 아직 없습니다</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {rhythm.irn.map((r) => (
                  <li key={r.start} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">
                      {WHEN_FMT.format(new Date(r.start))}
                    </span>
                    <span className={r.positiveWindows > 0 ? "font-medium text-amber-600" : ""}>
                      {r.positiveWindows > 0
                        ? `불규칙 리듬 감지 ${r.positiveWindows}/${r.windows}구간`
                        : "감지 없음"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </InsightCard>
  );
}
