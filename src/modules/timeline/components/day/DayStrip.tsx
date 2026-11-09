"use client";

import { useState } from "react";
import { useEvidence } from "@/components/ds";
import { cn } from "@/lib/utils";
import { DAY_MINUTES, type RideRow, type StayRow } from "../../day-model";

const pct = (m: number) =>
  `${((Math.max(0, Math.min(DAY_MINUTES, m)) / DAY_MINUTES) * 100).toFixed(3)}%`;
const HOURS = [0, 6, 12, 18, 24];

/**
 * The thin 24-hour strip under the map: places as neutral blocks (named when
 * wide enough), rides as short place-colored ticks. Click selects (synced with
 * the map and the list); hover shows `회사 · 08:58–21:04`.
 */
export function DayStrip({
  stays,
  rides,
  selectedMapId,
  onSelect,
  compact = false,
}: {
  stays: StayRow[];
  rides: RideRow[];
  selectedMapId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const { stateOf, isActive } = useEvidence();
  const [tip, setTip] = useState<{ text: string; left: string } | null>(null);
  const labelMin = compact ? 0.14 : 0.05;

  const state = (id: string) => {
    const ev = stateOf(id);
    if (ev === "on" || selectedMapId === id) return "on";
    if (ev === "dim" || (selectedMapId && !isActive)) return "dim";
    return undefined;
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of time blocks
    <div role="group" aria-label="하루 24시간" className="relative">
      {tip ? (
        <span
          className="num pointer-events-none absolute top-[calc(100%+4px)] z-[5] -translate-x-1/2 rounded-lg bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink shadow-ring"
          style={{ left: tip.left }}
        >
          {tip.text}
        </span>
      ) : null}
      <div className="relative h-5">
        {stays.map((s) => {
          const st = state(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-label={`${s.name} ${s.range}`}
              aria-pressed={selectedMapId === s.id}
              onClick={() => onSelect(s.id)}
              onMouseEnter={() =>
                setTip({ text: `${s.name} · ${s.range}`, left: pct((s.start + s.end) / 2) })
              }
              onMouseLeave={() => setTip(null)}
              onFocus={() =>
                setTip({ text: `${s.name} · ${s.range}`, left: pct((s.start + s.end) / 2) })
              }
              onBlur={() => setTip(null)}
              style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 2px)` }}
              className={cn(
                "absolute inset-y-0 overflow-hidden rounded border-0 px-1.5 text-left text-[11px] font-semibold whitespace-nowrap transition-[background-color,opacity,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                st === "on"
                  ? "bg-brand-soft text-ink shadow-[inset_0_0_0_1.5px_var(--brand)]"
                  : "bg-track text-ink-2 hover:bg-[color-mix(in_oklab,var(--track)_70%,var(--ink3))]",
                st === "dim" && "opacity-30"
              )}
            >
              {(s.end - s.start) / DAY_MINUTES > labelMin ? s.name : ""}
            </button>
          );
        })}
        {rides.map((r) => {
          const st = state(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-label={`${r.mode} ${r.range}`}
              aria-pressed={selectedMapId === r.id}
              onClick={() => onSelect(r.id)}
              onMouseEnter={() =>
                setTip({
                  text: `${r.mode} ${r.distance} · ${r.time}`,
                  left: pct((r.start + r.end) / 2),
                })
              }
              onMouseLeave={() => setTip(null)}
              onFocus={() =>
                setTip({
                  text: `${r.mode} ${r.distance} · ${r.time}`,
                  left: pct((r.start + r.end) / 2),
                })
              }
              onBlur={() => setTip(null)}
              style={{ left: pct(r.start), width: `max(4px, ${pct(r.end - r.start)})` }}
              className={cn(
                "absolute inset-y-0 rounded border-0 p-0 transition-[background-color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                st === "on" ? "bg-brand" : "bg-place",
                st === "dim" && "opacity-30"
              )}
            />
          );
        })}
      </div>
      <div className="relative mt-1 h-3.5" aria-hidden="true">
        {HOURS.map((h, i) => (
          <span
            key={h}
            className={cn(
              "num absolute text-[10px] leading-3.5 whitespace-nowrap text-ink-3",
              i === 0 ? "" : i === HOURS.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
            )}
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}
