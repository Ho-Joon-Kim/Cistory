import { isMonoFactValue } from "@/components/ds";

/**
 * The face rule for dynamic chart text: Geist Mono only for a pure number+unit
 * quantity; anything carrying a date, time or word keeps the surrounding face
 * with tabular figures (Geist Mono has no Hangul).
 */
export function faceClass(text: string): "num" | "tabular-nums" {
  return isMonoFactValue(text) ? "num" : "tabular-nums";
}
