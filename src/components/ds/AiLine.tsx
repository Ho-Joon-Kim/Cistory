"use client";

import type { ReactNode } from "react";
import { factRows, renderTemplate } from "@/lib/facts/template";
import type { Fact, FactEvidence, FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";
import { useEvidenceTrigger } from "./evidence";
import { FactTrigger } from "./FactTrigger";

/**
 * One line of interpretation attached to its host (6px under it): serif 500,
 * --ink2, 13/21 → 14/22. Exactly one fact inside is the dotted trigger. Hover or
 * focus anywhere on the line activates the fact's evidence in the nearest
 * EvidenceScope. Renders nothing when there is no notable fact — never filler.
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
  note,
  align,
  className,
  as: Tag = "p",
}: {
  fact?: Fact | null;
  children?: ReactNode;
  /** Evidence for hand-written lines (ignored when `fact` is given). */
  evidence?: FactEvidence | null;
  /** Popover rows override for `fact` (default: factRows(fact)). */
  rows?: FactRow[];
  note?: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  as?: "p" | "span" | "div";
}) {
  const handlers = useEvidenceTrigger(fact ? fact.evidence : evidence);
  if (!fact && !children) return null;

  let content: ReactNode = children;
  if (fact) {
    const rendered = renderTemplate(fact);
    const popRows = rows ?? factRows(fact);
    content = rendered.segments.map((segment, i) =>
      segment.type === "fact" ? (
        <FactTrigger
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          key={i}
          rows={popRows}
          note={note}
          numeric={rendered.numeric}
          align={align}
        >
          {segment.text}
        </FactTrigger>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
        <span key={i}>{segment.text}</span>
      )
    );
  }

  return (
    <Tag className={cn("ai-voice m-0", className)} data-fact-id={fact?.id} {...handlers}>
      {content}
    </Tag>
  );
}
