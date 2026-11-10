/**
 * The one face rule for fact text — shared by the dotted trigger inside an AI
 * line (FactTrigger / renderTemplate) and by every evidence-popover value
 * (FactPopover), so a "N건 금액" row and a "72분" trigger can't disagree.
 *
 * Mono (Geist Mono) only for a pure quantity: number+unit tokens and nothing
 * else, optionally joined by " · ", "/", "–", "×" and the like —
 * "42%", "4.1kg", "65bpm", "12,363,000원", "1건 1,800,000원",
 * "17건 283,890원 · 10일", "4회 · 53분", "2.32 GB".
 *
 * Everything that reads as words is set in the surrounding face (serif in an
 * AI line, sans in a popover) with tabular figures:
 *   - a calendar date or clock time — "9월 6일 이후", "11월 9일 · 59bpm",
 *     "5건 111,680원 · 11월 5일–9일", "17:00", "(일)";
 *   - any free word — "64일 전", "하루 283,890원 × 31일", "중앙값 59",
 *     "Fitbit 수면 단계".
 *
 * A bare "N일" with no month is a count of days ("· 10일" = ten days in), so it
 * stays a quantity; "N월" (but not "N개월") marks a date.
 */

/**
 * One quantity token: an optional sign, the number, then either a unit glued to
 * it ("72분", "4시간", "65bpm", "42%", "3.2만원") or a short Latin unit after
 * one space ("2.32 GB"). A Hangul word after a space is a word, not a unit.
 */
const QUANTITY_TOKEN = /[+\-−±]?\d[\d,.]*(?:[%가-힣A-Za-z]+|\s[A-Za-z]{1,3}\b)?/g;

/** Calendar/clock furniture: "11월" (not "3개월"), "17:00", "(일)". */
const DATE_LIKE = /\d\s?월|\d{1,2}:\d{2}|\([월화수목금토일]\)/;

const LETTER = /\p{L}/u;

/** Whether fact text is a pure number+unit quantity (set in mono). */
export function isQuantityText(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (DATE_LIKE.test(text)) return false;
  return !LETTER.test(text.replace(QUANTITY_TOKEN, ""));
}
