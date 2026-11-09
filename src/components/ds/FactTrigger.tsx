"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ReactNode, useCallback, useRef, useState } from "react";
import type { FactEvidence, FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";
import { useEvidencePopover } from "./evidence";
import { chooseFactPopoverPlacement, pageGutter, type Rect } from "./fact-placement";

/**
 * The evidence list: "이 문장에 쓴 사실" + metric/period → value rows + optional
 * note. Rendered by FactTrigger; exported for static use.
 */
export function FactPopover({
  rows,
  title = "이 문장에 쓴 사실",
  note,
  className,
}: {
  rows: FactRow[];
  title?: string;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-80 max-w-[calc(100vw-32px)] rounded-xl bg-surface px-4 py-3.5 font-sans text-xs leading-[18px] font-normal tracking-normal text-ink shadow-pop",
        className
      )}
    >
      <span className="mb-2 block font-medium text-ink-3">{title}</span>
      {/* One flex row per fact: the label keeps its natural width (never breaking
          mid-word, up to 60%), the value takes the rest and wraps under itself —
          a long value can no longer squeeze the label to one syllable per line. */}
      <dl className="m-0 flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={`${row.label}|${row.value}`} className="flex items-baseline gap-4">
            <dt className="max-w-[60%] shrink-0 text-ink-2 [overflow-wrap:normal]">{row.label}</dt>
            <dd className="num m-0 min-w-0 flex-1 text-right text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <span className="mt-2.5 block text-ink-3">{note}</span> : null}
    </div>
  );
}

/** Facts set in mono: anything carrying a number ("6%", "72분", "+3건"). */
function hasDigit(text: string): boolean {
  return /\d/.test(text);
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

/**
 * The one dotted-underlined fact inside an AI sentence. Click/tap (or Enter)
 * opens the evidence popover; outside click, Escape or a second click closes it.
 * Carries `aria-expanded` and `aria-label="근거 보기: <fact>"`.
 *
 * Placement: the popover clears the whole sentence (not just the trigger, so a
 * two-line sentence stays readable) and opens on the side away from the
 * highlighted evidence; it flips/shifts to stay inside the page gutters. While
 * open, the fact's evidence stays lit; closing clears it.
 */
export function FactTrigger({
  children,
  rows,
  title,
  note,
  numeric,
  align = "start",
  side = "bottom",
  label,
  evidence,
  className,
}: {
  children: ReactNode;
  rows: FactRow[];
  title?: string;
  note?: ReactNode;
  /** Render the trigger in Geist Mono. Default: when the text contains a digit
   * (non-string children default to mono). */
  numeric?: boolean;
  align?: "start" | "center" | "end";
  /** Preferred side when no highlighted evidence decides it. */
  side?: "bottom" | "top";
  /** Text for the aria-label when children aren't plain text. */
  label?: string;
  /** Evidence to keep lit while open (default: whatever the scope has lit). */
  evidence?: FactEvidence | null;
  className?: string;
}) {
  const text = label ?? (typeof children === "string" ? children : undefined);
  const mono = numeric ?? (text === undefined || hasDigit(text));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ side, sideOffset: 6, gutter: 16 });
  const onEvidence = useEvidencePopover(evidence);

  const onOpenChange = useCallback(
    (next: boolean) => {
      const trigger = triggerRef.current;
      if (next && trigger) {
        const sentence = trigger.closest(".ai-voice, p, li") ?? trigger.parentElement ?? trigger;
        // Avoid the lit evidence and any other chart annotation labels nearby.
        const own = trigger.closest("[data-chart-annotation]");
        const avoid = [
          ...Array.from(document.querySelectorAll('[data-evidence="on"]')),
          ...Array.from(document.querySelectorAll("[data-chart-annotation] .ds-fact")).filter(
            (el) => !own?.contains(el)
          ),
        ];
        const lit = avoid.map(rectOf).filter((r) => r.bottom > r.top && r.right > r.left);
        setPlacement({
          ...chooseFactPopoverPlacement({
            trigger: rectOf(trigger),
            sentence: rectOf(sentence),
            evidence: lit,
            preferred: side,
          }),
          gutter: pageGutter(window.innerWidth),
        });
      }
      setOpen(next);
      onEvidence(next);
    },
    [side, onEvidence]
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        ref={triggerRef}
        type="button"
        aria-label={text ? `근거 보기: ${text}` : "근거 보기"}
        className={cn("ds-fact", mono && "num", className)}
      >
        {children}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={placement.side}
          align={align}
          sideOffset={placement.sideOffset}
          collisionPadding={{
            top: 16,
            bottom: 16,
            left: placement.gutter,
            right: placement.gutter,
          }}
          aria-label="근거"
          className="ds-pop z-50 origin-(--radix-popover-content-transform-origin) outline-none"
        >
          <FactPopover rows={rows} title={title} note={note} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
