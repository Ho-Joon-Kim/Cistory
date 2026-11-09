/** Units glued to a number ("72분", "4시간", "11월", "0행", "3.2만원") count as numeric. */
const NUMBER_WITH_UNIT = /\d[\d,.]*\s?[가-힣]*/g;
const HANGUL = /[가-힣]/;

/**
 * Whether an evidence-popover value is set in mono: it carries a number and every
 * Hangul in it is a unit glued to a number ("11월 9일 · 59bpm", "72분",
 * "1,680,000원 / 3,040,140원"). Values with free Korean words ("커밋 요약 테이블
 * 0행", "제공자가 인증을 거부함 · 다시 연결 필요") stay in the sans face.
 */
export function isMonoFactValue(text: string): boolean {
  if (!/\d/.test(text)) return false;
  return !HANGUL.test(text.replace(NUMBER_WITH_UNIT, ""));
}
