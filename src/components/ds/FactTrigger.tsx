"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type CSSProperties, Fragment, type ReactNode, useCallback, useRef, useState } from "react";
import type { FactEvidence, FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";
import { announceEvidenceOpen, useEvidencePopover } from "./evidence";
import {
  chooseFactPopoverPlacement,
  estimateFactPopoverHeight,
  factPopoverBounds,
  type Rect,
  scrollToFitPopover,
} from "./fact-placement";
import { factValueParts, isMonoFactValue } from "./fact-text";

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
        "w-80 max-w-[min(calc(100vw-32px),var(--fact-pop-max,100vw))] rounded-xl bg-surface px-4 py-3.5 font-sans text-xs leading-[18px] font-normal tracking-normal text-ink shadow-pop",
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
            <dd
              className={cn(
                "m-0 min-w-0 flex-1 text-right text-ink tabular-nums",
                isMonoFactValue(row.value) && "num"
              )}
            >
              <FactValue value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
      {note ? <span className="mt-2.5 block text-ink-3">{note}</span> : null}
    </div>
  );
}

/** A value whose short list entries never break mid-entry ("11월 / 6일 16:51"). */
function FactValue({ value }: { value: string }) {
  const parts = factValueParts(value);
  if (parts.length === 1 && !parts[0].keep) return <>{value}</>;
  // Key each entry by where it starts in the value (entries can repeat).
  let offset = 0;
  const keyed = parts.map((part) => {
    const at = value.indexOf(part.text, offset);
    offset = at + part.text.length;
    return { ...part, at };
  });
  return keyed.map((part) => (
    <Fragment key={part.at}>
      {part.at > 0 ? " " : null}
      <span className={part.keep ? "whitespace-nowrap" : undefined}>{part.text}</span>
    </Fragment>
  ));
}

/** Facts set in mono: anything carrying a number ("6%", "72분", "+3건"). */
function hasDigit(text: string): boolean {
  return /\d/.test(text);
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

/** Chart-like things a popover shouldn't cover. `data-evidence-avoid` lets a host
 * mark anything else (a hypnogram made of spans, a map …). */
const CHART_SELECTOR =
  'svg, canvas, [role="img"], .recharts-wrapper, [data-chart], [data-evidence-avoid]';
const MIN_CHART_W = 80;
const MIN_CHART_H = 40;
const MAX_HOST_DEPTH = 5;

/**
 * The nearest ancestor of the sentence that also holds a visible chart (the AI
 * line's host card/column) and that chart's rects. A host can name itself with
 * `data-fact-host`.
 */
function chartHost(trigger: Element, sentence: Element): { host: Element | null; charts: Rect[] } {
  const declared = trigger.closest("[data-fact-host]");
  let node: Element | null = declared ?? sentence.parentElement;
  for (let depth = 0; node && depth < MAX_HOST_DEPTH; depth++) {
    if (node === document.body || node.tagName === "MAIN") break;
    const charts = Array.from(node.querySelectorAll(CHART_SELECTOR))
      .filter((el) => !el.contains(trigger) && !sentence.contains(el))
      .map(rectOf)
      .filter((r) => r.right - r.left >= MIN_CHART_W && r.bottom - r.top >= MIN_CHART_H);
    if (charts.length > 0 || declared) return { host: node, charts };
    node = node.parentElement;
  }
  return { host: null, charts: [] };
}

/**
 * The one dotted-underlined fact inside an AI sentence. Click/tap (or Enter)
 * opens the evidence popover; outside click, Escape or a second click closes it.
 * Carries `aria-expanded` and `aria-label="근거 보기: <fact>"`.
 *
 * Placement: the popover clears the whole sentence (not just the trigger, so a
 * two-line sentence stays readable) and opens on the side away from the
 * highlighted evidence — or, when the host lights nothing with `data-evidence`,
 * away from the host's charts (svg/canvas/role=img/`data-evidence-avoid`) — even
 * when there is room on the other side. It stays inside its host column in a
 * multi-column row and flips/shifts to stay inside the page gutters. Opening it
 * fires EVIDENCE_OPEN_EVENT so chart hover tooltips close. While
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
  const [placement, setPlacement] = useState<{
    side: "top" | "bottom";
    sideOffset: number;
    left: number;
    right: number;
    maxWidth: number | null;
  }>({ side, sideOffset: 6, left: 16, right: 16, maxWidth: null });
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
        // Hosts that light evidence without data-evidence attributes (health's
        // hypnogram, HR and weight plots): stay off the host's charts instead.
        // Annotations live inside their chart, so they rely on lit evidence only.
        const { host, charts } = own ? { host: null, charts: [] } : chartHost(trigger, sentence);
        const chosen = chooseFactPopoverPlacement({
          trigger: rectOf(trigger),
          sentence: rectOf(sentence),
          evidence: lit,
          regions: charts,
          preferred: side,
        });
        // A fact at the viewport edge: scroll so the popover fits on the chosen
        // side rather than letting Radix flip it over the evidence.
        const delta = scrollToFitPopover({
          ...chosen,
          trigger: rectOf(trigger),
          height: estimateFactPopoverHeight(rows.length, note != null),
          viewportHeight: window.innerHeight,
        });
        if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
        setPlacement({
          ...chosen,
          ...factPopoverBounds({
            viewportWidth: document.documentElement.clientWidth,
            column: host ? rectOf(host) : null,
          }),
        });
        announceEvidenceOpen();
      }
      setOpen(next);
      onEvidence(next);
    },
    [side, onEvidence, rows.length, note]
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
            left: placement.left,
            right: placement.right,
          }}
          style={
            placement.maxWidth
              ? ({ "--fact-pop-max": `${placement.maxWidth}px` } as CSSProperties)
              : undefined
          }
          aria-label="근거"
          className="ds-pop z-50 origin-(--radix-popover-content-transform-origin) outline-none"
        >
          <FactPopover rows={rows} title={title} note={note} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
