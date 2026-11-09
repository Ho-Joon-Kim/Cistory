import type { Fact } from "./types";

/** Default notability bar: a fact must score at least this to earn a sentence. */
export const NOTABLE_THRESHOLD = 0.5;

/**
 * Facts at or above `threshold`, most notable first (ties broken by id so the
 * choice is deterministic across renders). An empty result means "no AI line" —
 * callers render nothing rather than filler.
 */
export function pickNotable(
  facts: ReadonlyArray<Fact | null | undefined>,
  threshold = NOTABLE_THRESHOLD,
  limit = Number.POSITIVE_INFINITY
): Fact[] {
  return facts
    .filter((f): f is Fact => f != null && f.score >= threshold)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** The single most notable fact, or null. One AI line per host component. */
export function pickOne(
  facts: ReadonlyArray<Fact | null | undefined>,
  threshold = NOTABLE_THRESHOLD
): Fact | null {
  return pickNotable(facts, threshold, 1)[0] ?? null;
}
