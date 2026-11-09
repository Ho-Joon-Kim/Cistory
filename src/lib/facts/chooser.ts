/**
 * Extension point: who decides which facts become sentences, and how they read.
 *
 * Today the {@link templateChooser} picks by score and uses the kind's default
 * template — no model call. A future LLM chooser implements the same interface:
 *
 *   1. Callers build the full fact catalog in code and pass only the top-N
 *      candidates (`pickNotable(facts, threshold, N)`), serialized with
 *      {@link toCandidate} — ids, numbers and labels, ~1–2k tokens per period.
 *   2. The chooser returns `FactChoice[]`: which fact ids to show and, optionally,
 *      a sentence template per fact using `{fact}` / named placeholders. It never
 *      returns numbers; `renderTemplate` formats them from the fact.
 *   3. Every returned template is checked with `validateTemplate`; an invalid one
 *      falls back to the default template (see {@link applyChoices}).
 *
 * Cost rules for that implementation (design-spec-v2-ai): one structured call per
 * (user, period) covering every line on a page, cached by hash(candidates +
 * prompt version), skipped entirely when no candidate passes the threshold, and
 * degraded to this template chooser when a budget is exceeded.
 */
import { pickNotable } from "./pick";
import { renderTemplate, validateTemplate } from "./template";
import type { Fact, RenderedFact } from "./types";

export interface FactChoice {
  factId: string;
  /** Optional phrasing with exactly one `{fact}`. */
  template?: string;
}

export interface FactChooser {
  choose(candidates: Fact[]): FactChoice[] | Promise<FactChoice[]>;
}

/** Score-ordered, default templates, no model. */
export const templateChooser: FactChooser = {
  choose: (candidates) => pickNotable(candidates).map((f) => ({ factId: f.id })),
};

/** Compact, number-only payload for a model prompt. */
export function toCandidate(fact: Fact) {
  return {
    id: fact.id,
    kind: fact.kind,
    metric: fact.metric,
    period: fact.period,
    value: fact.value,
    unit: fact.unit,
    baseline: fact.baseline,
    score: Math.round(fact.score * 100) / 100,
    detail: fact.detail,
  };
}

/**
 * Renders a chooser's picks. Unknown ids are ignored; a template that fails
 * validation is replaced by the fact's default template.
 */
export function applyChoices(facts: Fact[], choices: FactChoice[]): RenderedFact[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: RenderedFact[] = [];
  for (const choice of choices) {
    const fact = byId.get(choice.factId);
    if (!fact) continue;
    const usable = choice.template && validateTemplate(fact, choice.template).length === 0;
    out.push(renderTemplate(fact, usable ? choice.template : undefined));
  }
  return out;
}
