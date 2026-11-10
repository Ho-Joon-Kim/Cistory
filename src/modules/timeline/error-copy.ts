// Local stand-in for the shared `userErrorMessage()` landing in `@/lib/user-error`
// (rdfix5/global). Swap the import to that helper once it is merged.

const HANGUL = /[가-힣]/;
const NETWORK = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";

const normalize = (s: string) => s.trim().replace(/[.!。]+$/, "");

/**
 * One Korean line for an inline day-view error: the fixed `title`, plus the
 * reason only when it is our own Korean copy (or a network failure) and doesn't
 * just repeat the title. Raw platform text ("Failed to fetch (host)") never shows.
 */
export function dayErrorMessage(reason: unknown, title: string): string {
  const detail =
    reason instanceof Error && HANGUL.test(reason.message)
      ? reason.message
      : reason instanceof TypeError
        ? NETWORK
        : null;
  if (!detail || normalize(detail) === normalize(title)) return title;
  return `${title} ${detail}`;
}
