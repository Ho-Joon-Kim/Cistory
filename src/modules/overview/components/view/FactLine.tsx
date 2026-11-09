"use client";

import { AiLine, FactTrigger } from "@/components/ds";
import { type Fact, factRows, renderTemplate } from "@/lib/facts";
import { cn } from "@/lib/utils";

/**
 * An AI line rendered from a template-first fact: serif voice, one dotted fact
 * that opens its evidence, hover/focus lights the evidence in the nearest
 * EvidenceScope. Renders nothing without a fact.
 */
export function FactLine({
  fact,
  className,
  align,
}: {
  fact: Fact | null | undefined;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  if (!fact) return null;
  const rendered = renderTemplate(fact);
  const rows = factRows(fact);
  return (
    <AiLine evidence={fact.evidence} className={cn("text-pretty", className)}>
      {rendered.segments.map((segment, i) =>
        segment.type === "fact" ? (
          <FactTrigger
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            rows={rows}
            numeric={/\d/.test(segment.text)}
            align={align}
          >
            {segment.text}
          </FactTrigger>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <span key={i}>{segment.text}</span>
        )
      )}
    </AiLine>
  );
}
