"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedItem<V extends string> {
  value: V;
  label: string;
  /** Accessible name when the label is terse ("주" → "주 단위"). */
  ariaLabel?: string;
}

/**
 * Segmented control with a sliding thumb (height 36, ≤ 5 items). Items are equal
 * width; on phones it fills the row (items never wrap), from sm it fits content.
 * On phones and coarse pointers each item's hit area is 44px tall.
 * Each item is a toggle button with `aria-pressed`; the group is labelled.
 */
export function Segmented<V extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  fullWidth = "mobile",
  className,
}: {
  items: ReadonlyArray<SegmentedItem<V>>;
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  /** "mobile" (default): full width below sm; "always"; "never". */
  fullWidth?: "mobile" | "always" | "never";
  className?: string;
}) {
  if (process.env.NODE_ENV !== "production" && items.length > 5) {
    console.warn("Segmented: use at most 5 items");
  }
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  );
  const n = Math.max(1, items.length);
  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        "relative m-0 grid min-w-0 border-0 h-9 auto-cols-fr grid-flow-col rounded-lg bg-track p-[3px]",
        fullWidth === "always" && "w-full",
        fullWidth === "mobile" && "w-full sm:w-fit",
        fullWidth === "never" && "w-fit",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="ds-seg-thumb absolute top-[3px] left-[3px] h-[30px] rounded-[7px] bg-surface shadow-ring"
        style={
          {
            width: `calc((100% - 6px) / ${n})`,
            translate: `${index * 100}% 0`,
          } as CSSProperties
        }
      />
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            aria-label={item.ariaLabel}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative z-[1] h-[30px] cursor-pointer rounded-[7px] border-0 bg-transparent px-3 text-[13px] whitespace-nowrap transition-colors duration-150 ease-out focus-ring focus-visible:outline-offset-1",
              // 44px-tall hit area on phones and touch screens (thumb stays 30).
              "max-sm:tap-target pointer-coarse:tap-target",
              on ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </fieldset>
  );
}
