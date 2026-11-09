"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { evidenceMatches } from "@/lib/facts/evidence";
import type { FactEvidence } from "@/lib/facts/types";

export type EvidenceState = "on" | "dim" | undefined;

interface EvidenceContextValue {
  active: FactEvidence | null;
  /** Hover/focus on an AI line or annotation. Ignored while a popover is pinned. */
  activate: (evidence: FactEvidence, source: "pointer" | "focus") => void;
  deactivate: () => void;
  /** An evidence popover opened: keep this evidence lit until it closes. */
  pin: (evidence: FactEvidence | null) => void;
  /** The popover closed (Esc, outside click, second click): clear the highlight. */
  unpin: () => void;
}

const EvidenceContext = createContext<EvidenceContextValue | null>(null);

/**
 * Page-wide coordination so only ONE evidence highlight is ever lit: lighting a
 * scope clears whichever scope was lit before, and while a popover is pinned,
 * hover elsewhere lights nothing.
 */
interface ScopeHandle {
  clear: () => void;
}
let litScope: ScopeHandle | null = null;
let pinnedScope: ScopeHandle | null = null;

/** After a popover closes Radix returns focus to the trigger; don't relight on that. */
const FOCUS_RETURN_GRACE_MS = 150;

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
 * host to style (e.g. `data-[evidence=on]:bg-brand`). An open evidence popover
 * keeps its highlight until it closes, and closing clears it.
 */
export function EvidenceScope({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<FactEvidence | null>(null);
  const [handle] = useState<ScopeHandle>(() => ({ clear: () => setActive(null) }));
  const ignoreFocusUntil = useRef(0);

  const light = useCallback(
    (evidence: FactEvidence | null) => {
      if (evidence) {
        if (litScope && litScope !== handle) litScope.clear();
        litScope = handle;
      } else if (litScope === handle) {
        litScope = null;
      }
      setActive(evidence);
    },
    [handle]
  );

  const activate = useCallback(
    (evidence: FactEvidence, source: "pointer" | "focus") => {
      if (pinnedScope) return;
      if (source === "focus" && Date.now() < ignoreFocusUntil.current) return;
      light(evidence);
    },
    [light]
  );

  const deactivate = useCallback(() => {
    if (pinnedScope === handle) return;
    light(null);
  }, [handle, light]);

  const pin = useCallback(
    (evidence: FactEvidence | null) => {
      if (pinnedScope && pinnedScope !== handle) pinnedScope.clear();
      pinnedScope = handle;
      if (evidence) light(evidence);
    },
    [handle, light]
  );

  const unpin = useCallback(() => {
    if (pinnedScope === handle) pinnedScope = null;
    ignoreFocusUntil.current = Date.now() + FOCUS_RETURN_GRACE_MS;
    light(null);
  }, [handle, light]);

  useEffect(
    () => () => {
      if (pinnedScope === handle) pinnedScope = null;
      if (litScope === handle) litScope = null;
    },
    [handle]
  );

  const value = useMemo(
    () => ({ active, activate, deactivate, pin, unpin }),
    [active, activate, deactivate, pin, unpin]
  );
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
  const activate = ctx?.activate;
  const deactivate = ctx?.deactivate;
  return useMemo(() => {
    if (!activate || !deactivate || !evidence) return {};
    return {
      onMouseEnter: () => activate(evidence, "pointer"),
      onMouseLeave: deactivate,
      onFocus: () => activate(evidence, "focus"),
      onBlur: deactivate,
    };
  }, [activate, deactivate, evidence]);
}

/**
 * For evidence popovers (FactTrigger): returns an onOpenChange that pins the
 * highlight while open and clears it on close. `evidence` falls back to whatever
 * the scope has lit (the hover/focus that led to the click). No-op outside a scope.
 */
export function useEvidencePopover(evidence?: FactEvidence | null) {
  const ctx = useContext(EvidenceContext);
  const pin = ctx?.pin;
  const unpin = ctx?.unpin;
  const activeRef = useRef<FactEvidence | null>(null);
  activeRef.current = ctx?.active ?? null;
  return useCallback(
    (open: boolean) => {
      if (!pin || !unpin) return;
      if (open) pin(evidence ?? activeRef.current);
      else unpin();
    },
    [pin, unpin, evidence]
  );
}
