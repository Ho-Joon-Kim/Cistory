"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { factRows, renderTemplate } from "@/lib/facts/template";
import type { Fact, FactEvidence, FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";
import { useEvidence, useEvidenceTrigger } from "./evidence";
import { FactTrigger } from "./FactTrigger";

/** The particle or punctuation glued to the end of a fact ("은", ")이에요."). */
const GLUE_AFTER = /^[^\s]+/;
/** An opening bracket or quote glued to the start of a fact ("(" in "작업(chore 13건"). */
const GLUE_BEFORE = /[([{“‘"'「『]+$/;

/** Cuts the glued run off `nodes[at]` (a string) and returns it. */
function takeGlue(nodes: ReactNode[], at: number, re: RegExp, side: "start" | "end"): string {
  const text = nodes[at];
  if (typeof text !== "string") return "";
  const glue = text.match(re)?.[0] ?? "";
  if (glue) nodes[at] = side === "end" ? text.slice(0, -glue.length) : text.slice(glue.length);
  return glue;
}

/**
 * Wraps each fact trigger with the text glued to it in a no-wrap span. The
 * trigger is a `<button>` (atomic inline), so the line could otherwise break
 * right after it and strand "은" or ")이에요." at the start of the next line.
 */
export function glueFacts(nodes: ReactNode[], isFact: (node: ReactNode) => boolean): ReactNode[] {
  const rest = [...nodes];
  const out: ReactNode[] = [];
  rest.forEach((node, i) => {
    if (!isFact(node)) {
      out.push(node);
      return;
    }
    const before = takeGlue(out, out.length - 1, GLUE_BEFORE, "end");
    const after = takeGlue(rest, i + 1, GLUE_AFTER, "start");
    out.push(
      before || after ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional, like the segments
        <span key={`fact-${i}`} className="whitespace-nowrap">
          {before}
          {node}
          {after}
        </span>
      ) : (
        node
      )
    );
  });
  return out;
}

const isFactTrigger = (node: ReactNode) => isValidElement(node) && node.type === FactTrigger;

/**
 * One line of interpretation attached to its host (6px under it): serif 500,
 * --ink2, 13/21 → 14/22. Exactly one fact inside is the dotted trigger, set in
 * mono only when it is a pure number+unit ("72분", "85.2kg") and in the serif
 * voice otherwise — dates and phrases included ("9월 6일 이후"). Hover or focus anywhere on the line activates the fact's evidence
 * in the nearest EvidenceScope. Renders nothing when there is no notable fact —
 * never filler.
 *
 * Two ways to use it:
 *   <AiLine fact={pickOne(facts)} />                // template-rendered
 *   <AiLine evidence={ev}>그중 <FactTrigger rows={rows}>42%</FactTrigger> …</AiLine>
 */
export function AiLine({
  fact,
  children,
  evidence,
  rows,
  title,
  note,
  align,
  side,
  tint = false,
  className,
  as: Tag = "p",
}: {
  fact?: Fact | null;
  children?: ReactNode;
  /** Evidence for hand-written lines (ignored when `fact` is given). */
  evidence?: FactEvidence | null;
  /** Popover rows override for `fact` (default: factRows(fact)). Pass `fact.rows`
   * when the fact's own rows already state the metric and baseline. */
  rows?: FactRow[];
  /** Popover heading (default "이 문장에 쓴 사실"). */
  title?: string;
  note?: ReactNode;
  /** Popover alignment against the trigger. */
  align?: "start" | "center" | "end";
  side?: "bottom" | "top";
  /** Tint the line on hover/focus — for cards where the line itself is a hover
   * target that lights evidence in a chart above it. */
  tint?: boolean;
  className?: string;
  as?: "p" | "span" | "div";
}) {
  const ownEvidence = fact ? fact.evidence : evidence;
  const handlers = useEvidenceTrigger(ownEvidence);
  const { active } = useEvidence();
  // Inside a scope the tint follows the scope's (single, page-wide) highlight, so
  // it clears with the popover instead of lingering on focus-within after Esc.
  const scoped = Object.keys(handlers).length > 0;
  const lit = scoped && active !== null && active === ownEvidence;
  if (!fact && !children) return null;

  let content: ReactNode = glueFacts(Children.toArray(children), isFactTrigger);
  if (fact) {
    const rendered = renderTemplate(fact);
    const popRows = rows ?? factRows(fact);
    content = glueFacts(
      rendered.segments.map((segment, i) =>
        segment.type === "fact" ? (
          <FactTrigger
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            rows={popRows}
            title={title}
            note={note}
            numeric={rendered.numeric}
            align={align}
            side={side}
            evidence={fact.evidence}
          >
            {segment.text}
          </FactTrigger>
        ) : (
          segment.text
        )
      ),
      isFactTrigger
    );
  }

  return (
    <Tag
      className={cn(
        "ai-voice m-0 text-pretty",
        tint && "-mx-1 rounded-md px-1 transition-colors duration-150 ease-out",
        tint &&
          (scoped ? lit && "bg-brand-soft" : "hover:bg-brand-soft focus-within:bg-brand-soft"),
        className
      )}
      data-fact-id={fact?.id}
      {...handlers}
    >
      {content}
    </Tag>
  );
}
