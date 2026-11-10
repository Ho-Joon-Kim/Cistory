/**
 * Template-first phrasing. Every fact kind has a default Korean sentence; a fact
 * may carry its own `template` (hand-written in code today, chosen by an LLM
 * later). Numbers are always formatted here from the fact — a template can only
 * reference them by name.
 */
import { formatCount, formatDurationMinutes, formatShare, formatWon } from "@/lib/format";
import { isQuantityText } from "./face";
import type { Fact, FactRow, FactUnit, RenderedFact, TemplateSegment } from "./types";

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

// ── Korean particles ─────────────────────────────────────────────────────────

/** Whether the last character of `word` is a Hangul syllable with a final consonant. */
export function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) {
    // Digits read in Korean: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 end in a consonant.
    return /[013678]$/.test(last);
  }
  return code % 28 !== 0;
}

/** `이에요` after a final consonant, else `예요` (`605건이에요`, `86%예요`). */
export const eyo = (word: string) => (hasBatchim(word) ? "이에요" : "예요");
/** Subject particle: `커밋이`, `지출이`, `걸음이` / `소비가`. */
export const iGa = (word: string) => (hasBatchim(word) ? "이" : "가");

// ── values ───────────────────────────────────────────────────────────────────

/** Formats a number in a fact unit, unit included (`4,673건`, `541,700원`, `42%`). */
export function formatFactValue(value: number, unit: FactUnit, unitLabel = ""): string {
  switch (unit) {
    case "won":
      return formatWon(value);
    case "percent":
      return formatShare(value);
    case "km":
      return `${(Math.round(value * 10) / 10).toLocaleString("ko-KR")}km`;
    case "minutes":
      return formatDurationMinutes(value);
    case "steps":
      return `${formatCount(value)}걸음`;
    case "days":
      return `${formatCount(value)}일`;
    default:
      return `${formatCount(value)}${unitLabel}`;
  }
}

/** Number only, without the unit (the trigger in `605건` is `605`). */
function bareNumber(value: number, unit: FactUnit): string {
  if (unit === "percent") return formatShare(value);
  if (unit === "km") return (Math.round(value * 10) / 10).toLocaleString("ko-KR");
  return formatCount(value);
}

function unitWord(fact: Fact): string {
  switch (fact.unit) {
    case "won":
      return "원";
    case "steps":
      return "걸음";
    case "days":
      return "일";
    case "km":
      return "km";
    case "percent":
      return "";
    default:
      return fact.unitLabel ?? "";
  }
}

// ── default templates ────────────────────────────────────────────────────────

interface DefaultTemplate {
  template: string;
  trigger: string;
}

function defaultTemplate(fact: Fact): DefaultTemplate {
  const d = fact.detail ?? {};
  switch (fact.kind) {
    case "delta": {
      const ratio = Number(d.ratio ?? 0);
      const word = ratio >= 0 ? String(d.upWord ?? "많아요") : String(d.downWord ?? "적어요");
      return {
        template: `{baseline}보다 {fact} ${word}.`,
        trigger: formatShare(Math.abs(ratio)),
      };
    }
    case "concentration": {
      return {
        // The particle follows the subject (the share), not the parenthetical.
        template: `그중 {fact}({part})${iGa(formatShare(fact.value))} {windowLabel}에 몰렸어요.`,
        trigger: formatShare(fact.value),
      };
    }
    case "record": {
      const unit = unitWord(fact);
      const word = d.direction === "low" ? "적은" : "많은";
      return {
        template: `{scopeLabel} 중 가장 ${word} {fact}${unit}${eyo(unit || bareNumber(fact.value, fact.unit))}.`,
        trigger: bareNumber(fact.value, fact.unit),
      };
    }
    case "one_off": {
      const share = formatShare(fact.value);
      return {
        template: `한 건이 {period} {metric} {baselineValue}의 {fact}${eyo(share)}.`,
        trigger: share,
      };
    }
    case "streak":
      return {
        template: `${fact.metricLabel}${iGa(fact.metricLabel)} {fact}째 이어지고 있어요.`,
        trigger: `${formatCount(fact.value)}일`,
      };
    case "diagnosis":
      return {
        template: fact.template ?? "{fact}",
        trigger: formatFactValue(fact.value, fact.unit, fact.unitLabel),
      };
  }
}

function builtins(fact: Fact): Record<string, string> {
  const values: Record<string, string> = {
    value: formatFactValue(fact.value, fact.unit, fact.unitLabel),
    period: fact.period.label,
    metric: fact.metricLabel,
  };
  if (fact.baseline) {
    values.baseline = fact.baseline.label;
    const baselineUnit =
      fact.kind === "concentration" || fact.kind === "one_off"
        ? ((fact.detail?.partUnit ?? fact.detail?.itemUnit) as FactUnit | undefined)
        : fact.unit;
    const baselineUnitLabel = String(
      fact.detail?.partUnitLabel ?? fact.detail?.itemUnitLabel ?? fact.unitLabel ?? ""
    );
    values.baselineValue = formatFactValue(
      fact.baseline.value,
      baselineUnit ?? "count",
      baselineUnitLabel
    );
  }
  if (fact.detail?.partValue !== undefined) {
    values.part = formatFactValue(
      Number(fact.detail.partValue),
      (fact.detail.partUnit as FactUnit) ?? "count",
      String(fact.detail.partUnitLabel ?? "")
    );
  }
  if (fact.detail?.itemValue !== undefined) {
    values.item = formatFactValue(
      Number(fact.detail.itemValue),
      (fact.detail.itemUnit as FactUnit) ?? "won",
      String(fact.detail.itemUnitLabel ?? "")
    );
  }
  for (const [key, raw] of Object.entries(fact.detail ?? {})) {
    if (key in values) continue;
    values[key] = typeof raw === "number" ? formatCount(raw) : String(raw);
  }
  return values;
}

/**
 * Checks a template against a fact: exactly one `{fact}`, and every other
 * placeholder resolvable. Returns a list of problems (empty = valid). An LLM
 * chooser's output must pass this before it replaces the default template.
 */
export function validateTemplate(fact: Fact, template: string): string[] {
  const problems: string[] = [];
  const names = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const factCount = names.filter((n) => n === "fact").length;
  if (factCount !== 1) problems.push(`expected exactly one {fact}, found ${factCount}`);
  const known = builtins(fact);
  for (const name of names) {
    if (name !== "fact" && !(name in known)) problems.push(`unknown placeholder {${name}}`);
  }
  if (/\d/.test(template.replace(PLACEHOLDER, ""))) {
    problems.push("numbers must come from placeholders, not the template text");
  }
  return problems;
}

/**
 * Renders a fact into text segments with exactly one trigger segment (the dotted
 * fact button). Uses `fact.template` when present, else the kind's default.
 * Throws on an invalid template — templates are code-authored; validate model
 * output with {@link validateTemplate} first.
 */
export function renderTemplate(fact: Fact, template?: string): RenderedFact {
  const fallback = defaultTemplate(fact);
  const source = template ?? fact.template ?? fallback.template;
  const problems = validateTemplate(fact, source).filter(
    // Diagnosis/custom sentences may legitimately contain literal digits ("31일씩").
    (p) => !(fact.kind === "diagnosis" && p.startsWith("numbers must"))
  );
  if (problems.length > 0) {
    throw new Error(`Invalid template for fact ${fact.id}: ${problems.join("; ")}`);
  }
  const values = builtins(fact);
  const trigger = typeof fact.detail?.trigger === "string" ? fact.detail.trigger : fallback.trigger;

  const segments: TemplateSegment[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const prev = segments[segments.length - 1];
    if (prev?.type === "text") prev.text += text;
    else segments.push({ type: "text", text });
  };
  for (const match of source.matchAll(PLACEHOLDER)) {
    pushText(source.slice(last, match.index));
    if (match[1] === "fact") segments.push({ type: "fact", text: trigger });
    else pushText(values[match[1]]);
    last = (match.index ?? 0) + match[0].length;
  }
  pushText(source.slice(last));

  return {
    factId: fact.id,
    segments,
    text: segments.map((s) => s.text).join(""),
    // Only a pure number+unit trigger is set in mono ("6%", "72분", "85.2kg");
    // dates and phrases ("9월 6일 이후") stay in the line's serif voice.
    numeric: isQuantityText(trigger),
  };
}

/** Popover lines for a fact: metric · period · value · baseline, then `fact.rows`. */
export function factRows(fact: Fact): FactRow[] {
  const d = fact.detail ?? {};
  const value = formatFactValue(fact.value, fact.unit, fact.unitLabel);
  const rows: FactRow[] = [];
  switch (fact.kind) {
    case "concentration": {
      const unit = (d.partUnit as FactUnit) ?? "count";
      const unitLabel = String(d.partUnitLabel ?? "");
      rows.push({
        label: `${d.windowLabel} 합`,
        value: formatFactValue(Number(d.partValue), unit, unitLabel),
      });
      if (fact.baseline) {
        rows.push({
          label: fact.baseline.label,
          value: formatFactValue(fact.baseline.value, unit, unitLabel),
        });
      }
      rows.push({ label: "비중", value });
      break;
    }
    case "one_off": {
      const unit = (d.itemUnit as FactUnit) ?? "won";
      const unitLabel = String(d.itemUnitLabel ?? "");
      rows.push({
        label: String(d.itemLabel ?? "이 항목"),
        value: formatFactValue(Number(d.itemValue), unit, unitLabel),
      });
      if (fact.baseline) {
        rows.push({
          label: fact.baseline.label,
          value: formatFactValue(fact.baseline.value, unit, unitLabel),
        });
      }
      rows.push({
        label: "나머지 중 최대",
        value: formatFactValue(Number(d.secondValue), unit, unitLabel),
      });
      break;
    }
    case "streak":
      rows.push({ label: "연속 일수", value });
      if (fact.baseline)
        rows.push({ label: fact.baseline.label, value: `${fact.baseline.value}일` });
      break;
    case "diagnosis":
      break;
    default: {
      rows.push({ label: `${fact.period.label} ${fact.metricLabel}`, value });
      if (fact.baseline) {
        const baselineValue = formatFactValue(fact.baseline.value, fact.unit, fact.unitLabel);
        const ratio = typeof d.ratio === "number" ? ` (${signedPct(d.ratio)})` : "";
        rows.push({
          label: `${fact.baseline.label} · 비교 기준`,
          value: `${baselineValue}${ratio}`,
        });
      }
    }
  }
  return [...rows, ...(fact.rows ?? [])];
}

function signedPct(ratio: number): string {
  const pct = Math.round(ratio * 1000) / 10;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}
