"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { evidenceMatches } from "@/lib/facts/evidence";
import type { FactEvidence } from "@/lib/facts/types";

export type EvidenceState = "on" | "dim" | undefined;

interface EvidenceContextValue {
  active: FactEvidence | null;
  setActive: (evidence: FactEvidence | null) => void;
}

const EvidenceContext = createContext<EvidenceContextValue | null>(null);

/**
 * Wrap a host component (a chart + its AI line, a ranked list …). While an AI
 * line or annotation inside is hovered/focused, its fact's evidence is active and
 * hosts can light those items up and dim the rest:
 *
 *   <EvidenceScope>
 *     <Bars />            // inside: const { stateOf } = useEvidence();
 *                         //   <div data-evidence={stateOf(day.key)} … />
 *     <AiLine fact={fact} />
 *   </EvidenceScope>
 *
 * `data-evidence="dim"` fades to 35% over 150ms (globals.css); `"on"` is for the
 * host to style (e.g. `data-[evidence=on]:bg-brand`).
 */
export function EvidenceScope({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<FactEvidence | null>(null);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}

/** Read side for hosts; safe outside a scope (never highlights). */
export function useEvidence() {
  const ctx = useContext(EvidenceContext);
  const active = ctx?.active ?? null;
  const stateOf = useCallback(
    (key: string): EvidenceState =>
      active ? (evidenceMatches(active, key) ? "on" : "dim") : undefined,
    [active]
  );
  return { active, stateOf, isActive: active !== null };
}

/** Write side: props to spread on the element whose hover/focus activates evidence. */
export function useEvidenceTrigger(evidence: FactEvidence | null | undefined) {
  const ctx = useContext(EvidenceContext);
  return useMemo(() => {
    if (!ctx || !evidence) return {};
    const on = () => ctx.setActive(evidence);
    const off = () => ctx.setActive(null);
    return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
  }, [ctx, evidence]);
}
