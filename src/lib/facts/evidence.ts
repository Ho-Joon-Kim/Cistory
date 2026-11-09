import type { FactEvidence } from "./types";

/**
 * Whether a host item (a bar's date key, a row id …) is part of a fact's evidence.
 * Range bounds are inclusive and compared as strings, which is correct for
 * zero-padded `YYYY-MM-DD` keys.
 */
export function evidenceMatches(evidence: FactEvidence | null | undefined, key: string): boolean {
  if (!evidence) return false;
  if (evidence.kind === "keys") return evidence.keys.includes(key);
  return key >= evidence.from && key <= evidence.to;
}
