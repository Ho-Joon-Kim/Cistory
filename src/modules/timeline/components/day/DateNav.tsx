"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { shiftDateKey } from "@/lib/date-key";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthOf(date: string): { year: number; month: number } {
  const [y, m] = date.split("-").map(Number);
  return { year: y, month: m };
}

function key(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The tiny date control: `‹ 11월 9일 (월) ›`. The arrows step a day; the date
 * itself opens a one-month calendar (days after today disabled).
 */
export function DateNav({
  date,
  today,
  onChange,
  variant = "inline",
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
  /** inline = 14px at the start of the meta line; pill = 28px translucent pill on the map. */
  variant?: "inline" | "pill";
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(date));
  const canNext = date < today;
  const pill = variant === "pill";

  const daysInMonth = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();
  const todayMonth = monthOf(today);
  const canNextMonth =
    view.year < todayMonth.year || (view.year === todayMonth.year && view.month < todayMonth.month);

  const stepMonth = (delta: number) =>
    setView((v) => {
      const m = v.month + delta;
      return m < 1
        ? { year: v.year - 1, month: 12 }
        : m > 12
          ? { year: v.year + 1, month: 1 }
          : { ...v, month: m };
    });

  const navButton =
    "relative inline-flex size-6 items-center justify-center rounded-md border-0 bg-transparent p-0 text-ink-3 transition-colors duration-150 ease-out before:absolute before:-inset-2.5 before:content-[''] hover:enabled:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-35";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of date controls, not a fieldset
    <div
      role="group"
      aria-label="날짜 이동"
      className={cn(
        "relative inline-flex items-center",
        pill &&
          "h-7 rounded-full bg-[color-mix(in_oklab,var(--surface)_78%,transparent)] px-0.5 shadow-ring backdrop-blur-[8px]"
      )}
    >
      <button
        type="button"
        className={navButton}
        aria-label="이전 날"
        onClick={() => onChange(shiftDateKey(date, -1))}
      >
        <ChevronLeft className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
      </button>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setView(monthOf(date));
          setOpen(next);
        }}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-haspopup="dialog"
            className={cn(
              "relative rounded border-0 bg-transparent px-1 font-semibold whitespace-nowrap before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] text-ink hover:bg-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              pill ? "text-xs leading-5" : "text-sm leading-5"
            )}
          >
            {formatDay(date)}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={16}
            aria-label="날짜 선택"
            className="ds-pop z-50 flex w-[262px] origin-(--radix-popover-content-transform-origin) flex-col gap-2 rounded-[14px] bg-surface p-3 shadow-pop outline-none"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] leading-[18px] font-semibold text-ink">
                {view.year}년 {view.month}월
              </span>
              <span className="flex gap-0.5">
                <button
                  type="button"
                  className={navButton}
                  aria-label="이전 달"
                  onClick={() => stepMonth(-1)}
                >
                  <ChevronLeft className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={navButton}
                  aria-label="다음 달"
                  disabled={!canNextMonth}
                  onClick={() => stepMonth(1)}
                >
                  <ChevronRight className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </span>
            </div>
            <div className="grid grid-cols-[repeat(7,32px)] gap-x-[3px] gap-y-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-center text-[11px] leading-4 text-ink-3">
                  {w}
                </span>
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const k = key(view.year, view.month, i + 1);
                const current = k === date;
                const future = k > today;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={future}
                    aria-current={current ? "date" : undefined}
                    aria-label={formatDay(k)}
                    style={i === 0 ? { gridColumnStart: firstWeekday + 1 } : undefined}
                    onClick={() => {
                      setOpen(false);
                      if (!current) onChange(k);
                    }}
                    className={cn(
                      "num h-[30px] rounded-lg border-0 bg-transparent p-0 text-xs text-ink transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:text-ink-3 disabled:opacity-50",
                      current ? "bg-brand font-semibold text-brand-ink" : "hover:enabled:bg-track",
                      k === today && !current && "font-semibold underline underline-offset-4"
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <button
        type="button"
        className={navButton}
        aria-label="다음 날"
        disabled={!canNext}
        onClick={() => onChange(shiftDateKey(date, 1))}
      >
        <ChevronRight className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
