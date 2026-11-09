"use client";

import type { CSSProperties } from "react";
import { formatCount, formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CellKind, StatusCell } from "../insights";

/** Shared intensity ramp: --ink mixed into --track (14 · 30 · 50 · 70 · 88%). */
const LEVEL_MIX = [0, 14, 30, 50, 70, 88] as const;

/**
 * `failTone` colors the 수집 실패 hatch: --up for a failing source, --warn for one
 * that only needs re-authorization, so the strip matches the row's badge.
 */
export function cellStyle(
  kind: CellKind,
  level: number,
  failTone: "up" | "warn" = "up"
): CSSProperties {
  switch (kind) {
    case "fail":
      return {
        background: `repeating-linear-gradient(135deg, color-mix(in oklab, var(--${failTone}) 22%, transparent) 0 2px, transparent 2px 6px)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--${failTone}) 40%, transparent)`,
      };
    case "gap":
      return { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--warn)" };
    case "pending":
      return {
        background: "transparent",
        boxShadow: "inset 0 0 0 1px var(--ink3)",
        outline: "1px dashed var(--ink3)",
        outlineOffset: "-3px",
      };
    case "checked":
      return {
        background:
          "radial-gradient(circle, var(--ink3) 0 1.5px, transparent 2px) center / 100% 100% no-repeat, var(--track)",
      };
    default:
      return {
        background:
          level === 0
            ? "var(--track)"
            : `color-mix(in oklab, var(--ink) ${LEVEL_MIX[level]}%, var(--track))`,
      };
  }
}

function withRing(style: CSSProperties, color: string | null): CSSProperties {
  if (!color) return style;
  const ring = `0 0 0 2px var(--surface), 0 0 0 3.5px ${color}`;
  return { ...style, boxShadow: style.boxShadow ? `${style.boxShadow}, ${ring}` : ring };
}

export const CELL_LABELS: Record<CellKind, string> = {
  none: "",
  gap: "공백",
  fail: "수집 실패",
  pending: "재수집 대기·진행",
  checked: "재수집 완료 · 기록 없음",
};

export function cellText(cell: StatusCell, unit: string): string {
  if (cell.kind !== "none") return CELL_LABELS[cell.kind];
  return cell.count === 0 ? "기록 없음" : `${formatCount(cell.count)} ${unit}`;
}

/**
 * One source's day strip: equal cells on one shared scale. Shapes, not only
 * color, carry the state — hatched = 수집 실패, warn outline = 공백, dashed =
 * 재수집 중, centre dot = 재수집 완료(기록 없음), empty track = 기록 없음.
 */
export function StatusStrip({
  cells,
  label,
  unit,
  hovered,
  evidence,
  onHover,
  failTone,
  className,
}: {
  cells: StatusCell[];
  label: string;
  unit: string;
  hovered: number | null;
  /** Date keys lit by an AI line; others dim while set. */
  evidence?: ReadonlySet<string> | null;
  onHover?: (index: number | null) => void;
  failTone?: "up" | "warn";
  className?: string;
}) {
  return (
    <ol
      aria-label={`${label} 날짜별 기록`}
      className={cn("relative m-0 grid h-6 list-none gap-0.5 p-0 xl:gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      onMouseLeave={() => onHover?.(null)}
    >
      {cells.map((cell, i) => {
        const ev = evidence ? (evidence.has(cell.date) ? "on" : "dim") : undefined;
        return (
          <li
            key={cell.date}
            data-kind={cell.kind}
            onMouseEnter={() => onHover?.(i)}
            className={cn(
              "relative h-6 rounded-[4px] transition-[box-shadow,opacity] duration-150",
              ev === "dim" && "opacity-30",
              cell.isToday &&
                "after:absolute after:-bottom-2 after:left-1/2 after:-ml-0.5 after:size-1 after:rounded-full after:bg-brand"
            )}
            style={withRing(
              cellStyle(cell.kind, cell.level, failTone),
              hovered === i ? "var(--ink2)" : ev === "on" ? "var(--brand)" : null
            )}
          >
            <span className="sr-only">
              {formatDay(cell.date)}: {cellText(cell, unit)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
