import { isQuantityText } from "@/lib/facts/face";

/**
 * Whether an evidence-popover value is set in mono — the same rule as the AI
 * line's trigger (`isQuantityText`): mono only for a pure quantity, number+unit
 * tokens and nothing else ("72분", "4회 · 53분", "1건 1,800,000원",
 * "17건 283,890원 · 10일"). A date or time ("11월 9일 · 59bpm",
 * "5건 111,680원 · 11월 5일–9일") or a free word ("64일 전", "커밋 요약 테이블 0행")
 * sets the value in sans with tabular figures.
 */
export function isMonoFactValue(text: string): boolean {
  return isQuantityText(text);
}

/** Longest list entry kept on one line; longer ones may wrap inside. */
const MAX_NOWRAP = 18;

/**
 * Splits a popover value into its list entries ("11월 9일 08:45, 11월 6일 16:51",
 * "17건 283,890원 · 10일") so each short numeric entry can be kept on one line.
 * The separator stays at the end of the entry before it, so a wrapped line never
 * starts with "·" or ",". `keep` marks entries to render without wrapping.
 */
export function factValueParts(text: string): Array<{ text: string; keep: boolean }> {
  return text
    .split(/(?<=,|\s·)\s+/)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, keep: /\d/.test(part) && part.length <= MAX_NOWRAP }));
}
