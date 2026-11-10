/** Units glued to a number ("72분", "4시간", "0행", "3.2만원") count as numeric. */
const NUMBER_WITH_UNIT = /\d[\d,.]*\s?[가-힣]*/g;
const HANGUL = /[가-힣]/;
/** Calendar furniture: "11월", "9일", "17:00", "(일)". A date is read, not measured. */
const DATE_LIKE = /\d\s?월|\d\s?일(?![가-힣])|\d{1,2}:\d{2}|\([월화수목금토일]\)/;

/**
 * Whether an evidence-popover value is set in mono. The one rule every popover
 * follows: mono only for a pure quantity — numbers with their units and
 * nothing else ("72분", "4시간 59분", "1,680,000원 / 3,040,140원", "2.32 GB").
 * Anything that reads as words — a date or time ("11월 9일 · 59bpm",
 * "9월 6일 (일) 17:00 · 64일 전"), or free Korean ("커밋 요약 테이블 0행") — is
 * set in the sans face (with tabular figures), so rows of the same shape share
 * a face across health, spending and data-status.
 */
export function isMonoFactValue(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (DATE_LIKE.test(text)) return false;
  return !HANGUL.test(text.replace(NUMBER_WITH_UNIT, ""));
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
