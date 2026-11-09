"use client";

import { useEvidenceTrigger } from "@/components/ds";
import { FactTrigger } from "@/components/ds/FactTrigger";
import { factRows, renderTemplate } from "@/lib/facts/template";
import type { Fact } from "@/lib/facts/types";
import { cn } from "@/lib/utils";

/**
 * One AI line for a /health card: the template rendered from the fact, with its
 * single dotted trigger opening the evidence popover. Same contract as the shared
 * AiLine (renders nothing without a fact; hover/focus lights the evidence in the
 * enclosing EvidenceScope) but the trigger is mono whenever it starts with a
 * number ("72분", "85.2kg"), which the shared detector treats as text.
 */
export function HealthAiLine({
  fact,
  title,
  className,
}: {
  fact: Fact | null;
  title: string;
  className?: string;
}) {
  const handlers = useEvidenceTrigger(fact?.evidence);
  if (!fact) return null;
  const rendered = renderTemplate(fact);
  const rows = fact.rows && fact.rows.length > 0 ? fact.rows : factRows(fact);
  return (
    <p
      className={cn(
        "ai-voice m-0 -mx-1 rounded-md px-1 transition-colors duration-150 ease-out hover:bg-brand-soft focus-within:bg-brand-soft",
        className
      )}
      data-fact-id={fact.id}
      {...handlers}
    >
      {rendered.segments.map((segment, i) =>
        segment.type === "fact" ? (
          <FactTrigger
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            rows={rows}
            title={title}
            numeric={/^[\d−+-]/.test(segment.text)}
          >
            {segment.text}
          </FactTrigger>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <span key={i}>{segment.text}</span>
        )
      )}
    </p>
  );
}
