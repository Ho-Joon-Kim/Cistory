/**
 * Turning a thrown value into copy a person can read.
 *
 * Our own throws and the API's `error` bodies are Korean. Anything else — a
 * TypeError "Failed to fetch (127.0.0.1:3500)", a JSON SyntaxError, an English
 * provider string, a bare status code — is raw platform text and is replaced by
 * Korean copy. Raw error text never reaches the screen.
 */

const HANGUL = /[가-힣]/;

/** Shown when nothing more specific is known. */
export const GENERIC_ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";
/** Shown when the request never reached the server (fetch's TypeError). */
export const NETWORK_ERROR_MESSAGE = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";

function messageOf(reason: unknown): string | null {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason) {
    const message = (reason as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

/**
 * Korean message safe to show for `reason`. Keeps a message that is already
 * Korean, maps a network failure to {@link NETWORK_ERROR_MESSAGE}, and falls
 * back to `fallback` for everything else.
 */
export function userErrorMessage(
  reason: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE
): string {
  const message = messageOf(reason)?.trim();
  if (message && HANGUL.test(message)) return message;
  if (reason instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  return fallback;
}

/** Same text once punctuation and spacing are ignored ("…못했어요." vs "…못했어요"). */
export function sameErrorCopy(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s.!?。…]+/g, "");
  return norm(a) === norm(b);
}
