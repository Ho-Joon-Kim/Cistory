"use client";

import { useCallback } from "react";
import { type EvidenceState, useEvidence } from "@/components/ds";
import { evidenceTag, tagFamily } from "@/modules/overview/view/evidence-tag";

/**
 * `useEvidence` for a host that draws one series (`tag` = "commits", "steps",
 * "cash", "weight" …). Evidence tagged for another series leaves this host dim even
 * when its keys collide (same day / month keys); untagged evidence behaves as before.
 */
export function useTaggedEvidence(tag: string) {
  const { active, stateOf, isActive } = useEvidence();
  const activeTag = evidenceTag(active);
  const foreign = activeTag !== null && tagFamily(activeTag) !== tagFamily(tag);
  const tagged = useCallback(
    (key: string): EvidenceState => (foreign ? "dim" : stateOf(key)),
    [foreign, stateOf]
  );
  return { active, activeTag, stateOf: tagged, isActive };
}
