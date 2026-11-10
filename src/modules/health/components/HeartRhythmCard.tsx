"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ecgClassificationLabel } from "@/modules/health/rhythm";
import type { HealthRhythm } from "@/modules/health/types";

function Empty({ children }: { children: string }) {
  return <p className="m-0 border-t border-line py-3 text-sm leading-5 text-ink-3">{children}</p>;
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 mb-2 text-label">{title}</h3>
      {children}
    </div>
  );
}

function Row({ when, children }: { when: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
      <span className="text-[13px] leading-5 text-ink-2 tabular-nums">
        {formatDateTime(new Date(when))}
      </span>
      <span className="text-right text-sm leading-5">{children}</span>
    </li>
  );
}

/**
 * ECG + irregular-rhythm results (optional Google Health scopes). Rendered only
 * when the summary carries `rhythm` (at least one scope granted). We relay the
 * DEVICE's classification verbatim in Korean — nothing here re-reads a trace or
 * scores anything, and the section says so.
 */
export function HeartRhythmCard({
  rhythm,
  style,
  className,
}: {
  rhythm: HealthRhythm;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section aria-labelledby="h-rhythm" className={className} style={style}>
      <h2
        id="h-rhythm"
        className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[1.375rem] lg:leading-[1.875rem]"
      >
        심전도 · 불규칙 심박
      </h2>
      <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">
        의료 진단이 아니에요. 기기가 판정한 결과를 그대로 보여 줘요.
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2 sm:gap-10">
        {rhythm.ecg ? (
          <Column title="심전도 (ECG)">
            {rhythm.ecg.length === 0 ? (
              <Empty>아직 측정 기록이 없어요</Empty>
            ) : (
              <ul className="m-0 list-none border-t border-line p-0">
                {rhythm.ecg.map((r) => (
                  <Row key={r.start} when={r.start}>
                    <span className="font-medium text-ink">
                      {ecgClassificationLabel(r.classification)}
                    </span>
                    {r.bpm != null ? (
                      <span className="num ml-2 text-[13px] text-ink-3">
                        {Math.round(r.bpm)} bpm
                      </span>
                    ) : null}
                  </Row>
                ))}
              </ul>
            )}
          </Column>
        ) : null}
        {rhythm.irn ? (
          <Column title="불규칙 심박 알림">
            {rhythm.irn.length === 0 ? (
              <Empty>아직 알림 기록이 없어요</Empty>
            ) : (
              <ul className="m-0 list-none border-t border-line p-0">
                {rhythm.irn.map((r) => (
                  <Row key={r.start} when={r.start}>
                    <span
                      className={cn(
                        "tabular-nums",
                        r.positiveWindows > 0 ? "font-medium text-warn" : "text-ink-2"
                      )}
                    >
                      {r.positiveWindows > 0
                        ? `불규칙 리듬 감지 ${r.positiveWindows}/${r.windows}구간`
                        : "감지 없음"}
                    </span>
                  </Row>
                ))}
              </ul>
            )}
          </Column>
        ) : null}
      </div>
    </section>
  );
}
