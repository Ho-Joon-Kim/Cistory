import { userErrorMessage } from "@/lib/user-error";

const normalize = (s: string) => s.trim().replace(/[.!。]+$/, "");

/**
 * One Korean line for an inline day-view error: the fixed `title`, plus the
 * reason only when the shared helper yields specific Korean copy (our own
 * message or a network failure) that doesn't just repeat the title. Raw
 * platform text ("Failed to fetch (host)") never shows.
 */
export function dayErrorMessage(reason: unknown, title: string): string {
  const detail = userErrorMessage(reason, "");
  if (!detail || normalize(detail) === normalize(title)) return title;
  return `${title} ${detail}`;
}
