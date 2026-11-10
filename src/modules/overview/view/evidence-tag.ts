import { shiftDateKey } from "@/lib/date-key";
import type { Fact, FactEvidence } from "@/lib/facts";

/**
 * The overview is one evidence scope, and many of its charts key their items by
 * the same strings (KST days, `YYYY-MM` months). Without a series marker a steps
 * fact about "2026-10" lit the commit sparkline's October bar too, and a cash fact
 * about one day lit that day in whatever the flow chart was showing.
 *
 * A fact's evidence therefore carries one tag key ("@steps", "@cash.income" …).
 * No host item key starts with "@", so plain `evidenceMatches` never matches it;
 * hosts read it with {@link evidenceTag} and stay dim unless they draw that series.
 */
const PREFIX = "@";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXPANDED_DAYS = 400;

export function tagEvidence(
  evidence: FactEvidence | null | undefined,
  tag: string
): FactEvidence | null {
  if (!evidence) return null;
  if (evidence.kind === "keys") {
    return {
      kind: "keys",
      keys: [...evidence.keys.filter((k) => !k.startsWith(PREFIX)), PREFIX + tag],
    };
  }
  // A range can't carry a tag; day ranges expand to their keys.
  if (!DAY.test(evidence.from) || !DAY.test(evidence.to)) return evidence;
  const keys: string[] = [];
  for (
    let d = evidence.from;
    d <= evidence.to && keys.length < MAX_EXPANDED_DAYS;
    d = shiftDateKey(d, 1)
  ) {
    keys.push(d);
  }
  return { kind: "keys", keys: [...keys, PREFIX + tag] };
}

export function tagFact<T extends Fact | null>(fact: T, tag: string): T {
  if (!fact) return fact;
  return { ...fact, evidence: tagEvidence(fact.evidence, tag) ?? undefined } as T;
}

/** The series a lit evidence belongs to ("cash.income"), or null when untagged. */
export function evidenceTag(evidence: FactEvidence | null | undefined): string | null {
  if (evidence?.kind !== "keys") return null;
  const key = evidence.keys.find((k) => k.startsWith(PREFIX));
  return key ? key.slice(PREFIX.length) : null;
}

/** "cash.income" → "cash". */
export function tagFamily(tag: string): string {
  const dot = tag.indexOf(".");
  return dot < 0 ? tag : tag.slice(0, dot);
}
