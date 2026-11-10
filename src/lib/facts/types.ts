/**
 * Fact objects — the unit the AI layer works with.
 *
 * Code computes facts from real data (deltas, concentration, records, one-offs,
 * streaks, diagnoses); a chooser decides which ones are notable and how they are
 * phrased; numbers are always rendered from the fact, never typed by a model.
 */

/** What kind of observation a fact is; selects its default template. */
export type FactKind =
  | "delta" // value vs a previous/usual/target baseline
  | "concentration" // a contiguous window holds a large share of the total
  | "record" // the value is the highest/lowest in a history
  | "one_off" // a single item dominates its total
  | "streak" // consecutive active days up to the end of the period
  | "diagnosis"; // a status explanation (data-status/settings); text supplied by caller

export type FactUnit =
  | "count" // 건 / 회 — use `unitLabel` for the counter word
  | "won"
  | "percent" // value is a ratio 0..1
  | "km"
  | "minutes"
  | "steps"
  | "days";

export interface FactPeriod {
  /** Inclusive KST date keys (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Short Korean label as shown in sentences, e.g. "10월", "최근 30일". */
  label: string;
}

export interface FactBaseline {
  value: number;
  /** "9월", "평소", "목표", "30일 합" … — used in sentences and the popover. */
  label: string;
  kind: "previous" | "usual" | "target" | "total" | "max" | "second";
}

/**
 * What a host component should highlight while the user hovers/focuses the AI
 * line that cites this fact. Hosts test their own item keys against it with
 * `evidenceMatches` (see `src/lib/facts/evidence.ts`).
 */
export type FactEvidence =
  | { kind: "range"; from: string; to: string }
  | { kind: "keys"; keys: string[] };

export interface Fact {
  /** Stable id, unique within a page (e.g. "coding.commits.burst"). */
  id: string;
  kind: FactKind;
  /** Machine metric id, e.g. "commits", "spending", "steps". */
  metric: string;
  /** Korean metric label for sentences/popovers, e.g. "커밋". */
  metricLabel: string;
  period: FactPeriod;
  /** The fact's headline number (ratio for percent units). */
  value: number;
  baseline?: FactBaseline;
  unit: FactUnit;
  /** Counter word for `count` units: "건", "회", "보" … */
  unitLabel?: string;
  /** Notability 0..1. `pickNotable` keeps facts at or above a threshold. */
  score: number;
  evidence?: FactEvidence;
  /**
   * Kind-specific parameters the default templates read (e.g. concentration's
   * `partValue`, `windowLabel`; record's `direction`). Values are already
   * computed numbers or short labels.
   */
  detail?: Record<string, string | number | boolean>;
  /**
   * Optional sentence override. `{fact}` marks the single trigger (rendered as
   * the dotted fact button), `{name}` interpolates `detail[name]` or one of the
   * built-ins (`value`, `baseline`, `period`, `metric`). This is the slot a
   * future LLM chooser fills; the numbers still come from the fact.
   */
  template?: string;
  /** Extra popover rows beyond the defaults derived from the fact. */
  rows?: FactRow[];
}

/** One line of the evidence popover. */
export interface FactRow {
  label: string;
  value: string;
}

/** A rendered sentence: plain text runs plus exactly one trigger run. */
export type TemplateSegment = { type: "text"; text: string } | { type: "fact"; text: string };

export interface RenderedFact {
  factId: string;
  segments: TemplateSegment[];
  /** Plain-text sentence (for aria-labels, tests, logs). */
  text: string;
  /** Whether the trigger run is numeric (render it in mono). */
  numeric: boolean;
}
